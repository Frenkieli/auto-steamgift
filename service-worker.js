importScripts('lib/serial-counter.js');
importScripts('content_scripts/humanize.js');

// 序列化計數器：所有計數寫入都經由單一 SW 串行化，杜絕多分頁同時 +1 的競態。
const joinCounter = self.SerialCounter.createSerialCounter({
  get: (key) => new Promise((res) => chrome.storage.local.get([key], (o) => res(o[key] || 0))),
  set: (key, value) => new Promise((res) => chrome.storage.local.set({ [key]: value }, res)),
});
const totalCounter = self.SerialCounter.createSerialCounter({
  get: (key) => new Promise((res) => chrome.storage.sync.get([key], (o) => res(o[key] || 0))),
  set: (key, value) => new Promise((res) => chrome.storage.sync.set({ [key]: value }, res)),
});

let fullAutoRunning = false;

const FULL_AUTO_CFG_KEYS = [
  "restricted", "whitelist", "group", "level", "cost",
  "minScore", "minLevel", "requiredTypes", "pointFloor"
];

const HOME_URL = "https://www.steamgifts.com/";
const WISHLIST_URL = "https://www.steamgifts.com/giveaways/search?type=wishlist";
const POINT_TTL_MS = 6 * 60 * 60 * 1000; // 6 小時

// 安全模式：開或聚焦願望清單分頁（頁內擬人化 autoStart 會處理加入）
function openWishlistTab() {
  chrome.tabs.query({ url: "https://www.steamgifts.com/giveaways/search?type=wishlist*" }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.tabs.reload(tabs[0].id);
    } else {
      chrome.tabs.create({ url: WISHLIST_URL });
    }
  });
}

// 寫入點數快取（供免費更新來源使用）
function storePoints(point) {
  chrome.storage.local.set({ currentPoint: point, pointUpdatedAt: Date.now() });
}

// 實際抓首頁、解析點數、寫入 loggedIn/點數。回傳 Promise<true|false|null>
// true=已登入, false=抓到但未登入, null=fetch 失敗(不可改動 loggedIn)
function fetchAndStorePoints({ notify }) {
  return fetch(HOME_URL, { credentials: "include" })
    .then((res) => res.text())
    .then((html) => {
      const match = html.match(/<span class="nav__points">(\d+)<\/span>/);
      if (!match) {
        chrome.storage.local.set({ loggedIn: false });
        return false;
      }
      const point = Number(match[1]);
      chrome.storage.local.set({ currentPoint: point, pointUpdatedAt: Date.now(), loggedIn: true });
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
      return true;
    })
    .catch(() => null);
}

// 過期才抓：距上次更新 < 6h 就用快取、不發請求
function refreshPointsIfStale({ notify }) {
  chrome.storage.local.get(["pointUpdatedAt"], (cache) => {
    const updatedAt = cache.pointUpdatedAt || 0;
    if (Date.now() - updatedAt < POINT_TTL_MS) return;
    fetchAndStorePoints({ notify });
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
      if(config.autoScore && config.autoScore.trigger) {
        registerCountScoreContentScripts();
      }
    })
  }
});
// ^^^^^^^^^^ 安裝基本資料

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.sync.get(["autoScore"], function(config) {
    if(config.autoScore && config.autoScore.trigger) {
      registerCountScoreContentScripts();
    }
  })

  refreshPointsIfStale({ notify: true });
});
// ^^^^^^^^^^ 遊覽器開啟觸發

chrome.storage.onChanged.addListener((changes, areaName) => {
  if(areaName === "sync" && changes.autoScore) {
    if(changes.autoScore.newValue && changes.autoScore.newValue.trigger) {
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
        if (config.autoStart && config.autoStart.trigger) {
          injectAutoScript(sender.tab.id);
        }
      });
      break;
    }

    case "forceLoginCheck": {
      // 使用者主動觸發，繞過 6h 閘門，抓一次並回報結果
      fetchAndStorePoints({ notify: false }).then((loggedIn) => sendResponse({ loggedIn }));
      return true; // 非同步回應，保持訊息通道開啟
    }

    case "refreshPointsIfStale": {
      refreshPointsIfStale({ notify: false });
      break;
    }

    case "fullAutoWishlist": {
      chrome.storage.sync.get([...FULL_AUTO_CFG_KEYS, "aggressiveMode", "activeHours", "humanizeConfig"], (cfg) => {
        const aggressive = !!(cfg.aggressiveMode && cfg.aggressiveMode.trigger);
        if (!aggressive) {
          openWishlistTab(); // 安全模式：開願望清單分頁，由頁內擬人化 autoStart 處理
          return;
        }
        // 激進模式：背景 offscreen，受活躍時段與每日預算限制
        const ah = cfg.activeHours || { start: 600, end: 120 };
        if (!self.Humanize.inActiveHours(new Date(), ah.start, ah.end)) return; // 非活躍時段不跑
        if (fullAutoRunning) return;
        // 同步搶佔旗標：兩則快速接連的訊息中，先到者在此回呼同步執行完才輪到後者，
        // 後者會看到旗標已為 true 而退出，杜絕並發。之後每條提早返回的路徑都要釋放。
        fullAutoRunning = true;
        chrome.storage.local.get(["autoJoinDate", "autoJoinCount", "autoJoinCap"], (b) => {
          const today = new Date().toLocaleDateString('en-CA');
          let count = 0;
          let cap;
          if (b.autoJoinDate === today && b.autoJoinCap != null) {
            count = b.autoJoinCount || 0;
            cap = b.autoJoinCap;
          } else {
            cap = self.Humanize.pickDailyCap(cfg.humanizeConfig || {});
            chrome.storage.local.set({ autoJoinDate: today, autoJoinCount: 0, autoJoinCap: cap });
          }
          const remaining = Math.max(0, cap - count);
          if (remaining <= 0) { fullAutoRunning = false; return; } // 今日額度用完，釋放旗標
          chrome.storage.local.set({ fullAutoRunning: true }); // 供 popup 顯示 loading
          ensureOffscreen()
            .then(() => chrome.runtime.sendMessage({ type: "runFullAuto", cfg, maxEntries: remaining }))
            .catch(() => { fullAutoRunning = false; chrome.storage.local.set({ fullAutoRunning: false }); });
        });
      });
      break;
    }

    case "fullAutoResult": {
      fullAutoRunning = false;
      chrome.storage.local.set({ fullAutoRunning: false }); // 解除 popup loading
      if (message.loggedIn != null) chrome.storage.local.set({ loggedIn: message.loggedIn });
      if (message.point != null) storePoints(message.point);
      if (message.count > 0) {
        totalCounter.increment("totalEnterGiveaway", message.count);
        joinCounter.increment("autoJoinCount", message.count);
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
    case "enterCommitted": {
      // 安全模式每抽中一筆就送一次；SW 串行化寫入今日計數與累計計數。
      joinCounter.increment("autoJoinCount", 1);
      totalCounter.increment("totalEnterGiveaway", 1);
      break;
    }
    case "autoEnterDone": {
      // 安全模式跑完的完成通知（對齊激進模式 fullAutoResult 的行為）。
      if (message.count > 0) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: "icons/logo.png",
          title: chrome.i18n.getMessage("extName"),
          message: chrome.i18n.getMessage("notifyFullAutoDone", [String(message.count)])
        });
      }
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
    files: ["content_scripts/giveaway-core.js", "content_scripts/humanize.js", "content_scripts/autoStart.js"]
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
