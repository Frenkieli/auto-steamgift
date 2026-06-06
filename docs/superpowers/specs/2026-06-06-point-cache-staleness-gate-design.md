# 點數快取 + 6 小時過期閘門 設計文件

> 日期:2026-06-06　目標版本:1.3

## 問題

目前抓取 SteamGifts 點數的網路請求過於頻繁,有觸發帳號風控/封鎖的風險:

1. **`popup/init.js`** —— 每次打開 popup 都 `fetch('https://www.steamgifts.com/')`。
2. **`service-worker.js` `onStartup`** —— 每次瀏覽器啟動都 fetch 首頁並跳「你的點數:X」通知。
3. （`offscreen.js` 全自動會 fetch 願望清單,這是抽獎本身必要的,不在本次處理範圍。）

此外,#1 與 #2 的 `fetch` 都**沒有帶 `credentials:"include"`**,所以實際拿到的是**未登入頁**、解析不到 `nav__points`,點數顯示長期是空的 —— 一併修正。

## 目標

- 把「自動發出的點數請求」上限壓到 **每 6 小時最多 1 次、一天最多 4 次**。
- 在不額外發請求的時機（使用者自己逛 SteamGifts、全自動抽完）**免費**刷新點數。
- 不新增任何權限（沿用既有 `storage` 權限與 `www.steamgifts.com` host 權限;**不使用** `chrome.alarms`）。

## 核心概念:過期閘門（不是定時器）

更新「時機」維持原本的事件 —— **瀏覽器啟動**、**打開 popup** —— 但多存一個「上次更新時間」,在這些時機檢查距上次更新是否已超過 6 小時,**超過才真的發請求**。沒有背景計時器。

正常使用下,免費來源（逛站、全自動）會不斷刷新快取時間戳,使啟動/開 popup 幾乎永遠看到「新鮮」狀態而不發請求;最壞情況（完全不逛、不抽）才會每 6 小時抓一次。

## 資料模型（存 `chrome.storage.local`）

| Key | 型別 | 說明 |
|---|---|---|
| `currentPoint` | `number \| null` | 最後已知點數;從未取得時為 `null` |
| `pointUpdatedAt` | `number` | 最後更新的 epoch 毫秒;從未更新時為 `0`/不存在 |

> 放 `local` 而非 `sync`:點數會在每次逛 SteamGifts 時寫入,屬高頻本地快取。`chrome.storage.sync` 有寫入頻率限制且會跨裝置同步,不適合。其餘設定維持在 `sync` 不變。

常數:`POINT_TTL_MS = 6 * 60 * 60 * 1000`（6 小時）。

## 元件與資料流

### A. Service worker:過期閘門與快取寫入

新增兩個函式於 `service-worker.js`:

1. `refreshPointsIfStale({ notify })`
   - 從 `chrome.storage.local` 讀 `pointUpdatedAt`。
   - 若 `Date.now() - (pointUpdatedAt || 0) < POINT_TTL_MS` → 直接 return（新鮮,不發請求）。
   - 否則 `fetch(HOME_URL, { credentials: "include" })` → 取 text → 以 `/<span class="nav__points">(\d+)<\/span>/` 解析 `point`。
   - 取得到數字才寫入 `chrome.storage.local.set({ currentPoint: point, pointUpdatedAt: Date.now() })`。
   - 取得到數字且 `notify === true` 才呼叫既有的「目前點數」通知。
   - fetch 失敗或解析不到 → 不更動快取、不通知。

2. `storePoints(point)`
   - `chrome.storage.local.set({ currentPoint: point, pointUpdatedAt: Date.now() })`。
   - 供免費更新來源（全自動回報）使用。

### B. 觸發來源（四個）

| 來源 | 觸發點 | 是否可能發請求 | 行為 |
|---|---|---|---|
| 瀏覽器啟動 | `chrome.runtime.onStartup` | 是（過期才） | 呼叫 `refreshPointsIfStale({ notify: true })`。超過 6h 才抓+通知;否則不抓不顯示通知。 |
| 打開 popup | `popup/init.js` 載入 | 是（過期才） | 先用快取顯示點數與「更新於 X 前」,再請 SW 跑 `refreshPointsIfStale({ notify: false })`;若 SW 更新了快取,popup 透過 `storage.onChanged` 更新顯示。 |
| 逛 SteamGifts | 新增常駐 content script | 否 | 讀頁面 `.nav__points` → `storePoints` 等效寫入 `chrome.storage.local`。 |
| 全自動抽完 | `offscreen.js` 回報 | 否 | offscreen 把抽完後的剩餘點數隨結果回傳;SW 收到後 `storePoints(point)`。 |

### C. popup（`popup/init.js` + `popup/popup.html`）

- **移除**目前無條件的 `fetch('https://www.steamgifts.com/')`。
- 載入時 `chrome.storage.local.get(["currentPoint", "pointUpdatedAt"])`:
  - `#pointSpan` 顯示 `currentPoint`,為 `null`/未定義時顯示 `—`。
  - 在點數卡片下方新增一個小字元素 `#pointUpdatedSpan`,顯示相對時間「更新於 X 前」。
