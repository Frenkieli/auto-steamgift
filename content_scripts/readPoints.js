// 常駐：使用者逛任何 SteamGifts 頁面時，免費讀取目前點數寫入快取（不發請求）
(() => {
  const el = document.querySelector('.nav__points');
  if (!el) return;
  const point = Number((el.textContent || '').replace(/[^0-9]/g, ''));
  if (Number.isNaN(point)) return;
  chrome.storage.local.set({ currentPoint: point, pointUpdatedAt: Date.now() });
})();
