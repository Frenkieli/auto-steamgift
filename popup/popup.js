const WISHLIST_URL = "https://www.steamgifts.com/giveaways/search?type=wishlist";
const HOME_URL = "https://www.steamgifts.com/";

function setTrigger(key, checked) {
  chrome.storage.sync.set({ [key]: { trigger: checked } });
}

document.getElementById("form-autoScoreCheckBox")
  .addEventListener("change", (e) => setTrigger("autoScore", e.target.checked));
document.getElementById("form-autoStartCheckBox")
  .addEventListener("change", (e) => setTrigger("autoStart", e.target.checked));

document.getElementById("fullAutoBtn").addEventListener("click", () => {
  chrome.storage.sync.get(["fullAutoWarned"], (cfg) => {
    if (!cfg.fullAutoWarned) {
      if (!confirm(chrome.i18n.getMessage("popFullAutoConfirm"))) return;
      chrome.storage.sync.set({ fullAutoWarned: true });
    }
    chrome.runtime.sendMessage({ type: "fullAutoWishlist" });
    window.close();
  });
});

document.getElementById("goSteamBtn").addEventListener("click", () => {
  chrome.storage.sync.get(["goLinkTarget"], (cfg) => {
    const target = cfg.goLinkTarget || "wishlist";
    if (target === "reuse") {
      chrome.tabs.query({ url: "https://www.steamgifts.com/*" }, (tabs) => {
        if (tabs.length > 0) chrome.tabs.update(tabs[0].id, { active: true });
        else chrome.tabs.create({ url: WISHLIST_URL });
        window.close();
      });
    } else {
      chrome.tabs.create({ url: target === "home" ? HOME_URL : WISHLIST_URL });
      window.close();
    }
  });
});

document.getElementById("popLinkOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
