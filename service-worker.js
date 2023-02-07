chrome.runtime.onInstalled.addListener(function(details){
  if(details.reason == "install"){
    fetch("defaultSchema.json").then(function (res) {
      return res.json();
    }).then(function (data) {
      chrome.storage.sync.set(data);
    })
  }else if(details.reason == "update"){

  }
});
// ^^^^^^^^^^ 安裝基本資料

chrome.storage.onChanged.addListener((changes, areaName) => {
  if((areaName === "autoScore" || areaName === "sync") && changes.autoScore) {
    if(changes.autoScore.newValue.trigger) {
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
    } else {
      chrome.scripting
      .unregisterContentScripts({ ids: ["countScore-script"] });
    }
  }

  if(areaName !== "totalEnterGiveaway") {
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
function injectAutoScript (tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: ["content_scripts/autoStart.js"]
  });
}
// ^^^^^^^^^^ 放置各種呼叫 method