# 行為擬人化 / 降低被偵測 設計文件

> 日期:2026-06-06　版本:維持 1.2(未上架)

## 背景與風險

SteamGifts 公告將加強偵測並停權 autojoin 自動化帳號(discussion `M9UFV`;該站對非瀏覽器流量直接回 403,可見其封鎖力道)。盤點本擴充的自動化,依風險排序:

- **🔴 背景全自動 `offscreen.js`**:抓一次願望清單後直接連續 POST `entry_insert`,**全程無對應的 giveaway 頁面瀏覽**;間隔為 800–2000ms 均勻亂數(均勻分布本身是指紋);一次爆量、可能凌晨觸發。結構上最像機器人。
- **🟡 頁面內 `autoStart.js`**:跑在**真實分頁**、點**真按鈕**(走網站自身 JS,header/referer/XSRF 正確,網路層與手動難分),但間隔僅 100–300ms、死板高分優先、一口氣掃完。

## 誠實的有效性分級(設計依據)

- **真正有效(伺服器可觀測)**:① 真實頁面情境(referer/cookie/資產載入);② **description-gated 加入前的「閱讀停留」** —— 因為 gated 加入一定先打 `giveaway_description` 再打 `entry_insert`,伺服器看得到兩者間隔;③ **量的上限**;④ **活躍時段**;⑤ **不規律(重尾)時間分布**。
- **次要/客戶端**:滑鼠 hover、捲動事件 —— 伺服器看不到,只有當 SteamGifts 跑客戶端行為偵測 JS 才有意義。便宜的保險,納入但不過度投資。

**結論**:主路徑改以**頁面內真實點擊**為主;背景 AJAX 降為預設關閉的「激進模式」。所有路徑疊上時間/閱讀/量/時段的擬人化。

## 目標

- 頁面內自動加入改為**保守且擬人**:重尾時間分布、描述閱讀停留、捲動/hover、抵達延遲。
- **每日上限(稍微隨機,約 50–58)** + **活躍時段 10:00–02:00(跨午夜)** + **機率性早停**,兩條路徑共同遵守。
- 背景 AJAX 全自動 → **預設關閉的激進模式**,開啟時明確警告;啟用時也套用閱讀停留與量上限。
- 高分優先、**不跳過任何願望清單禮物**(只靠上限限量)。

---

## 架構與元件

### 一、純函式擬人化模組(可單元測試)

新檔 `content_scripts/humanize.js`,IIFE 雙重匯出 `window.Humanize` 與 `module.exports`。所有函式**注入 `rng`(預設 `Math.random`)與時間**,無 `chrome.*`,可測:

| 函式 | 行為 | 參數/預設 |
|---|---|---|
| `humanDelayMs(rng)` | 對數常態抽延遲(Box-Muller),夾在 [min,max] | median 13000、sigma 0.6、min 6000、max 240000 |
| `readingDelayMs(textLen, rng)` | 依字數(`textLen/5` 詞)× 略讀 ~300wpm + 變異(0.7–1.3)+ 基底 1200ms,夾 [1500, 15000] | — |
| `maybeBreakMs(rng)` | 機率 `p` 回傳長休息(均勻 60000–300000ms),否則 0 | p=0.15 |
| `shouldEarlyStop(rng)` | 機率 `p` 回傳 true(本 session 早停) | p=0.10 |
| `inActiveHours(date, startMin, endMin)` | 以「當日分鐘數」判斷是否在時段內,**支援跨午夜**(start>end 時 `mins>=start || mins<end`) | — |
| `pickDailyCap(rng, min, max)` | 回傳 `min..max` 的整數(每日重抽) | min 50、max 58 |

對應新測試 `tests/humanize.test.js`:驗證 `humanDelayMs` 永遠落在 [min,max] 且 rng=0.5,0.25 給中位數;`readingDelayMs` 對字數單調遞增且有界;`maybeBreakMs`/`shouldEarlyStop` 的機率分支;`inActiveHours` 的跨午夜邊界(09:59→false、10:00→true、01:59→true、02:00→false);`pickDailyCap` 落在範圍。

### 二、共用的「量 / 時段」閘門(兩路徑共用語意)

狀態(`chrome.storage.local`):

| Key | 說明 |
|---|---|
| `autoJoinDate` | 當日日期字串(本地 `YYYY-MM-DD`) |
| `autoJoinCount` | 當日已加入筆數 |
| `autoJoinCap` | 當日上限(`pickDailyCap`,每天重抽) |

設定(`chrome.storage.sync`,含於 `defaultSchema.json`):

| Key | 預設 |
|---|---|
| `activeHours` | `{ start: 600, end: 120 }`(10:00–02:00,單位:分鐘) |
| `aggressiveMode` | `{ trigger: false }`(背景 AJAX 全自動,預設關) |

**每日預算邏輯**(共用約定):讀 `autoJoinDate`,若 ≠ 今日 → 重置 `autoJoinCount=0`、`autoJoinCap=pickDailyCap(...)`、`autoJoinDate=今日`;`remaining = max(0, autoJoinCap - autoJoinCount)`。每成功加入一筆 → `autoJoinCount++` 寫回。

### 三、頁面內主路徑 `autoStart.js`(改寫迴圈)

