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
const loginBanner = document.getElementById("loginBanner");
const recheckLoginBtn = document.getElementById("recheckLoginBtn");
const aggressiveWarn = document.getElementById("aggressiveWarn");
let fullAutoArmed = false;
let isRunning = false;
let loggedOut = false;
let aggressive = false;

// 讀取激進模式，顯示警告
chrome.storage.sync.get(["aggressiveMode"], (s) => {
  aggressive = !!(s.aggressiveMode && s.aggressiveMode.trigger);
  aggressiveWarn.style.display = aggressive ? "" : "none";
});

function renderFullAutoBtn() {
  fullAutoBtn.disabled = isRunning || loggedOut;
  fullAutoBtn.classList.toggle("is-loading", isRunning);
  fullAutoBtn.textContent = chrome.i18n.getMessage(isRunning ? "popFullAutoRunning" : "popFullAuto");
}

function renderLoginBanner() {
  loginBanner.style.display = loggedOut ? "" : "none";
}

const todayCount = document.getElementById("todayCount");
function renderTodayCount(count, cap) {
  todayCount.textContent = `${count || 0} / ${cap == null ? "—" : cap}`;
}

// 開啟 popup 時反映目前的抽取/登入/今日計數狀態
chrome.storage.local.get(["fullAutoRunning", "loggedIn", "autoJoinCount", "autoJoinCap"], (s) => {
  isRunning = !!s.fullAutoRunning;
  loggedOut = s.loggedIn === false;
  renderFullAutoBtn();
  renderLoginBanner();
  renderTodayCount(s.autoJoinCount, s.autoJoinCap);
});

// 狀態變化即時更新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.fullAutoRunning) {
    isRunning = !!changes.fullAutoRunning.newValue;
    fullAutoArmed = false;
    renderFullAutoBtn();
  }
  if (changes.loggedIn) {
    loggedOut = changes.loggedIn.newValue === false;
    renderFullAutoBtn();
    renderLoginBanner();
  }
  if (changes.autoJoinCount || changes.autoJoinCap) {
    chrome.storage.local.get(["autoJoinCount", "autoJoinCap"], (s) => renderTodayCount(s.autoJoinCount, s.autoJoinCap));
  }
});

// 「我已登入，重新檢查」→ 強制抓一次（繞過 6h 閘門）
recheckLoginBtn.addEventListener("click", () => {
  recheckLoginBtn.disabled = true;
  recheckLoginBtn.textContent = chrome.i18n.getMessage("popRecheckLoginChecking");
  chrome.runtime.sendMessage({ type: "forceLoginCheck" }, (resp) => {
    recheckLoginBtn.disabled = false;
    recheckLoginBtn.textContent = chrome.i18n.getMessage("popRecheckLogin");
    // 直接套用回應（涵蓋「值沒變、onChanged 不觸發」的情況）；null=fetch 失敗，維持原樣
    if (resp && resp.loggedIn != null) {
      loggedOut = resp.loggedIn === false;
      renderFullAutoBtn();
      renderLoginBanner();
    }
  });
});

fullAutoBtn.addEventListener("click", () => {
  if (fullAutoBtn.disabled) return;
  if (!aggressive) {
    // 安全模式：請 SW 開願望清單分頁，由頁內擬人化 autoStart 處理
    chrome.runtime.sendMessage({ type: "fullAutoWishlist" });
    window.close();
    return;
  }
  // 激進模式：背景全自動，保留兩段式警告與 loading
  chrome.storage.sync.get(["fullAutoWarned"], (cfg) => {
    if (!cfg.fullAutoWarned && !fullAutoArmed) {
      fullAutoArmed = true;
      fullAutoBtn.textContent = chrome.i18n.getMessage("popFullAutoConfirm");
      return;
    }
    chrome.storage.sync.set({ fullAutoWarned: true });
    chrome.runtime.sendMessage({ type: "fullAutoWishlist" });
    fullAutoArmed = false;
    // loading 由 storage.onChanged 驅動（SW 真的開始才設 fullAutoRunning）；
    // 避免 SW 因非活躍時段/額度用完提前返回時，按鈕卡在「抽取中…」
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
