# Popup 與設定頁改版設計

日期：2026-06-05
分支：feature/steamgifts-quick-entry-rewrite

## 背景與問題

現況 popup（`popup/popup.html`）把「計分權重的數值」這種設定一次就很少改的東西，塞進了使用者最常開的畫面，佔了一半空間；同時看不到目前點數、開關要按「保存」才生效、也沒有手動觸發抽取的入口。設定頁（`options/options.html`）目前只是一個寫著「選項葉面」的空殼。

本次目標：把 popup 收斂成「看狀態 + 一鍵開關 + 手動觸發」的快速面板，把所有細節設定移到真正做出來的設定頁。

## 設計原則

- **popup = 每天會用的東西**：狀態、開關、動作按鈕。
- **設定頁 = 設定一次就放著的東西**：權重、門檻、目標頁、資料管理。
- **分數 vs 門檻分離**：分數只用來「排序」（高分先抽）；門檻用來「不符合就直接不抽」。

## Popup 設計

由上到下：

1. **⚡ 全自動抽取願望清單**（最上方，主要動作按鈕）
   - 只抽願望清單（wishlist）的 giveaway，刻意限制範圍以降低帳號被封鎖的風險。
   - 運作方式（採方案 A，最低封鎖風險、重用現有程式）：點擊後開啟／切換到願望清單搜尋頁
     `https://www.steamgifts.com/giveaways/search?type=wishlist`，在頁面上用現有的「模擬點擊 quick-entry」邏輯逐一抽取，完成後跳出通知「已自動抽取 N 件願望清單禮物」。
   - 不採背景靜默抽取（方案 B），因為較像機器人行為、封鎖風險較高，且與「避免過度使用」初衷衝突。
   - **封鎖警告**：按鈕下方常駐一行小字警告；且第一次點擊時跳確認對話框（「了解風險才繼續」），同意後記住不再問。
   - 抽取時一樣套用設定頁的計分權重與最低限度門檻。

2. **狀態列**：並排兩個數字卡
   - 目前點數（打開 popup 時向 `steamgifts.com` 取得；未登入或取不到時顯示 `—`）。
   - 累計加入（沿用現有 `totalEnterGiveaway`）。

3. **自動化開關**（toggle 樣式，**切換即生效，移除「保存」按鈕**）
   - 自動計算分數（`autoScore`）
   - 自動開始抽取（`autoStart`，沿用：開啟 SteamGifts 頁面時自動觸發）

4. **前往 SteamGifts**（次要動作按鈕）
   - 預設開啟「願望清單搜尋頁」；實際目標頁由設定頁決定（見設定 ②）。

5. **⚙ 進入設定頁**連結。

**從 popup 移除**：五項權重的勾選框與數值輸入（地區/白名單/團體/等級/花費）全部移到設定頁。

## 設定頁設計

設定頁（`options/`）需實作，包含五個區塊。設定變更沿用現有的即時寫入 `chrome.storage.sync` 機制。

### ① 計分權重 ＋ 最低限度

**計分權重（決定排序，分數高的先抽）** — 沿用現有五條規則，各自有啟用勾選框＋數值：
- 地區限制（預設值 100）
- 白名單（50）
- 團體（50）
- 等級 ×每級（20）
- 花費 ×0.1（1）

**最低限度（不符合就不抽）** — 新增：
- **最低分數門檻**：計算後分數低於此值不抽。
- **最低等級**：低於此等級不抽。
- **必須符合類型**：地區限制 / 白名單 / 團體 三個勾選框，加一個由使用者選的判定模式：
  - 「至少符合一項（OR）」（預設）
  - 「全部符合（AND）」
- 判定邏輯：一個 giveaway 要被抽，必須**同時**通過 ①分數門檻 ②等級門檻 ③類型規則；任一項未設定（門檻為空／類型都沒勾）則該項不檢查。通過後再依分數高低、依目前點數抽取。

### ② 前往 SteamGifts 目標頁

下拉選單，決定 popup「前往 SteamGifts」按鈕開啟的頁面：
- 願望清單搜尋頁（預設）
- 首頁
- 沿用已開的 SteamGifts 分頁（沒有才開）

### ③ 自動化開關（鏡像 popup）

把 popup 的兩個開關也放一份在設定頁，讓設定頁成為完整控制中心：自動計算分數、自動開始抽取。與 popup 共用同一份 storage 值。

### ④ 保留點數門檻

- 設定一個點數值，抽取時若剩餘點數低於此值就停止（現況是抽到沒點數為止）。預設 0（等於沿用現況）。

### ⑤ 資料

- 重置「累計加入」計數。
- 回復預設值（套用 `defaultSchema.json`）。

## 資料模型（chrome.storage.sync）

沿用現有鍵，新增：
- 現有：`restricted` / `whitelist` / `group` / `level` / `cost`（皆為 `{trigger, value}`）、`autoScore` / `autoStart`（`{trigger}`）、`totalEnterGiveaway`。
- 新增：
  - `minScore`：number（最低分數門檻，預設 0）
  - `minLevel`：number（最低等級，預設 0）
  - `requiredTypes`：`{ restricted: bool, whitelist: bool, group: bool, mode: "any" | "all" }`（預設皆 false、mode `"any"`）
  - `pointFloor`：number（保留點數門檻，預設 0）
  - `goLinkTarget`：`"wishlist" | "home" | "reuse"`（預設 `"wishlist"`）
  - `fullAutoWarned`：bool（第一次確認對話框是否已同意，預設 false）

`defaultSchema.json` 需補上以上新鍵的預設值。

## 抽取邏輯調整

`content_scripts/giveaway-core.js` / `autoStart.js` 的篩選步驟，在現有「可加入 + 點數足夠」之外，新增最低限度過濾：
- 分數 < `minScore` → 跳過
- 等級 < `minLevel` → 跳過
- `requiredTypes` 有勾選時，依 `mode`（any/all）判斷該列是否符合 → 不符合跳過
- 點數低於 `pointFloor` 時停止抽取

全自動願望清單按鈕：開啟願望清單搜尋頁後，注入與 `autoStart` 相同的抽取流程（不受 `autoStart` 開關影響，為手動觸發），完成後回報抽取數量並以 `chrome.notifications` 顯示「已自動抽取 N 件願望清單禮物」。

## 刻意不做（YAGNI）

抽取間隔調整、黑名單關鍵字、多帳號、排程。需要時再加。

## 範圍外確認事項

- i18n：新增的字串需同步補上 `_locales/en` 與 `_locales/zh_TW`。
- 本設計不更動 service worker 的開機通知與點數抓取機制，只在 popup 開啟時額外取一次點數。