- 送訊息 `{ type: "refreshPointsIfStale" }` 給 SW（SW 以 `notify:false` 執行閘門）。
- 註冊 `chrome.storage.onChanged`（`area === "local"`,`changes.currentPoint`）以即時更新 `#pointSpan` 與 `#pointUpdatedSpan`（避免 popup 在 fetch 完成前關閉而漏更新 —— fetch 由 SW 執行,結果寫回 storage,popup 只是反映）。

相對時間格式（由 `pointUpdatedAt` 計算）:

| 條件 | 顯示 |
|---|---|
| 無 `pointUpdatedAt` | 「尚未更新」 |
| < 60 秒 | 「剛剛更新」 |
| < 60 分 | 「更新於 N 分鐘前」 |
| < 24 小時 | 「更新於 N 小時前」 |
| 其餘 | 「更新於 N 天前」 |

字串走既有 i18n 機制,於 `_locales/zh_TW/messages.json` 與 `_locales/en/messages.json` 新增對應 key（例:`pointUpdatedJustNow`、`pointUpdatedMinutes`、`pointUpdatedHours`、`pointUpdatedDays`、`pointUpdatedNever`;含 `$N$` placeholder）。

### D. 常駐 content script（新檔 `content_scripts/readPoints.js`）

- 在 `manifest.json` 的 **靜態 `content_scripts`** 宣告(不是動態註冊),`matches: ["*://www.steamgifts.com/*"]`、`run_at: "document_idle"`。
- 內容:讀 `document.querySelector('.nav__points')`,以 `textContent` 取數字;有值才 `chrome.storage.local.set({ currentPoint, pointUpdatedAt: Date.now() })`。
- **做成獨立常駐**,而非塞進 `countScore.js`:`countScore.js` 僅在「自動計算分數」開啟時才透過 `chrome.scripting.registerContentScripts` 註冊;獨立後,不論任何功能開關,只要使用者逛 SteamGifts 就會免費刷新點數。

### E. 全自動回報點數（`offscreen.js` + `service-worker.js`）

- `runFullAuto(cfg)` 目前回傳 `count`。改為回傳 `{ count, point }`,其中 `point` 為迴圈結束後的剩餘 `myPoint`（起始點數扣掉已花費,offscreen 本來就有此值,**不需重新發請求**）。
- offscreen 的 `runFullAuto` 監聽器:`.then(({ count, point }) => sendMessage({ type: "fullAutoResult", count, point }))`;catch 維持只送 `count: 0`（無 `point`）。
- SW 的 `fullAutoResult` 處理:維持既有 `totalEnterGiveaway` 累加與完成通知;另外當 `message.point != null` 時呼叫 `storePoints(message.point)`。

## 移除 / 變更清單

- `popup/init.js`:移除無條件 fetch;改為快取顯示 + 送 `refreshPointsIfStale` 訊息 + `storage.onChanged` 監聽 + 相對時間小字。
- `service-worker.js` `onStartup`:把「無條件 fetch 首頁 + 通知」改為 `refreshPointsIfStale({ notify: true })`;新增 `refreshPointsIfStale` 與 `storePoints`;`fullAutoResult` 增加 `storePoints(message.point)`;新增 `refreshPointsIfStale` 訊息處理。
- `offscreen.js`:`runFullAuto` 回傳改為 `{ count, point }`;監聽器送出 `point`。
- `manifest.json`:新增靜態 `content_scripts`（`content_scripts/readPoints.js`）;版本 `1.2` → `1.3`。**不新增權限。**
- `content_scripts/readPoints.js`:新檔。
- `_locales/zh_TW/messages.json`、`_locales/en/messages.json`:新增相對時間 i18n key。

## 不做（YAGNI）

- 不使用 `chrome.alarms` / 背景定時器。
- popup 不放「手動刷新」按鈕（「前往 SteamGifts」本來就會經由 content script 免費刷新）。
- 不改動全自動抽獎本身的願望清單 fetch。

## 測試策略

- 點數抓取/快取邏輯主要牽涉 `chrome.*` 與跨來源 `fetch`,既有專案沒有 mock harness,因此這些路徑以**手動驗證**為主(沿用本專案慣例):
  - popup 連開多次只在快取超過 6h 時才看到一次網路請求(DevTools Network)。
  - 逛任一 SteamGifts 頁後,`chrome.storage.local` 的 `currentPoint`/`pointUpdatedAt` 有更新且 popup 反映。
  - 跑一次全自動後,popup 點數反映抽完後的剩餘值,且該次未額外發點數請求。
  - 啟動瀏覽器:距上次更新 <6h 時無通知、無請求;≥6h 時抓一次並通知。
- `giveaway-core.js` 的純函式單元測試(`npm test`)維持綠燈,不受本次影響。

## 淨效果

正常使用下快取幾乎總是新鮮,啟動/開 popup 幾乎不發請求;最壞情況每 6 小時最多 1 次、一天最多 4 次,並修好「未帶 credentials 導致點數一直抓不到」的既有問題。
