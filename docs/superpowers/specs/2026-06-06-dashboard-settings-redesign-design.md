# 設計：Settings 頁 Dashboard 化 + 抽獎紀錄收集

日期：2026-06-06
分支：humanize-config

## 目標

把現有的 options 設定頁從「單欄堆疊表單」重新設計成有儀表板樣子的頁面：頂部呈現累積統計，並新增「最近進入的 20 款遊戲」清單。設定欄位本身不變，只重排外觀。

## 範圍

**做：**
- 重新設計 `options/options.html` + `options/options.css`（單頁滾動版面）。
- 新增資料收集：每次抽獎嘗試記錄一筆遊戲紀錄，並累計嘗試數。
- 在兩個抽獎進入點（安全模式、激進模式）送出紀錄，由 service worker 串行化寫入。
- `options.js` 載入並渲染 KPI 統計列與最近 20 款清單。

**不做：**
- 不改 popup。
- 不改抽獎演算法 / 評分 / 篩選邏輯。
- 不加清單篩選、分頁、搜尋、匯出等延伸功能。
- 不改 manifest 權限。

## 版面（方向 A：單頁滾動）

頁寬從 520px 加寬到約 760px。由上而下：

1. **標題**
2. **KPI 統計列**（4 張卡，CSS grid 等寬）
   - 累計抽獎 — `totalEnterGiveaway`（自安裝以來）
   - 今日 / 上限 — `autoJoinCount` / `autoJoinCap`
   - 目前點數 — `currentPoint`，副標顯示相對更新時間（`pointUpdatedAt`）
   - 全期成功率 — `round(totalEnterGiveaway / totalAttempts * 100)`%；`totalAttempts` 為 0 時顯示「—」
3. **最近進入的 20 款遊戲**（清單卡）
   - 每列：結果徽章（成功/失敗）· 遊戲名稱（連結，新分頁開啟抽獎頁）· 花費點數 · 相對時間
   - 失敗列點數顯示「—」
   - 無紀錄時顯示空狀態文字
4. **設定區**（卡片網格，欄位沿用現有，僅重排）
   - 小卡：抽獎權重、最低門檻、前往目標、點數保留
   - 寬卡：自動化（自動計分／全自動／活躍時段／激進模式）、擬人化節奏（含進階折疊區）、資料（重設累計／還原預設）

## 資料模型（新增）

### `recentEntries`（`storage.local`）
抽獎紀錄陣列，新到舊排序，上限 20 筆。每筆：

```js
{
  name: string,    // 遊戲名稱
  url: string,     // 抽獎頁完整網址
  points: number,  // 花費點數；失敗為 0
  result: "success" | "fail",
  time: number     // Date.now() 時間戳
}
```

放 `storage.local`：屬執行期資料、量較大，且避免觸發 `service-worker.js` 中 sync `onChanged` 的頁面 reload 流程。

### `totalAttempts`（`storage.sync`）
累計嘗試數（含失敗），lifetime 計數器。用於計算全期成功率。與既有 `totalEnterGiveaway`（累計成功數）並存。

## 紀錄寫入流程

「一次嘗試」定義：實際點擊/送出加入請求並得到成功或失敗結果。被點數門檻擋下、未送出的（如 Not Enough Point）不算嘗試、不記錄。

兩個進入點都改為：每次嘗試結束後，把該筆紀錄交給 service worker 串行化寫入，沿用既有 `SerialCounter` 機制防多分頁競態。

### Service worker 新增 message：`recordEntry`
payload：`{ name, url, points, result }`

SW 收到後（單一序列化通道內）：
1. `totalAttempts` +1（`storage.sync`，經 `totalCounter` 同型序列化）。
2. unshift 一筆紀錄到 `recentEntries`（`storage.local`），裁切到 20 筆。
   - 需新增一個 list 型序列化寫入器（讀現值 → unshift → slice(0,20) → 寫回），與 `SerialCounter` 同樣走單一 SW 串行化，避免並發覆寫。

> 成功計數仍走既有路徑：安全模式 `enterCommitted`、激進模式 `fullAutoResult` 的 `count`，照舊累加 `totalEnterGiveaway` / `autoJoinCount`。`recordEntry` 只負責 `totalAttempts` 與 `recentEntries`，不重複加成功計數。

### 安全模式（`content_scripts/autoStart.js`）
- `enterGiveaway` 成功後：取該列 `.giveaway__heading__name` 的文字與 href（補成完整網址）、花費點數，送 `recordEntry`（result: success）。
- catch 失敗時：同樣取名稱/網址，送 `recordEntry`（result: fail, points: 0）。
- 成功計數維持送 `enterCommitted`。

### 激進模式（`offscreen.js`）
- `runFullAuto` 迴圈中，每次 `enterOne` 後依結果取該 row 的名稱（`.giveaway__heading__name`）與 href、花費點數，組成紀錄，收集到一個本地陣列。
- 迴圈結束後，把紀錄陣列隨既有的 `fullAutoResult` 訊息一併回傳（新增 `entries` 欄位）；service worker 在處理 `fullAutoResult` 時，對每筆 `entries` 套用與 `recordEntry` 相同的串行化寫入（`totalAttempts` +1、unshift 進 `recentEntries`）。沿用 offscreen 既有「迴圈中不發訊息、結束才回報」的單一回報模式。
- 成功計數維持由 `fullAutoResult` 的 `count` 累加，與 `entries` 各自獨立、不重複計算成功數。

## 重設行為

「重設累計」按鈕（`options.js` `resetTotal`）改為一鍵清空全部統計：
- `totalEnterGiveaway` → 0（sync）
- `totalAttempts` → 0（sync）
- `recentEntries` → `[]`（local）

「還原預設」維持現狀（寫回 `defaultSchema.json` 後 reload）。`defaultSchema.json` 視需要加入 `totalAttempts: 0` 的種子值（`recentEntries` 屬 local、不在 sync schema，不加入）。

## 相對時間

KPI 的「目前點數」副標與清單的時間欄，沿用既有 `content_scripts/relativeTime.js` 的相對時間格式化；options 頁需引入該腳本。

## 國際化

新增的固定文案（KPI 標籤、清單標題、徽章文字、空狀態）沿用既有 `__MSG_*__` / `chrome.i18n` 模式，於 `_locales` 補對應 key。

## 測試策略

- **純函式單元測試**：成功率計算（含 `totalAttempts === 0` → 顯示「—」）、`recentEntries` unshift + 裁切到 20 的 list 寫入器、相對時間格式化（若新增）。沿用 `tests/` 既有風格。
- **手動驗證**：載入擴充，跑一輪安全模式抽獎，確認 KPI 數字、最近清單逐筆出現、失敗列正確標示、重設按鈕一鍵清空。

## 驗收條件

1. Options 頁呈現 4 張 KPI 卡與最近 20 款清單，數值對應實際 storage。
2. 安全模式與激進模式各跑一次後，`recentEntries` 正確新增紀錄（含成功/失敗）、上限 20、新到舊。
3. `totalAttempts` 正確累計，成功率顯示正確（0 嘗試顯示「—」）。
4. 「重設累計」一鍵清空 `totalEnterGiveaway`、`totalAttempts`、`recentEntries`。
5. 設定欄位行為與既有完全一致（只是換外觀）。
6. 既有測試全綠，新增測試通過。
