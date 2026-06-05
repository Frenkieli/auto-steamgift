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

// fetch current SteamGifts points
fetch('https://www.steamgifts.com/')
  .then((res) => res.text())
  .then((html) => {
    const match = html.match(/<span class="nav__points">(\d+)<\/span>/);
    document.getElementById("pointSpan").innerText = match ? match[1] : '—';
  })
  .catch(() => { document.getElementById("pointSpan").innerText = '—'; });