前置(任何一項不過就 `return`,不動作):
1. 既有未登入 guard(`.nav__points` 不存在)。
2. **活躍時段**:`Humanize.inActiveHours(new Date(), activeHours.start, activeHours.end)` 為 false → 不跑。
3. **每日預算**:套用上面的每日預算邏輯;`remaining===0` → 不跑。

主流程:
1. **抵達延遲**:開始前 `await delay(uniform 2000–10000ms)`(取代現有 setTimeout 500)。
2. 收集可加入且通過最低限度且買得起的列,**高分由高到低排序(不跳過)**。
3. 逐筆(同時受 `remaining` 與早停限制):
   - `row.scrollIntoView({behavior:'smooth', block:'center'})` → 短暫停頓。
   - 對 insert 按鈕派發 `mouseover`/`mousemove`(hover)→ 停頓 ~300–800ms。
   - 若 gated:點 `--description` → 輪詢解鎖 → 讀面板文字長度 → `await delay(Humanize.readingDelayMs(textLen))`。
   - hover insert → `insertBtn.click()` → 輪詢 `is-faded`。
   - 成功:`autoJoinCount++` 寫回、badge、UI 標記;`remaining--`。
   - `await delay(Humanize.humanDelayMs())`;`const br = Humanize.maybeBreakMs(); if (br) await delay(br)`。
   - `if (Humanize.shouldEarlyStop() || remaining<=0) break;`
4. 結束捲回頂部、送 `autoEnterDone`。

注入:`service-worker.js` 的 `injectAutoScript` 改注入 `["content_scripts/giveaway-core.js", "content_scripts/humanize.js", "content_scripts/autoStart.js"]`。

### 四、背景路徑降級為「激進模式」

- **popup 全自動按鈕路由**(`service-worker.js` 收到 `fullAutoWishlist`):
  - `aggressiveMode.trigger === false`(預設):**不走背景 AJAX**;改為開啟/聚焦願望清單分頁(沿用 `goLinkTarget` 的 reuse 邏輯)並對該真實分頁注入擬人化的 in-page 流程(giveaway-core + humanize + autoStart),即在真分頁跑主路徑。
  - `aggressiveMode.trigger === true`:走既有 offscreen 背景路徑,並:① SW 依每日預算算 `maxEntries=remaining` 放進 `runFullAuto` 訊息;② `offscreen.js` 抽到 `maxEntries` 即停、gated 加入前 `await delay(Humanize.readingDelayMs(descLen))`、每筆 `await delay(Humanize.humanDelayMs())`(取代均勻 800–2000);③ `fullAutoResult` 回報 `count`,SW 將 `autoJoinCount += count` 寫回。
- `offscreen.html` 載入 `content_scripts/humanize.js`(在 offscreen.js 前)。
- offscreen 取得描述長度:gated 時對 `do=giveaway_description` 的回應 `data.html` 取文字長度餵 `readingDelayMs`(它本來就會打這個請求拿到 html)。

### 五、設定 / 顯示 UI

- **options**:新增「自動化時段」(start/end,以 `HH:MM` 輸入並換算分鐘)與「激進模式(背景全自動)」開關 + 紅字警告。
- **popup**:全自動按鈕區下方顯示「今日已加入 X / Y」(讀 `autoJoinCount`/`autoJoinCap`);激進模式開啟時按鈕旁顯示警告標記。
- **i18n**:新增上述標籤(zh_TW / en)。

---

## 分階段(寫成一份 spec,計畫照階段排任務)

- **Phase 1 — 核心擬人化**:`humanize.js` + 測試;`autoStart.js` 的抵達延遲、捲動/hover、描述閱讀停留、重尾間隔、`maybeBreak`;SW 注入 humanize。(不含上限/時段。)
- **Phase 2 — 量 / 時段安全閥**:每日隨機上限 + 活躍時段 + 機率早停 + 持久化;`defaultSchema.json`;options 時段 UI;popup「今日 X/Y」。
- **Phase 3 — 背景降級**:`aggressiveMode` 閘門 + popup 路由(預設走 in-page、開啟才走背景);offscreen 套 `readingDelayMs`/`humanDelayMs` + `maxEntries`;警告 UI。

## 測試策略

- `humanize.js` 為純函式 → **單元測試**(`npm test`)涵蓋分布邊界、跨午夜、機率分支、上限範圍。
- `autoStart.js` / `offscreen.js` / SW / popup / options 牽涉 `chrome.*`/DOM → 沿用慣例**手動驗證**(逐項見計畫),既有 33 筆測試維持綠燈。

## 不做(YAGNI / 誠實界線)

- 不追求「絕對隱形」—— 沒有任何做法保證不被偵測;目標是不觸發啟發式規則。
- 不做真實滑鼠軌跡模擬(成本高、伺服器看不到);僅派發基本 hover 事件作為廉價保險。
- 不在 options 暴露時間分布內部參數(保守值寫死,避免過度配置);只開放時段與激進模式開關。
- 背景路徑不補「逐一 GET giveaway 頁」(改以「預設不走背景、走真分頁」從根本避開該破綻)。

## 淨效果

主路徑改走真實分頁真點擊並保守擬人(重尾時間、描述閱讀停留、捲動);量與時段有上限與視窗;背景爆量 AJAX 預設關閉。把最像機器人的行為從預設路徑移除,並讓伺服器可觀測的訊號(閱讀停留、量、時段、節奏)都更像人。
