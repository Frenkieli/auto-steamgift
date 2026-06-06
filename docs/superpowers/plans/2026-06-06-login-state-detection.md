# Login-State Detection & Logged-Out Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when the user's SteamGifts login is lost (for free, from reads we already do) and protect the user from silent failures: show a popup banner with a manual "I've signed in — re-check" button, disable the full-auto button while logged out, and stop the in-page auto-enter from running.

**Architecture:** A `loggedIn` flag (`true`/`false`/`undefined`) in `chrome.storage.local` is written opportunistically by the three places that already read SteamGifts: the always-on `readPoints.js` content script, the service-worker home-page fetch, and the full-auto offscreen run. Network failures never flip the flag (only a successful read that lacks login evidence sets `false`). The popup reads the flag to render a banner + disable full-auto, and offers a manual re-check that forces a single credentialed fetch (bypassing the 6h gate). `autoStart.js` bails out when `.nav__points` is absent.

**Tech Stack:** Chrome Extension Manifest V3 (vanilla JS, service worker, offscreen document, content scripts, `chrome.storage.local`, `chrome.runtime` messaging with async `sendResponse`, `chrome.i18n`). No unit harness for `chrome.*`/`fetch`/DOM paths — those are verified with `node --check`, JSON validation, and manual checks; the existing pure-logic suite (`npm test`, 33 tests) must stay green.

---

## Background: current logged-out behavior (all silent)

- `service-worker.js` `refreshPointsIfStale` fetches the home page; on no `.nav__points` match it just `return`s — no flag, no signal.
- `content_scripts/readPoints.js` returns without writing when `.nav__points` is absent.
- `offscreen.js` `runFullAuto` returns `{ count: 0 }` when there is no `xsrf_token` — indistinguishable from "no giveaways".
- `content_scripts/autoStart.js` still runs on a logged-out page.

`countScore.js` is intentionally left running (harmless scoring of public giveaway lists).

## Data model (`chrome.storage.local`)

New key `loggedIn`: `true` (confirmed signed in) | `false` (confirmed signed out) | `undefined` (never detected). **Rule: only a successful read that lacks login evidence sets `false`; a failed fetch must NOT change `loggedIn`.**

## File Structure

- **Modify** `service-worker.js` — extract `fetchAndStorePoints({notify})` (does the fetch/parse and writes `loggedIn` + points; returns `Promise<true|false|null>`); make `refreshPointsIfStale` a 6h-gate wrapper over it; add a `forceLoginCheck` message (async `sendResponse`); set `loggedIn` from the full-auto result.
- **Modify** `content_scripts/readPoints.js` — write `loggedIn` (present→true, absent→false).
- **Modify** `offscreen.js` — `runFullAuto` returns `loggedIn`; the listener forwards it.
- **Modify** `content_scripts/autoStart.js` — bail when `.nav__points` is absent.
- **Modify** `_locales/zh_TW/messages.json`, `_locales/en/messages.json` — 3 new keys.
- **Modify** `popup/popup.html` — add the login banner + re-check button.
- **Modify** `popup/popup.js` — centralize `isRunning` + `loggedOut`, render banner + full-auto disable, wire the re-check button.
- **Modify** `popup/popup.css` — banner + re-check button styles.

`manifest.json` is NOT changed (version stays 1.2 — unpublished).

**Task order** keeps the extension working at every commit: SW flag plumbing first (Task 1), then the three free writers (Tasks 2–4), then i18n strings (Task 5) so the popup (Task 6) can reference them, then end-to-end manual verification (Task 7).

---

### Task 1: Service worker — `fetchAndStorePoints`, `forceLoginCheck`, full-auto `loggedIn`

**Files:**
- Modify: `service-worker.js`

- [ ] **Step 1: Extract `fetchAndStorePoints` and make `refreshPointsIfStale` wrap it**

In `service-worker.js`, replace the current `refreshPointsIfStale` function (the whole block from `// 過期才抓` through its closing `}`):

```js
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
```

with:

```js
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
```

(`storePoints` is left untouched — it is still used by the full-auto result path below.)

- [ ] **Step 2: Add the `forceLoginCheck` message case**

In the `chrome.runtime.onMessage.addListener` switch, add this case directly **before** the existing `case "refreshPointsIfStale":`:

```js
    case "forceLoginCheck": {
      // 使用者主動觸發，繞過 6h 閘門，抓一次並回報結果
      fetchAndStorePoints({ notify: false }).then((loggedIn) => sendResponse({ loggedIn }));
      return true; // 非同步回應，保持訊息通道開啟
    }

```

(Use `return true;` here — NOT `break;` — so the listener keeps the channel open for the async `sendResponse`.)

- [ ] **Step 3: Set `loggedIn` from the full-auto result**

Find the `fullAutoResult` case:

