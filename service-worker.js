chrome.runtime.onInstalled.addListener(function(details){
  if(details.reason == "install"){
    fetch("defaultSchema.json").then(function (res) {
      return res.json();
    }).then(function (data) {
      chrome.storage.sync.set(data);
    })
  }else if(details.reason == "update"){
    chrome.storage.sync.get(["autoScore"], function(config) {
      if(config.autoScore.trigger) {
        registerCountScoreContentScripts();
      }
    })
  }
});
// ^^^^^^^^^^ 安裝基本資料

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.sync.get(["autoScore"], function(config) {
    if(config.autoScore.trigger) {
      registerCountScoreContentScripts();
    }
  })

  fetch('https://www.steamgifts.com/').then(res=>res.text()).then(htmlText=>{
    const regex = /<span class="nav__points">(\d+)<\/span>/;
    const match = htmlText.match(regex);
    const point = match ? parseInt(match[1]) : null;
    chrome.notifications.clear(NOTIFICATION_TYPE.CurrentPoint);

    chrome.notifications.create(
      NOTIFICATION_TYPE.CurrentPoint, {
        type: 'basic',
        iconUrl: "icons/logo.png",
        title: chrome.i18n.getMessage("extName"),
        contextMessage: `你目前的點數為:${point}`,
        message: "立即前往 SteamGift 網站",
        eventTime: new Date().getTime() + 60000,
        isClickable: true
      }
    )
  })
});
// ^^^^^^^^^^ 遊覽器開啟觸發

chrome.storage.onChanged.addListener((changes, areaName) => {
  if((areaName === "autoScore" || areaName === "sync") && changes.autoScore) {
    if(changes.autoScore.newValue.trigger) {
      registerCountScoreContentScripts();
    } else {
      chrome.scripting
      .unregisterContentScripts({ ids: ["countScore-script"] });
    }
  }

  if(!(Object.keys(changes).length === 1 &&  changes.totalEnterGiveaway)) {
    // 更新重整網站
    chrome.tabs.query({url: "https://www.steamgifts.com/*"}, function (tabs){
      tabs.forEach(tab => {
        chrome.tabs.reload(tab.id,);
      });
    });
  }
})
// ^^^^^^^^^^ 動態插入計算分數用的 js

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "countScoreEnd": {
      chrome.storage.sync.get(["autoStart"], function(config) {
        if(config.autoStart.trigger) {
          injectAutoScript(sender.tab.id);
        }
      });
      break;
    }

    case "setBadgeText": {
      chrome.action.setBadgeText({
        tabId: sender.tab.id,
        text: message.text
      });

      chrome.action.setBadgeBackgroundColor({
        color: "#583628"
      });
      break;
    }
    default:
      break;
  }
})
// ^^^^^^^^^^ 接收資訊

const NOTIFICATION_TYPE = {
  CurrentPoint: 'CurrentPoint'
};

const notificationsEvent = {
  [NOTIFICATION_TYPE.CurrentPoint]: () => {
    var newURL = "https://www.steamgifts.com/giveaways/search?type=wishlist";
    chrome.tabs.create({ url: newURL });
  }
};

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
  notificationsEvent[notificationId]();
})

// ^^^^^^^^^^ 當通知被點選
function injectAutoScript (tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: ["content_scripts/autoStart.js"]
  });
}

function registerCountScoreContentScripts () {
  chrome.scripting
  .registerContentScripts([{
    id: "countScore-script",
    css: ["content_scripts/countScore.css"],
    js: ["content_scripts/countScore.js"],
    persistAcrossSessions: false,
    excludeMatches: ["https://www.steamgifts.com/giveaway/*", "https://www.steamgifts.com/user/*", "https://www.steamgifts.com/stats/*"],
    matches: ["https://www.steamgifts.com/*"],
    runAt: "document_idle",
  }]);
}
// ^^^^^^^^^^ 放置各種呼叫 method
