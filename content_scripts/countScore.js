(() => {
  // 頂部推播禮物區，如果有比較多就打開顯示方便後許抓取
  if(document.querySelector('.pinned-giveaways__button')) document.querySelector('.pinned-giveaways__button').click();
  // ^^^^^^^^^^^^ 頂部推播禮物區，如果有比較多就打開顯示方便後許抓取

  const giftElements = document.getElementsByClassName('giveaway__row-inner-wrap');

  chrome.storage.sync.get(["restricted", "whitelist", "group", "level", "cost"], function(config) {
    const {
      restricted: restrictedConfig,
      whitelist: whitelistConfig,
      group: groupConfig,
      level: levelConfig,
      cost: costConfig
    } = config;

    // 依照每個禮物擁有的條件計算抽取禮遇的權重
    function calculateWeight(element, addSpan) {
      const restricted = restrictedConfig.trigger && element.querySelector('.giveaway__column--region-restricted') ? restrictedConfig.value * 1 : 0;
      const whitelist = whitelistConfig.trigger && element.querySelector('.giveaway__column--whitelist')? whitelistConfig.value * 1 : 0;
      const group = groupConfig.trigger && element.querySelector('.giveaway__column--group')? groupConfig.value * 1 : 0;
      const cost = costConfig.trigger && element.querySelector('.giveaway__heading__thin') && element.querySelectorAll('.giveaway__heading__thin')[element.querySelectorAll('.giveaway__heading__thin').length - 1].innerText.replace(/[^0-9]/g, '') * 0.1 * costConfig.value;
      const levelRow = levelConfig.trigger && element.querySelector('.giveaway__column--contributor-level') && element.querySelector('.giveaway__column--contributor-level').innerText.replace(/[^0-9]/g, '');
      let level = 0;
      if(levelRow) {
        level += levelRow * levelConfig.value;
      }
      const total = Math.round((restricted +  whitelist +  group +  level + cost) * 1000) / 1000;
      
      if(addSpan) {
        const span = element.querySelector('span.auto_steam-score') || document.createElement('span');
        span.className = 'auto_steam-score';
        span.innerText = `(Score:${total})`;
        element.querySelector('.giveaway__heading').appendChild(span);
      }

      return total;
    }

    for(let i = 0; i < giftElements.length ; i++) {
      calculateWeight(giftElements[i], true);
    }

    chrome.runtime.sendMessage({type: "countScoreEnd"});
  });
})();