```js
    case "fullAutoResult": {
      fullAutoRunning = false;
      chrome.storage.local.set({ fullAutoRunning: false }); // 解除 popup loading
      if (message.point != null) storePoints(message.point);
```

Add the `loggedIn` write right after the `fullAutoRunning` storage line:

```js
    case "fullAutoResult": {
      fullAutoRunning = false;
      chrome.storage.local.set({ fullAutoRunning: false }); // 解除 popup loading
      if (message.loggedIn != null) chrome.storage.local.set({ loggedIn: message.loggedIn });
      if (message.point != null) storePoints(message.point);
```

- [ ] **Step 4: Verify**

Run: `node --check service-worker.js`
Expected: exit 0.

Run: `npm test`
Expected: `# pass 33 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add service-worker.js
git commit -m "feat: SW writes loggedIn flag; add forceLoginCheck message"
```

---

### Task 2: `readPoints.js` writes the `loggedIn` flag

**Files:**
- Modify: `content_scripts/readPoints.js`

- [ ] **Step 1: Replace the file contents**

Replace `content_scripts/readPoints.js` entirely with:

```js
// 常駐：使用者逛任何 SteamGifts 頁面時，免費讀取點數與登入狀態寫入快取（不發請求）
(() => {
  const el = document.querySelector('.nav__points');
  const digits = el ? (el.textContent || '').replace(/[^0-9]/g, '') : '';
  if (digits === '') {
    chrome.storage.local.set({ loggedIn: false }); // 沒有點數區塊 = 未登入
    return;
  }
  chrome.storage.local.set({ currentPoint: Number(digits), pointUpdatedAt: Date.now(), loggedIn: true });
})();
```

- [ ] **Step 2: Verify it parses**

Run: `node --check content_scripts/readPoints.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add content_scripts/readPoints.js
git commit -m "feat: readPoints sets loggedIn (present=true, absent=false)"
```

---

### Task 3: Full-auto reports `loggedIn`

**Files:**
- Modify: `offscreen.js`

- [ ] **Step 1: Report `loggedIn:false` on the no-xsrf path**

In `offscreen.js`, find:

```js
  const xsrf = xsrfEl ? xsrfEl.value : null;
  if (!xsrf) return { count: 0 };
```

Change the early return to:

```js
  const xsrf = xsrfEl ? xsrfEl.value : null;
  if (!xsrf) return { count: 0, loggedIn: false };
```

- [ ] **Step 2: Report `loggedIn:true` on the success path**

Find the end of `runFullAuto`:

```js
    await delayRandom();
  }
  return { count, point: myPoint };
}
```

Change the return to:

```js
    await delayRandom();
  }
  return { count, point: myPoint, loggedIn: true };
}
```

- [ ] **Step 3: Forward `loggedIn` in the result message**

Find the message listener:

```js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "runFullAuto") return;
  runFullAuto(message.cfg || {})
    .then(({ count, point }) => chrome.runtime.sendMessage({ type: "fullAutoResult", count, point }))
    .catch(() => chrome.runtime.sendMessage({ type: "fullAutoResult", count: 0 }));
});
```

Replace it with:

```js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "runFullAuto") return;
  runFullAuto(message.cfg || {})
    .then(({ count, point, loggedIn }) => chrome.runtime.sendMessage({ type: "fullAutoResult", count, point, loggedIn }))
    .catch(() => chrome.runtime.sendMessage({ type: "fullAutoResult", count: 0 }));
});
```

(The `.catch` deliberately omits `loggedIn` — a thrown run is an error, not a confirmed logout, so the SW must not flip the flag.)

- [ ] **Step 4: Verify it parses and tests stay green**

Run: `node --check offscreen.js`
Expected: exit 0.

Run: `npm test`
Expected: `# pass 33 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add offscreen.js
git commit -m "feat: full-auto reports loggedIn (xsrf present=true, absent=false)"
```

---

### Task 4: `autoStart.js` bails out when logged out

**Files:**
- Modify: `content_scripts/autoStart.js`

- [ ] **Step 1: Add the logged-out guard**

In `content_scripts/autoStart.js`, find the start of the injected work:

```js
chrome.storage.sync.get(["minScore", "minLevel", "requiredTypes", "pointFloor"], function (cfg) {
  setTimeout(() => {
    // 用來變更 giftCard 的組件 UI
    const CARD_TEXT = {
```

Insert the guard as the first statement inside the `setTimeout` callback:

```js
chrome.storage.sync.get(["minScore", "minLevel", "requiredTypes", "pointFloor"], function (cfg) {
  setTimeout(() => {
    if (!document.querySelector('.nav__points')) return; // 未登入則不自動加入
    // 用來變更 giftCard 的組件 UI
    const CARD_TEXT = {
```

- [ ] **Step 2: Verify it parses**

