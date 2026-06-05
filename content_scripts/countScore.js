(() => {
  // 頂部推播禮物區，如果有比較多就打開顯示方便後續抓取（新版改用 pinned-giveaways-expand）
  const pinnedExpand = document.querySelector('.pinned-giveaways-expand[data-more]');
  if (pinnedExpand) pinnedExpand.click();
  // ^^^^^^^^^^^^ 頂部推播禮物區

  const giftElements = document.getElementsByClassName('giveaway__row-inner-wrap');

  chrome.storage.sync.get(["restricted", "whitelist", "group", "level", "cost"], function (config) {
    // 在每個禮物的 heading 上注入/更新分數 span
    function injectScore(element) {
      const total = window.GiveawayCore.calculateWeight(element, config);
      const span = element.querySelector('span.auto_steam-score') || document.createElement('span');
      span.className = 'auto_steam-score';
      span.innerText = `(Score:${total})`;
      const heading = element.querySelector('.giveaway__heading');
      if (heading && !span.parentNode) heading.appendChild(span);
      return total;
    }

    for (let i = 0; i < giftElements.length; i++) {
      injectScore(giftElements[i]);
    }

    chrome.runtime.sendMessage({ type: "countScoreEnd" });
  });
})();
