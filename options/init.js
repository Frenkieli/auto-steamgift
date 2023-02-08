// replace all html i18n variable
var allTextNodes = document.createTreeWalker(document.querySelector('html'), NodeFilter.SHOW_TEXT),
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
