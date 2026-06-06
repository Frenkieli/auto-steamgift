const WISHLIST_URL = "https://www.steamgifts.com/giveaways/search?type=wishlist";
const HOME_URL = "https://www.steamgifts.com/";

function setTrigger(key, checked) {
  chrome.storage.sync.set({ [key]: { trigger: checked } });
}

document.getElementById("form-autoScoreCheckBox")
  .addEventListener("change", (e) => setTrigger("autoScore", e.target.checked));
document.getElementById("form-autoStartCheckBox")
  .addEventListener("change", (e) => setTrigger("autoStart", e.target.checked));

const fullAutoBtn = document.getElementById("fullAutoBtn");
let fullAutoArmed = false;

function setFullAutoLoading(running) {
  fullAutoBtn.disabled = running;
  fullAutoBtn.classList.toggle("is-loading", running);
  fullAutoBtn.textContent = chrome.i18n.getMessage(running ? "popFullAutoRunning" : "popFullAuto");
}

// 開啟 popup 時反映目前是否正在抽取
chrome.storage.local.get(["fullAutoRunning"], (s) => setFullAutoLoading(!!s.fullAutoRunning));

// 抽取狀態變化時即時更新（完成通知後 SW 會把旗標設為 false → 解除 loading）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.fullAutoRunning) {
    fullAutoArmed = false;
    setFullAutoLoading(!!changes.fullAutoRunning.newValue);
  }
});

fullAutoBtn.addEventListener("click", () => {
  if (fullAutoBtn.disabled) return;
  chrome.storage.sync.get(["fullAutoWarned"], (cfg) => {
    if (!cfg.fullAutoWarned && !fullAutoArmed) {
      fullAutoArmed = true;
      fullAutoBtn.textContent = chrome.i18n.getMessage("popFullAutoConfirm");
      return;
    }
    chrome.storage.sync.set({ fullAutoWarned: true });
    chrome.runtime.sendMessage({ type: "fullAutoWishlist" });
    setFullAutoLoading(true); // 立即回饋；保持 popup 開著，不關閉
  });
});

document.getElementById("goSteamBtn").addEventListener("click", () => {
  chrome.storage.sync.get(["goLinkTarget"], (cfg) => {
    const target = cfg.goLinkTarget || "wishlist";
    if (target === "reuse") {
      chrome.tabs.query({ url: "https://www.steamgifts.com/*" }, (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.update(tabs[0].id, { active: true });
          chrome.windows.update(tabs[0].windowId, { focused: true });
        }
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
