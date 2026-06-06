# auto_steamgift
點擊後自動抽 steam gift 該頁面的獎品

有書籤版本和 google extension 版本

## 更新紀錄

- v1.1：改用 SteamGifts 新版列表頁的 inline quick-entry 按鈕（`giveaway__quick-entry-btn--insert`）直接抽獎，移除舊的開新分頁（`window.open`）流程。

- v1.2：支援「需先看說明」(description) 才能加入的抽獎 — 背景全自動會先送出 `giveaway_description` 再加入；頁面內自動加入會先點開說明解鎖再點擊加入。