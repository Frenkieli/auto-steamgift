# 登入狀態偵測與登出保護 設計文件

> 日期:2026-06-06　版本:維持 1.2(尚未上架,不逐功能 bump)

## 問題

所有功能都默認使用者已登入 SteamGifts。一旦登入狀態掉了(session 過期 / 登出),目前是**靜默失敗**,使用者只覺得擴充壞了卻不知原因:

- SW 點數閘門抓首頁但配不到 `.nav__points` → 不更新、不通知。
- `readPoints.js` 找不到 `.nav__points` → 不寫入。
- 全自動(offscreen)抓願望清單但沒有 `xsrf_token` → 回傳 `{count:0}` → 通知「已自動抽取 **0** 件」(誤導成沒禮物可抽)。
- `autoStart.js` 在登出頁仍會跑(雖然抓不到可加入按鈕,但會留下失敗標記)。

## 目標

- 從**既有的免費讀取**判斷登入狀態(不發額外自動請求,延續降低封鎖風險的原則)。
- 登出時:popup 顯示橫幅、全自動按鈕停用、`autoStart` 自動加入不觸發。
- 提供使用者**手動重新檢查**(「我已登入」)以立即恢復功能,不必等下次機會性更新。
- `countScore` 計分**不**停用(登出時無害,YAGNI)。

## 資料模型(`chrome.storage.local`)

新增一個 key:

| Key | 值 | 說明 |
|---|---|---|
| `loggedIn` | `true` \| `false` \| `undefined` | `undefined` = 從未偵測;`false` = 已確認登出;`true` = 已確認登入 |

**重要規則:只有「抓取/讀取成功但找不到登入證據」才設 `false`;網路失敗(`.catch`)時不可改動 `loggedIn`**,以免把斷網誤判成登出。

## 元件與資料流

### A. `loggedIn` 的寫入來源(都免費)

1. **`readPoints.js`**(常駐,每次逛 SteamGifts 頁):
   - 有 `.nav__points` → `chrome.storage.local.set({ currentPoint, pointUpdatedAt, loggedIn: true })`
   - 沒有 `.nav__points` → `chrome.storage.local.set({ loggedIn: false })`(不動 `currentPoint`)

2. **SW `fetchAndStorePoints({ notify })`**(抽取自原本 `refreshPointsIfStale` 的抓取邏輯):
   - `fetch(HOME_URL, { credentials:"include" })` → text
   - regex 配到 `.nav__points` → `set({ currentPoint, pointUpdatedAt, loggedIn: true })`;若 `notify` 則跳「目前點數」通知
   - 抓到了但配不到 → `set({ loggedIn: false })`
   - `.catch` → 不動任何快取
   - 回傳 `Promise<true | false | null>`(`null` = fetch 失敗;供手動檢查回應用)

3. **全自動(`offscreen.js`)**:
   - 沒有 `xsrf` → `return { count: 0, loggedIn: false }`
   - 成功 → `return { count, point: myPoint, loggedIn: true }`
   - 監聽器把 `loggedIn` 一併放進 `fullAutoResult` 訊息;SW 收到後 `if (message.loggedIn != null) chrome.storage.local.set({ loggedIn: message.loggedIn })`

### B. SW 重構(共用抓取邏輯)

- 新增 `fetchAndStorePoints({ notify })`:上述 A2 的實際抓取/解析/寫入,回傳 `Promise<true|false|null>`。
- `refreshPointsIfStale({ notify })`:維持 6 小時閘門;過期才呼叫 `fetchAndStorePoints({ notify })`(其餘行為不變:啟動 `notify:true`、popup 觸發 `notify:false`)。
- 新訊息 `forceLoginCheck`:**繞過閘門**直接呼叫 `fetchAndStorePoints({ notify:false })`,並以 `sendResponse({ loggedIn })` 回傳結果(handler 對此 case `return true` 以保持非同步通道)。屬使用者主動觸發,一次請求可接受。

### C. popup:橫幅 + 全自動按鈕停用 + 手動重新檢查

`popup/popup.html` 在全自動按鈕區新增一個預設隱藏的橫幅:
```html
<div id="loginBanner" class="login-banner" style="display:none;">
  <span>__MSG_popLoginLost__</span>
  <button id="recheckLoginBtn" class="recheck-btn">__MSG_popRecheckLogin__</button>
</div>
```

