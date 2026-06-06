let fullAutoRunning = false;

const FULL_AUTO_CFG_KEYS = [
  "restricted", "whitelist", "group", "level", "cost",
  "minScore", "minLevel", "requiredTypes", "pointFloor"
];

const HOME_URL = "https://www.steamgifts.com/";
const POINT_TTL_MS = 6 * 60 * 60 * 1000; // 6 小時

// 寫入點數快取（供免費更新來源使用）
function storePoints(point) {
  chrome.storage.local.set({ currentPoint: point, pointUpdatedAt: Date.now() });
}

// 過期才抓：距上次更新 < 6h 就用快取、不發請求
function refreshPointsIfStale({ notify }) {
  chrome.storage.local.get(["pointUpdatedAt"], (cache) => {
    const updatedAt = cache.pointUpdatedAt || 0;
    if (Date.now() - updatedAt < POINT_TTL_MS) return;

    fetch(HOME_URL, { credentials: "include" })
      .then((res) => res.text())
      .then((html) => {
        const match = html.match(/<span class="nav__points">(\d+)<\/span>/);
        if (!match) return;
        const point = Number(match[1]);
        storePoints(point);
        if (notify) {
          chrome.notifications.clear(NOTIFICATION_TYPE.CurrentPoint);
          chrome.notifications.create(NOTIFICATION_TYPE.CurrentPoint, {
            type: 'basic',
            iconUrl: "icons/logo.png",
            title: chrome.i18n.getMessage("extName"),
            contextMessage: `你目前的點數為:${point}`,
            message: "立即前往 SteamGift 網站",
            eventTime: new Date().getTime() + 60000,
            isClickable: true
          });
        }
      })
      .catch(() => {});
  });
}

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (!has) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DOM_PARSER"],
      justification: "Fetch and parse the SteamGifts wishlist to auto-enter giveaways in the background."
    });
  }
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

  refreshPointsIfStale({ notify: true });
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

  // 只有設定（sync）變更才需要重整頁面；點數快取等 local 變更不可觸發 reload，
  // 否則 readPoints 每次載入就寫 local → onChanged → reload → 無限迴圈。
  if (areaName !== "sync") return;

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
      chrome.storage.sync.get(["autoStart"], function (config) {
        if (config.autoStart.trigger) {
          injectAutoScript(sender.tab.id);
        }
      });
      break;
    }

    case "refreshPointsIfStale": {
      refreshPointsIfStale({ notify: false });
      break;
    }

    case "fullAutoWishlist": {
      if (fullAutoRunning) break;
      fullAutoRunning = true;
      // offscreen 文件拿不到 chrome.storage，所以由 SW 讀設定後用訊息帶過去
      chrome.storage.sync.get(FULL_AUTO_CFG_KEYS, (cfg) => {
        ensureOffscreen()
          .then(() => chrome.runtime.sendMessage({ type: "runFullAuto", cfg }))
          .catch(() => { fullAutoRunning = false; });
      });
      break;
    }

    case "fullAutoResult": {
      fullAutoRunning = false;
      if (message.point != null) storePoints(message.point);
      if (message.count > 0) {
        chrome.storage.sync.get(["totalEnterGiveaway"], (c) => {
          chrome.storage.sync.set({ totalEnterGiveaway: (c.totalEnterGiveaway || 0) + message.count });
        });
      }
      chrome.notifications.create({
        type: 'basic',
        iconUrl: "icons/logo.png",
        title: chrome.i18n.getMessage("extName"),
        message: chrome.i18n.getMessage("notifyFullAutoDone", [String(message.count)])
      });
      chrome.offscreen.closeDocument().catch(() => {});
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
