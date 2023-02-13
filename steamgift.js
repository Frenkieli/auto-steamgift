(() => {
  // 頂部推播禮物區，如果有比較多就打開顯示方便後許抓取
  if(document.querySelector('.pinned-giveaways__button')) document.querySelector('.pinned-giveaways__button').click();
  // ^^^^^^^^^^^^ 頂部推播禮物區，如果有比較多就打開顯示方便後許抓取

  // 用來變更 giftCard 的組件 UI
  const CARD_TEXT = {
    Enter: '(Enter Giveaway)',
    Fail: '(Enter Giveaway Fail)',
    NotEnough: '(Not Enough Point)'
  }
  const CARD_STATE = {
    Success: {
      textColor: 'green',
      bgColor: '#0ff1',
    },
    Fail: {
      textColor: 'red',
      bgColor: '#f001',
    }
  }

  function giftCardUiChange({
    cardElement,
    text,
    textColor,
    bgColor,
  }) {
    cardElement.querySelector('.giveaway__heading__name').innerHTML += ` <span style="color:${textColor};">${text}</span>`;
    cardElement.classList.add('is-faded');
    cardElement.parentNode.style.backgroundColor = bgColor;
  }

  // 用來整理、排序和計算可以加入的禮物
  const rowGiftElements = document.getElementsByClassName('giveaway__row-inner-wrap');
  const giftElements = [];
  let countEntryGift = 0;

  for(const rowGiftElement of rowGiftElements) {
    if(!rowGiftElement.classList.contains('is-faded')){
      giftElements.push(rowGiftElement);
    }
  }

  // 依照每個禮物擁有的條件計算抽取禮遇的權重
  function calculateWeight(element, addSpan) {
    const restricted = element.querySelector('.giveaway__column--region-restricted') ? 100 : 0;
    const whitelist = element.querySelector('.giveaway__column--whitelist')? 50 : 0;
    const group = element.querySelector('.giveaway__column--group')? 50 : 0;
    const cost = element.querySelector('.giveaway__heading__thin').innerText.replace(/[^0-9]/g, '') * 0.1;
    const levelEl = element.querySelector('.giveaway__column--contributor-level');
    let level = 0;
    if(levelEl) {
      level += levelEl.innerText.replace(/[^0-9]/g, '') * 20;
    }
    const total = restricted +  whitelist +  group +  level + cost;
    
    if(addSpan) {
      const span = element.querySelector('span.giveaway__heading__thin.score') || document.createElement('span');
      span.className = 'giveaway__heading__thin score';
      span.innerText = `(Score:${total})`;
      element.querySelector('.giveaway__heading').appendChild(span);
    }

    return total;
  }

  giftElements.sort((a, b) => (calculateWeight(b, true) - calculateWeight(a)));

  let myPoint = Number(document.querySelector('.nav__points').innerText);

  // 計算點數夠不夠用，不夠用的直接篩掉打上點數不構
  let readyToEnterGiftElements = giftElements.filter(giftElement => {
    let cost = giftElement.querySelectorAll('.giveaway__heading__thin:not(.score)')[giftElement.querySelectorAll('.giveaway__heading__thin:not(.score)').length - 1].innerText.replace(/[^0-9]/g, '');
    
    if(myPoint >= cost) {
      myPoint = myPoint - cost;

      return true;
    } else {
      giftCardUiChange({
        cardElement: giftElement,
        text: CARD_TEXT.NotEnough,
        ...CARD_STATE.Fail
      });
      return false;
    }
  })
  // ^^^^^^^^^^^^ 用來整理、排序和計算可以加入的禮物

  // 用來將以抽取篩選好的禮物
  function clickAvailableGift(giftElement) {
    giftElement.parentNode.style.backgroundColor = '#ff01';
    const linkEl = giftElement.querySelector('.giveaway__heading__name');
    const giftPageWindow = window.open(linkEl.href, linkEl.innerText, 'width=1000,height=600,top=100');
 
    window.scrollBy({
      top: giftElement.getBoundingClientRect().top - (Math.random() * 200) - 100,
      behavior: "smooth"
    })

    giftPageWindow.addEventListener('load', () => {
      let giftPageDocument = giftPageWindow.document;
      if(giftPageDocument.querySelector('div[data-do="entry_insert"]')) giftPageDocument.querySelector('div[data-do="entry_insert"]').click();

      checkGiftPageState(giftPageWindow, giftElement).then(() => {
        countEntryGift++;
        giftCardUiChange({
          cardElement: giftElement,
          text: CARD_TEXT.Enter,
          ...CARD_STATE.Success
        });
      }).catch(() => {
        giftCardUiChange({
          cardElement: giftElement,
          text: CARD_TEXT.Fail,
          ...CARD_STATE.Fail
        });
      }).finally(() => {
        setTimeout(() => {
          checkAvailableGiftDone(enterAvailableGiftInstance.next());
        }, Math.floor(Math.random() * 500));
      });
    })
  }
  // ^^^^^^^^^^^^ 用來將以抽取篩選好的禮物

  // 因為沒辦法確認加入到完成會多久所以需要定時檢查
  let checkGiftPageStateTimer;
  function checkGiftPageState(pageWindow) {
    return new Promise((resolve, reject) => {
      checkGiftPageStateTimer = setInterval(() => {
        // 當無法抽取禮物等狀況出現的時候 entry_insert 的 element 會不存在
        if(!pageWindow.document.querySelector('div[data-do="entry_insert"]')) {
          reject('沒點數');
          clearInterval(checkGiftPageStateTimer);
          pageWindow.close();
        // 當該獎品狀況正常，被典籍後那個按鈕隱藏的時候代表正確抽取
        } else if(pageWindow.document.querySelector('div[data-do="entry_insert"]').classList.contains('is-hidden')) {
          resolve('有點數');
          clearInterval(checkGiftPageStateTimer);
          pageWindow.close();
        }
      }, 600);
    })
  }
  // ^^^^^^^^^^^^ 因為沒辦法確認加入到完成會多久所以需要定時檢查

  // 建立一個 yield function 來慢慢執行每一個加入程序
  function* enterAvailableGift(readyToEnterGiftElements){
    for(let readyToEnterGiftElement of readyToEnterGiftElements) {
      yield clickAvailableGift(readyToEnterGiftElement);
    }
  }
  // ^^^^^^^^^^^^ 建立一個 yield function 來慢慢執行每一個加入程序

  // 用來判斷是否抽完所有禮物
  function checkAvailableGiftDone(enterAvailableGiftYield) {
    if(enterAvailableGiftYield.done) {
      alert(`Enter Giveaway:${countEntryGift}`);
    }
  }
  // ^^^^^^^^^^^^ 用來判斷是否抽完所有禮物

  const enterAvailableGiftInstance = enterAvailableGift(readyToEnterGiftElements);

  checkAvailableGiftDone(enterAvailableGiftInstance.next());
})();