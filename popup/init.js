// replace all html i18n variable
var allTextNodes = document.createTreeWalker(document.querySelector('html'), NodeFilter.SHOW_TEXT),
    tmpTxt,
    tmpNode;

while (allTextNodes.nextNode()) {
  tmpNode = allTextNodes.currentNode;
  tmpTxt = tmpNode.nodeValue;
  tmpNode.nodeValue = tmpTxt.replace(/__MSG_(\w+)__/g, function (match, v1) {
    return v1 ? (chrome.i18n.getMessage(v1) || match) : '';
  });
}
// ^^^^^^^^^^^^^^^^^^^^ replace all html i18n variable

// load the two automation toggles
chrome.storage.sync.get(["autoScore", "autoStart"], function (config) {
  document.getElementById("form-autoScoreCheckBox").checked = !!(config.autoScore && config.autoScore.trigger);
  document.getElementById("form-autoStartCheckBox").checked = !!(config.autoStart && config.autoStart.trigger);
});

// load cumulative joined count
chrome.storage.sync.get(["totalEnterGiveaway"], function (config) {
  document.getElementById("totalSpan").innerText = config.totalEnterGiveaway || 0;
});

// 顯示快取點數 + 更新時間；只在快取超過 6h 時才請 SW 去抓
const pointSpan = document.getElementById("pointSpan");
const pointUpdatedSpan = document.getElementById("pointUpdatedSpan");
const i18n = (key, n) => (n === undefined
  ? chrome.i18n.getMessage(key)
  : chrome.i18n.getMessage(key, [String(n)]));

function renderPoints(currentPoint, pointUpdatedAt) {
  pointSpan.innerText = (currentPoint == null) ? '—' : String(currentPoint);
  pointUpdatedSpan.innerText = window.RelativeTime.relativeUpdatedText(pointUpdatedAt || 0, Date.now(), i18n);
}

chrome.storage.local.get(["currentPoint", "pointUpdatedAt"], (cache) => {
  renderPoints(cache.currentPoint, cache.pointUpdatedAt);
});

chrome.runtime.sendMessage({ type: "refreshPointsIfStale" });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.currentPoint || changes.pointUpdatedAt) {
    chrome.storage.local.get(["currentPoint", "pointUpdatedAt"], (cache) => {
      renderPoints(cache.currentPoint, cache.pointUpdatedAt);
    });
  }
});