Run: `node --check content_scripts/autoStart.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add content_scripts/autoStart.js
git commit -m "feat: autoStart skips auto-enter when logged out"
```

---

### Task 5: i18n strings for the login banner

**Files:**
- Modify: `_locales/zh_TW/messages.json`
- Modify: `_locales/en/messages.json`

- [ ] **Step 1: Add keys to `_locales/zh_TW/messages.json`**

Find the existing line:

```json
  "popFullAutoRunning": { "message": "抽取中…請稍候", "description": "popup 全自動進行中標籤" },
```

Add three keys immediately after it:

```json
  "popFullAutoRunning": { "message": "抽取中…請稍候", "description": "popup 全自動進行中標籤" },
  "popLoginLost": { "message": "⚠ 未登入，請先登入 SteamGifts", "description": "popup 未登入橫幅文字" },
  "popRecheckLogin": { "message": "我已登入，重新檢查", "description": "popup 重新檢查登入按鈕" },
  "popRecheckLoginChecking": { "message": "檢查中…", "description": "popup 重新檢查進行中標籤" },
```

- [ ] **Step 2: Add the same keys to `_locales/en/messages.json`**

Find:

```json
  "popFullAutoRunning": { "message": "Running… please wait", "description": "popup full-auto running label" },
```

Add immediately after it:

```json
  "popFullAutoRunning": { "message": "Running… please wait", "description": "popup full-auto running label" },
  "popLoginLost": { "message": "⚠ Not signed in. Please sign in to SteamGifts.", "description": "popup logged-out banner text" },
  "popRecheckLogin": { "message": "I've signed in — re-check", "description": "popup re-check login button" },
  "popRecheckLoginChecking": { "message": "Checking…", "description": "popup re-check in progress label" },
```

- [ ] **Step 3: Verify both locales are valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('_locales/zh_TW/messages.json','utf8')); JSON.parse(require('fs').readFileSync('_locales/en/messages.json','utf8')); console.log('locales OK')"`
Expected: `locales OK`

- [ ] **Step 4: Commit**

```bash
git add _locales/zh_TW/messages.json _locales/en/messages.json
git commit -m "i18n: add login-banner and re-check strings"
```

---

### Task 6: Popup — banner, combined disable, manual re-check

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.js`
- Modify: `popup/popup.css`

- [ ] **Step 1: Add the banner to `popup/popup.html`**

Find:

```html
  <button id="fullAutoBtn" class="full-auto-btn">__MSG_popFullAuto__</button>
  <p class="warn">__MSG_popFullAutoWarn__</p>
```

Insert the banner immediately after the warn paragraph:

```html
  <button id="fullAutoBtn" class="full-auto-btn">__MSG_popFullAuto__</button>
  <p class="warn">__MSG_popFullAutoWarn__</p>

  <div id="loginBanner" class="login-banner" style="display:none;">
    <span>__MSG_popLoginLost__</span>
    <button id="recheckLoginBtn" class="recheck-btn">__MSG_popRecheckLogin__</button>
  </div>
```

- [ ] **Step 2: Replace the full-auto block in `popup/popup.js`**

In `popup/popup.js`, find the entire current full-auto block (from `const fullAutoBtn = document.getElementById("fullAutoBtn");` down to the closing `});` of its click listener — it currently contains `setFullAutoLoading`, the `storage.local.get(["fullAutoRunning"]...)`, the `storage.onChanged` listener, and the click handler):

```js
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
```

Replace that whole block with:

```js
const fullAutoBtn = document.getElementById("fullAutoBtn");
const loginBanner = document.getElementById("loginBanner");
const recheckLoginBtn = document.getElementById("recheckLoginBtn");
let fullAutoArmed = false;
let isRunning = false;
let loggedOut = false;

function renderFullAutoBtn() {
  fullAutoBtn.disabled = isRunning || loggedOut;
  fullAutoBtn.classList.toggle("is-loading", isRunning);
  fullAutoBtn.textContent = chrome.i18n.getMessage(isRunning ? "popFullAutoRunning" : "popFullAuto");
}

function renderLoginBanner() {
  loginBanner.style.display = loggedOut ? "" : "none";
}

