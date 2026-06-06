(() => {
  // 頂部推播禮物區（新版改用 pinned-giveaways-expand）
  const pinnedExpand = document.querySelector('.pinned-giveaways-expand[data-more]');
  if (pinnedExpand) pinnedExpand.click();

  const CARD_TEXT = {
    Enter: '(Enter Giveaway)',
    Fail: '(Enter Giveaway Fail)',
    NotEnough: '(Not Enough Point)'
  };
  const CARD_STATE = {
    Success: { textColor: 'green', bgColor: '#0ff1' },
    Fail: { textColor: 'red', bgColor: '#f001' }
  };

  function giftCardUiChange({ cardElement, text, textColor, bgColor }) {
    cardElement.querySelector('.giveaway__heading__name').innerHTML += ` <span style="color:${textColor};">${text}</span>`;
    cardElement.classList.add('is-faded');
    cardElement.parentNode.style.backgroundColor = bgColor;
  }

  // 內嵌版的評分（書籤版自帶權重，無設定檔）
  function parsePointCost(row) {
    const thins = row.querySelectorAll('.giveaway__heading__thin');
    for (let i = thins.length - 1; i >= 0; i--) {
      const m = (thins[i].textContent || '').match(/\((\d+)P\)/);
      if (m) return Number(m[1]);
    }
    return null;
  }
  function isEnterable(row) {
    if (row.classList.contains('is-faded')) return false;
    const insert = row.querySelector('.giveaway__quick-entry-btn--insert');
    if (!insert) return false;
    if (!insert.classList.contains('is-locked')) return true;
    return !!row.querySelector('.giveaway__quick-entry-btn--description');
  }
  function calculateWeight(row) {
    const restricted = row.querySelector('.giveaway__column--region-restricted') ? 100 : 0;
    const levelEl = row.querySelector('.giveaway__column--contributor-level');
    const level = levelEl ? (Number((levelEl.textContent || '').replace(/[^0-9]/g, '')) || 0) * 20 : 0;
    const cost = (parsePointCost(row) || 0) * 0.1;
    return restricted + level + cost;
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  const giftElements = [...document.getElementsByClassName('giveaway__row-inner-wrap')]
    .filter(isEnterable);
  giftElements.sort((a, b) => calculateWeight(b) - calculateWeight(a));

  let myPoint = Number(document.querySelector('.nav__points').innerText);
  let countEntryGift = 0;

  const readyToEnterGiftElements = giftElements.filter((row) => {
    const cost = parsePointCost(row) || 0;
    if (myPoint >= cost) {
      myPoint -= cost;
      return true;
    }
    giftCardUiChange({ cardElement: row, text: CARD_TEXT.NotEnough, ...CARD_STATE.Fail });
    return false;
  });

  function unlockIfNeeded(row) {
    return new Promise((resolve, reject) => {
      const insertBtn = row.querySelector('.giveaway__quick-entry-btn--insert');
      if (insertBtn && !insertBtn.classList.contains('is-locked')) {
        resolve();
        return;
      }
      const descBtn = row.querySelector('.giveaway__quick-entry-btn--description');
      if (!insertBtn || !descBtn) {
        reject(new Error('locked, no description'));
        return;
      }
      descBtn.click();
      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        if (!insertBtn.classList.contains('is-locked')) {
          clearInterval(timer);
          resolve();
        } else if (tries > 12) {
          clearInterval(timer);
          reject(new Error('unlock timeout'));
        }
      }, 500);
    });
  }

  async function enterGiveaway(row) {
    await unlockIfNeeded(row);
    return new Promise((resolve, reject) => {
      const insertBtn = row.querySelector('.giveaway__quick-entry-btn--insert');
      if (!insertBtn || insertBtn.classList.contains('is-locked')) {
        reject(new Error('not enterable'));
        return;
      }
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.parentNode.style.backgroundColor = '#ff01';
      insertBtn.click();

      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        if (row.classList.contains('is-faded')) {
          clearInterval(timer);
          resolve();
        } else if (insertBtn.classList.contains('is-locked')) {
          clearInterval(timer);
          reject(new Error('locked after click'));
        } else if (tries > 12) {
          clearInterval(timer);
          reject(new Error('timeout'));
        }
      }, 500);
    });
  }

  async function enterAll(list) {
    for (const row of list) {
      try {
        await enterGiveaway(row);
        countEntryGift++;
        giftCardUiChange({ cardElement: row, text: CARD_TEXT.Enter, ...CARD_STATE.Success });
      } catch (e) {
        giftCardUiChange({ cardElement: row, text: CARD_TEXT.Fail, ...CARD_STATE.Fail });
      }
      await delay(Math.floor(Math.random() * 500));
    }
    alert(`Enter Giveaway:${countEntryGift}`);
  }

  enterAll(readyToEnterGiftElements);
})();
