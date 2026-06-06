chrome.storage.sync.get(["minScore", "minLevel", "requiredTypes", "pointFloor"], function (cfg) {
  setTimeout(() => {
    if (!document.querySelector('.nav__points')) return; // 未登入則不自動加入
    // 用來變更 giftCard 的組件 UI
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

    const core = window.GiveawayCore;
    const human = window.Humanize;
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    // 派發基本 hover 事件（客戶端便宜保險）
    function hover(el) {
      ['mouseover', 'mousemove', 'mouseenter'].forEach((type) =>
        el.dispatchEvent(new MouseEvent(type, { bubbles: true })));
    }

    const minConfig = {
      minScore: cfg.minScore,
      minLevel: cfg.minLevel,
      requiredTypes: cfg.requiredTypes
    };
    const pointFloor = Number(cfg.pointFloor) || 0;

    // 1) 收集可加入且通過最低限度的禮物，依分數由高到低排序
    const giftElements = [...document.getElementsByClassName('giveaway__row-inner-wrap')]
      .filter((row) => core.isEnterable(row) && core.passesMinimum(row, minConfig));

    giftElements.sort((a, b) => core.getScore(b) - core.getScore(a));

    // 2) 依目前點數篩選，扣完不能低於保留點數門檻
    const pointsEl = document.querySelector('.nav__points');
    let myPoint = pointsEl ? Number(pointsEl.innerText) : 0;
    let countEntryGift = 0;

    const readyToEnterGiftElements = giftElements.filter((row) => {
      const cost = core.parsePointCost(row) || 0;
      if (myPoint - cost >= pointFloor) {
        myPoint -= cost;
        return true;
      }
      giftCardUiChange({ cardElement: row, text: CARD_TEXT.NotEnough, ...CARD_STATE.Fail });
      return false;
    });

    // 若該列因「需先看說明」而 is-locked，點開 description 按鈕並等待解鎖
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
        hover(descBtn);
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

    // 3) 需要時先解鎖（看說明），讀完描述、捲動、hover 後再點擊；輪詢該列是否變成 is-faded（代表抽取成功）
    async function enterGiveaway(row) {
      await unlockIfNeeded(row);

      // 點開描述後的閱讀停留（gated 才會有 description-panel，它是 row-inner-wrap 的兄弟節點）
      const panel = row.parentNode.querySelector('.giveaway__description-panel');
      if (panel) await delay(human.readingDelayMs((panel.textContent || '').length));

      const insertBtn = row.querySelector('.giveaway__quick-entry-btn--insert');
      if (!insertBtn || insertBtn.classList.contains('is-locked')) throw new Error('not enterable');

      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(300 + Math.floor(Math.random() * 500)); // 捲動後停頓
      row.parentNode.style.backgroundColor = '#ff01';
      hover(insertBtn);
      await delay(200 + Math.floor(Math.random() * 400)); // hover 後停頓
      insertBtn.click();

      return new Promise((resolve, reject) => {
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

    // 4) 逐一抽取，每次之間留一點隨機間隔
    async function enterAll(list) {
      for (const row of list) {
        try {
          await enterGiveaway(row);
          countEntryGift++;
          chrome.runtime.sendMessage({ type: "setBadgeText", text: String(countEntryGift) });
          chrome.storage.sync.get(["totalEnterGiveaway"], function (config) {
            const total = ((config.totalEnterGiveaway || 0) * 1) + 1;
            chrome.storage.sync.set({ totalEnterGiveaway: total });
          });
          giftCardUiChange({ cardElement: row, text: CARD_TEXT.Enter, ...CARD_STATE.Success });
        } catch (e) {
          giftCardUiChange({ cardElement: row, text: CARD_TEXT.Fail, ...CARD_STATE.Fail });
        }
        await delay(human.humanDelayMs());
        const breakMs = human.maybeBreakMs();
        if (breakMs) await delay(breakMs);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      chrome.runtime.sendMessage({ type: "autoEnterDone", count: countEntryGift });
    }

    enterAll(readyToEnterGiftElements);
  }, 2000 + Math.floor(Math.random() * 8000)); // 抵達延遲：頁面載入後 2–10 秒才開始
});