// 開啟 popup 時反映目前的抽取/登入狀態
chrome.storage.local.get(["fullAutoRunning", "loggedIn"], (s) => {
  isRunning = !!s.fullAutoRunning;
  loggedOut = s.loggedIn === false;
  renderFullAutoBtn();
  renderLoginBanner();
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
  chrome.storage.sync.get(["fullAutoWarned"], (cfg) => {
    if (!cfg.fullAutoWarned && !fullAutoArmed) {
      fullAutoArmed = true;
      fullAutoBtn.textContent = chrome.i18n.getMessage("popFullAutoConfirm");
      return;
    }
    chrome.storage.sync.set({ fullAutoWarned: true });
    chrome.runtime.sendMessage({ type: "fullAutoWishlist" });
    isRunning = true;
    renderFullAutoBtn(); // 立即回饋；保持 popup 開著
  });
});
```

- [ ] **Step 3: Add styles to `popup/popup.css`**

Append to `popup/popup.css`:

```css
.login-banner {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #fff3cd;
  color: #8a6d1f;
  border: 1px solid #f0d98c;
  border-radius: 6px;
  padding: 8px;
  font-size: 12px;
  margin-bottom: 12px;
}
.recheck-btn {
  align-self: flex-start;
  padding: 4px 10px;
  font-size: 12px;
  color: #fff;
  background: #3a8a5f;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
```

- [ ] **Step 4: Verify**

Run: `node --check popup/popup.js`
Expected: exit 0.

Run: `npm test`
Expected: `# pass 33 # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add popup/popup.html popup/popup.js popup/popup.css
git commit -m "feat: popup login banner + re-check; disable full-auto when logged out"
```

---

### Task 7: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Reload and verify the logged-out experience**

1. `chrome://extensions` → reload the unpacked extension.
2. **Simulate logged-out cache:** open the service-worker console (`chrome://extensions` → "service worker") and run `chrome.storage.local.set({ loggedIn: false })`. Open the popup → expect the banner "⚠ 未登入，請先登入 SteamGifts" and the full-auto button **disabled**.
3. **Manual re-check (still logged out):** in the popup, click "我已登入，重新檢查" while actually logged out → button shows "檢查中…" then returns; banner stays, full-auto stays disabled.
4. **Manual re-check (after signing in):** sign in to SteamGifts in a normal tab, then click "我已登入，重新檢查" → banner disappears and the full-auto button becomes enabled.

- [ ] **Step 2: Verify the free detectors**

5. **Browsing detector:** while signed in, visit any SteamGifts page; confirm in DevTools → Application → Storage → Extension storage (`local`) that `loggedIn` is `true`. Sign out, reload a SteamGifts page; confirm `loggedIn` flips to `false` and the popup banner appears.
6. **autoStart guard:** signed out, with `autoScore`+`autoStart` enabled, open a SteamGifts giveaway list → confirm no `(Enter Giveaway Fail)` labels appear (auto-enter bailed); scoring `(Score:NN)` spans may still appear (countScore intentionally unchanged).
7. **Full-auto self-correct:** with `loggedIn` unknown/true but actually signed out, click full-auto → after it returns, `loggedIn` becomes `false`, the banner appears, and the button disables.

- [ ] **Step 3: Confirm the unit suite is still green**

Run: `npm test`
Expected: `# fail 0`.

---

## Self-Review

**Spec coverage:**
- `loggedIn` flag in `storage.local`, network-failure-safe → Task 1 (`fetchAndStorePoints` returns `null` on `.catch`, never sets `false`), Task 2 (readPoints), Task 3 (offscreen `.catch` omits `loggedIn`).
- Three free writers → Task 2 (readPoints), Task 1 (`fetchAndStorePoints`), Task 3 + Task 1 Step 3 (full-auto → `message.loggedIn`).
- SW refactor: `fetchAndStorePoints` + gated `refreshPointsIfStale` + `forceLoginCheck` async `sendResponse` → Task 1.
- Popup banner, full-auto disable (`isRunning || loggedOut`), manual re-check with direct-response handling for the unchanged-value case → Task 6.
- `autoStart` logged-out guard; `countScore` untouched → Task 4.
- i18n keys `popLoginLost`/`popRecheckLogin`/`popRecheckLoginChecking` → Task 5, consumed in Task 6.
- No manifest/version change → confirmed (no task touches `manifest.json`).

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows complete before/after code; every run step states the exact command and expected output.

**Type/name consistency:** `loggedIn` (3-state) is written as `true`/`false` everywhere and read as `=== false` in the popup. `fetchAndStorePoints({notify})` returns `Promise<true|false|null>` (Task 1) and is consumed by `refreshPointsIfStale` (ignores return) and `forceLoginCheck` (`sendResponse({ loggedIn })`, Task 1) and the popup callback `resp.loggedIn` (Task 6). The full-auto result carries `loggedIn` — produced in Task 3 (offscreen) and consumed in Task 1 Step 3 (`message.loggedIn`). The popup state vars `isRunning`/`loggedOut` and renderers `renderFullAutoBtn`/`renderLoginBanner` are defined and used consistently within Task 6; `forceLoginCheck` message type matches between Task 6 (sender) and Task 1 (handler). Storage area is `local` for all `loggedIn` writes/reads.

**Known note (not a placeholder):** all touched paths use `chrome.*`/`fetch`/DOM with no unit harness (matching the repo); they are verified by `node --check`, JSON validation, and the Task 7 manual checks. The existing 33-test pure-logic suite must stay green throughout.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-06-login-state-detection.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
