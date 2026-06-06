// 常駐：使用者逛任何 SteamGifts 頁面時，免費讀取點數與登入狀態寫入快取（不發請求）
(() => {
  const el = document.querySelector('.nav__points');
  const digits = el ? (el.textContent || '').replace(/[^0-9]/g, '') : '';
  if (digits === '') {
    chrome.storage.local.set({ loggedIn: false }); // 沒有點數區塊 = 未登入
    return;
  }
  chrome.storage.local.set({ currentPoint: Number(digits), pointUpdatedAt: Date.now(), loggedIn: true });
})();
