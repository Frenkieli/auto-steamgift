// replace all html i18n variable
var allTextNodes = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT),
    tmpTxt,
    tmpNode;

while (allTextNodes.nextNode()) {
    tmpNode = allTextNodes.currentNode;
    tmpTxt = tmpNode.nodeValue;

    tmpNode.nodeValue = tmpTxt.replace(/__MSG_(\w+)__/g, function(match, v1) {
        return v1 ? (chrome.i18n.getMessage(v1) || match) : '';
    });
}
// ^^^^^^^^^^^^^^^^^^^^ replace all html i18n variable

chrome.storage.sync.get(["restricted", "whitelist", "group", "level", "cost", "autoScore", "autoStart"], function(config) {
  const method = {
    trigger: (key, value) => {
      document.getElementById(`form-${key}CheckBox`).checked = value;
    },
    value: (key, value) => {
      document.getElementById(`form-${key}Score`).value = value;
    }
  }

  Object.entries(config).forEach(([configKey, configValue]) => {
    Object.entries(configValue).forEach(([key, value]) => {
      method[key](configKey, value);
    })
  })
});

chrome.storage.sync.get(["totalEnterGiveaway"], function(config) {
  document.getElementById("totalSpan").innerText = config.totalEnterGiveaway;
})

document.getElementById('popLinkOptions').addEventListener("click", e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
})