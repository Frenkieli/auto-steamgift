// 常駐：使用者逛任何 SteamGifts 頁面時，免費讀取目前點數寫入快取（不發請求）
(() => {
  const el = document.querySelector('.nav__points');
  if (!el) return;
  const digits = (el.textContent || '').replace(/[^0-9]/g, '');
  if (digits === '') return; // 空字串（未登入/尚未渲染）不要覆寫成 0
  chrome.storage.local.set({ currentPoint: Number(digits), pointUpdatedAt: Date.now() });
})();