`popup/popup.js` 集中管理兩個狀態:`isRunning`(全自動進行中)與 `loggedOut`(`loggedIn === false`):
- 開啟時 `chrome.storage.local.get(["fullAutoRunning","loggedIn"])` → 初始化並渲染。
- `renderFullAutoBtn()`:`disabled = isRunning || loggedOut`;label 進行中為 `popFullAutoRunning`,否則 `popFullAuto`;`is-loading` class 只在 `isRunning` 時。
- `renderLoginBanner()`:`loginBanner.style.display = loggedOut ? "" : "none"`。
- `chrome.storage.onChanged`(area `local`):`changes.fullAutoRunning` → 更新 `isRunning`、`fullAutoArmed=false`、`renderFullAutoBtn()`;`changes.loggedIn` → 更新 `loggedOut`、`renderFullAutoBtn()` + `renderLoginBanner()`。
- **「我已登入,重新檢查」**(`#recheckLoginBtn`)點擊:
  - 按鈕文字改 `popRecheckLoginChecking`、停用。
  - `chrome.runtime.sendMessage({ type:"forceLoginCheck" }, (resp) => { ... })`:回應後復原按鈕文字/啟用;依 `resp.loggedIn` 直接更新 `loggedOut` 並 `renderFullAutoBtn()` + `renderLoginBanner()`(涵蓋「值未變、onChanged 不觸發」的情況)。`resp.loggedIn === null`(fetch 失敗)時保持橫幅、按鈕復原即可。
- 全自動按鈕的點擊處理維持原樣,開頭已有 `if (fullAutoBtn.disabled) return;`,因此登出時按不動。

> `undefined`(未知)時 `loggedOut` 為 `false` → 橫幅不顯示、全自動按鈕啟用(樂觀)。若其實已登出,按下全自動後 offscreen 偵測到 no-xsrf → 設 `loggedIn:false` → 橫幅與停用隨即生效,自我修正。

`popup/popup.css` 新增 `.login-banner` 與 `.recheck-btn` 樣式(警示色、小字、按鈕)。

### D. `autoStart.js` 登出不觸發

在注入腳本開頭(`setTimeout` callback 內、做事之前)加:
```js
if (!document.querySelector('.nav__points')) return; // 未登入則不自動加入
```
`countScore.js` 不變(計分照常)。

## i18n(`_locales/zh_TW` 與 `_locales/en`)

| key | zh_TW | en |
|---|---|---|
| `popLoginLost` | ⚠ 未登入,請先登入 SteamGifts | ⚠ Not signed in. Please sign in to SteamGifts. |
| `popRecheckLogin` | 我已登入,重新檢查 | I've signed in — re-check |
| `popRecheckLoginChecking` | 檢查中… | Checking… |

## 變更清單

- `content_scripts/readPoints.js`:寫入 `loggedIn`(present→true / absent→false)。
- `content_scripts/autoStart.js`:開頭加未登入 guard。
- `service-worker.js`:抽出 `fetchAndStorePoints`(寫 `loggedIn`);`refreshPointsIfStale` 改為呼叫它;新增 `forceLoginCheck` 訊息(`return true` + `sendResponse`);`fullAutoResult` 增設 `loggedIn`。
- `offscreen.js`:`runFullAuto` 回傳含 `loggedIn`;監聽器轉發。
- `popup/popup.html`:新增 `#loginBanner` + `#recheckLoginBtn`。
- `popup/popup.js`:集中 `isRunning`/`loggedOut` 狀態、橫幅與重新檢查邏輯。
- `popup/popup.css`:橫幅與按鈕樣式。
- `_locales/zh_TW/messages.json`、`_locales/en/messages.json`:3 個新 key。
- `manifest.json`:不變動(版本維持 1.2)。

## 不做(YAGNI)

- 不停用 `countScore` 計分。
- 不做登出瞬間的主動通知(避免暫時頁面/斷網誤報;改由橫幅 + 手動重新檢查處理)。
- 不為了偵測登入而新增任何「自動」請求;唯一的主動請求是使用者點「我已登入」那一次。

## 測試策略

- 新邏輯多牽涉 `chrome.*` / 跨來源 `fetch` / DOM,沿用本專案慣例以**手動驗證**為主:
  - 登出狀態下開 popup → 顯示橫幅、全自動按鈕停用。
  - 點「我已登入,重新檢查」(已在另一分頁登入後)→ 橫幅消失、全自動恢復;未登入時按鈕復原、橫幅保留。
  - 登出時逛 SteamGifts → `storage.local.loggedIn` 變 `false`;`autoStart` 不動作;`countScore` 仍標分數。
  - 斷網時手動檢查 → `loggedIn` 不被誤設為 false。
- 既有 `npm test`(`giveaway-core` + `relative-time`,33 筆)維持綠燈,不受影響。

## 淨效果

登入狀態掉了會被明確呈現(橫幅 + 停用),自動化不再靜默亂動;使用者一鍵即可重新檢查並恢復功能;偵測完全寄生在既有讀取上,只有手動檢查會發出一次請求。
