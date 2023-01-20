(() => {
  if(document.querySelector('.pinned-giveaways__button')) document.querySelector('.pinned-giveaways__button').click();

  let closeScript = document.createElement('script');
  const items = [];
  const els = document.getElementsByClassName('giveaway__row-inner-wrap');
  let timer;
  let entryGiveaway = 0;

  closeScript.innerHTML = 'window.close()';
  for(let i = 0 ; i < els.length ; i++) {
    if(!els[i].classList.contains('is-faded')){
      items.push(els[i]);
    }
  }

  function clickPageGift(giftDom) {
    giftDom.parentNode.style.backgroundColor = '#ff01';
    const linkEl = giftDom.querySelector('.giveaway__heading__name');
    const itemWindow = window.open(linkEl.href, linkEl.innerText, 'width=400,height=400,top=100,left=100');
    console.log(giftDom.getBoundingClientRect().top);
    window.scrollBy({
      top: giftDom.getBoundingClientRect().top - (Math.random() * 200) - 100,
      behavior: "smooth"
    })

    itemWindow.addEventListener('load', (e) => {
      const windowDom = e.target;

      if(windowDom.querySelector('div[data-do="entry_insert"]')) windowDom.querySelector('div[data-do="entry_insert"]').click();

      checkGiftState(windowDom, giftDom).then(() => {
        entryGiveaway++;
      }).catch(() => {}).finally(() => {
        setTimeout(() => {
          checkDone(activeAvailableGiftInstance.next());
        }, Math.floor(Math.random() * 1500) + 500);
      });
    })
  }

  function checkGiftState(pageDom, parentWindow) {
    return new Promise((resolve, reject) => {
      timer = setInterval(() => {
        if(!pageDom.querySelector('div[data-do="entry_insert"]')) {
          parentWindow.querySelector('.giveaway__heading__name').innerHTML += '<span style="color:red;"> (Enter Giveaway Fail)</span>';
          parentWindow.classList.add('is-faded');
          parentWindow.parentNode.style.backgroundColor = '#f001';
          reject('沒點數');
          clearInterval(timer);
          pageDom.querySelector('body').appendChild(closeScript.cloneNode(true));

        } else if(pageDom.querySelector('div[data-do="entry_insert"]').classList.contains('is-hidden')) {
          parentWindow.querySelector('.giveaway__heading__name').innerHTML += '<span style="color:green;"> (Enter Giveaway)</span>';
          parentWindow.classList.add('is-faded');
          parentWindow.parentNode.style.backgroundColor = '#0ff1';
          clearInterval(timer);
          resolve('有點數');
          pageDom.querySelector('body').appendChild(closeScript.cloneNode(true));
        }
      }, 1000);
    })
  }

  function* activeAvailableGift(availableGifts){
    for(let i = 0; i < availableGifts.length; i++) {
      yield clickPageGift(availableGifts[i]);
    }
  }

  function checkDone(yieldObj = {}) {
    if(yieldObj.done) {
      alert(`Enter Giveaway:${entryGiveaway}`);
    }
  }

  const activeAvailableGiftInstance = activeAvailableGift(items);

  checkDone(activeAvailableGiftInstance.next());
})();