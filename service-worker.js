const fullAutoTabs = new Set();

function openWishlistTab(callback) {
  const url = "https://www.steamgifts.com/giveaways/search?type=wishlist";
  chrome.tabs.query({ url: "https://www.steamgifts.com/*" }, (tabs) => {
    if (tabs.length > 0) {
      const existing = tabs[0];
      const alreadyThere = !!existing.url && existing.url.split('#')[0] === url;
      chrome.tabs.update(existing.id, { url, active: true }, (tab) => callback(tab.id, alreadyThere));
    } else {
      chrome.tabs.create({ url }, (tab) => callback(tab.id, false));
    }
  });
}

function injectFullAuto(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "content_scripts/giveaway-core.js",
      "content_scripts/countScore.js",
      "content_scripts/autoStart.js"
    ]
  }).catch(() => { fullAutoTabs.delete(tabId); });
}

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

  const NO_RELOAD_KEYS = ["totalEnterGiveaway", "fullAutoWarned", "goLinkTarget"];
  const onlyCosmetic = Object.keys(changes).every((k) => NO_RELOAD_KEYS.includes(k));
  if(!onlyCosmetic) {
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
      // full-auto tabs already inject autoStart themselves — don't double-inject
      if (sender.tab && fullAutoTabs.has(sender.tab.id)) break;
      chrome.storage.sync.get(["autoStart"], function (config) {
        if (config.autoStart.trigger) {
          injectAutoScript(sender.tab.id);
        }
      });
      break;
    }

    case "autoEnterDone": {
      if (sender.tab && fullAutoTabs.has(sender.tab.id)) {
        fullAutoTabs.delete(sender.tab.id);
        chrome.notifications.create({
          type: 'basic',
          iconUrl: "icons/logo.png",
          title: chrome.i18n.getMessage("extName"),
          message: chrome.i18n.getMessage("notifyFullAutoDone", [String(message.count)])
        });
      }
      break;
    }

    case "fullAutoWishlist": {
      // NOTE: fullAutoTabs is in-memory. If the MV3 worker suspends mid-flow the
      // tracking is lost and the completion notification may not fire — acceptable
      // at single-user scale (worst case: the user clicks again).
      openWishlistTab((tabId, alreadyThere) => {
        fullAutoTabs.add(tabId);
        let injected = false;
        const run = () => {
          if (injected) return;
          injected = true;
          chrome.tabs.onUpdated.removeListener(listener);
          injectFullAuto(tabId);
        };
        const listener = (updatedId, info) => {
          if (updatedId === tabId && info.status === "complete") run();
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Same-URL reuse fires no fresh "complete" — inject if the tab is already loaded.
        if (alreadyThere) {
          chrome.tabs.get(tabId, (tab) => {
            if (!chrome.runtime.lastError && tab && tab.status === "complete") run();
          });
        }
      });
      break;
    }

    case "setBadgeText": {
      chrome.action.setBadgeText({ tabId: sender.tab.id, text: message.text });
      chrome.action.setBadgeBackgroundColor({ color: "#583628" });
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
    files: ["content_scripts/giveaway-core.js", "content_scripts/autoStart.js"]
  });
}

function registerCountScoreContentScripts () {
  chrome.scripting
  .registerContentScripts([{
    id: "countScore-script",
    css: ["content_scripts/countScore.css"],
    js: ["content_scripts/giveaway-core.js", "content_scripts/countScore.js"],
    persistAcrossSessions: false,
    excludeMatches: ["https://www.steamgifts.com/giveaway/*", "https://www.steamgifts.com/user/*", "https://www.steamgifts.com/stats/*"],
    matches: ["https://www.steamgifts.com/*"],
    runAt: "document_idle",
  }]);
}
// ^^^^^^^^^^ 放置各種呼叫 method
