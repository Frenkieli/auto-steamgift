# Popup & Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the popup down to status + one-tap toggles + a full-auto wishlist button, and build the (currently empty) settings page with scoring weights, minimum-criteria gating, and behaviour options.

**Architecture:** All state lives in `chrome.storage.sync`. The testable scoring/filtering logic lives in `content_scripts/giveaway-core.js` (pure DOM, unit-tested with `node --test` + jsdom). `autoStart.js` consumes that core to enter giveaways. The popup and options pages read/write storage directly and apply changes immediately (no save button). Full-auto opens the wishlist page and reuses the existing scoring + entering content scripts, reporting the count back via a notification.

**Tech Stack:** Vanilla JS (MV3 Chrome extension), `chrome.storage.sync`, `chrome.scripting`, `chrome.notifications`, `chrome.i18n`; tests via `node --test` + `jsdom`.

---

## File Structure

**Modify:**
- `defaultSchema.json` — add new default keys (Task 1)
- `content_scripts/giveaway-core.js` — add `getContributorLevel`, `passesMinimum` (Tasks 2-3)
- `content_scripts/autoStart.js` — apply minimum filter + point floor, emit done message (Task 4)
- `service-worker.js` — full-auto handler, done-notification, reload-guard (Task 7)
- `popup/popup.html`, `popup/popup.css`, `popup/init.js`, `popup/popup.js` — new layout/behaviour (Tasks 5-6)
- `options/options.html`, `options/init.js` — build settings page (Task 8)
- `_locales/en/messages.json`, `_locales/zh_TW/messages.json` — new strings (Task 9)

**Create:**
- `tests/default-schema.test.js` (Task 1)
- `options/options.js`, `options/options.css` (Task 8)

**Test:**
- `tests/giveaway-core.test.js` (extend, Tasks 2-3)

No `manifest.json` changes needed (all required permissions — `storage`, `scripting`, `tabs`, `notifications`, host permission — already present; `options_page` already points at `options/options.html`).

---

## Task 1: Storage defaults

**Files:**
- Modify: `defaultSchema.json`
- Test: `tests/default-schema.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/default-schema.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const schema = require('../defaultSchema.json');

test('defaultSchema has new minimum/behaviour keys with correct defaults', () => {
  assert.strictEqual(schema.minScore, 0);
  assert.strictEqual(schema.minLevel, 0);
  assert.deepStrictEqual(schema.requiredTypes, {
    restricted: false, whitelist: false, group: false, mode: 'any'
  });
  assert.strictEqual(schema.pointFloor, 0);
  assert.strictEqual(schema.goLinkTarget, 'wishlist');
  assert.strictEqual(schema.fullAutoWarned, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — the `default-schema` test fails (`undefined !== 0`).

- [ ] **Step 3: Add the new keys**

Edit `defaultSchema.json` — add these keys inside the root object (after the existing `totalEnterGiveaway` line, keeping valid JSON):

```json
{
  "restricted": { "trigger": true, "value": 100 },
  "whitelist": { "trigger": true, "value": 50 },
  "group": { "trigger": true, "value": 50 },
  "level": { "trigger": true, "value": 20 },
  "cost": { "trigger": true, "value": 1 },
  "autoScore": { "trigger": true },
  "autoStart": { "trigger": false },
  "totalEnterGiveaway": 0,
  "minScore": 0,
  "minLevel": 0,
  "requiredTypes": { "restricted": false, "whitelist": false, "group": false, "mode": "any" },
  "pointFloor": 0,
  "goLinkTarget": "wishlist",
  "fullAutoWarned": false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green, including `default-schema`.

- [ ] **Step 5: Commit**

```bash
git add defaultSchema.json tests/default-schema.test.js
git commit -m "feat: add minimum-criteria & behaviour keys to default schema"
```

---

## Task 2: `getContributorLevel` in giveaway-core

**Files:**
- Modify: `content_scripts/giveaway-core.js`
- Test: `tests/giveaway-core.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/giveaway-core.test.js`:

```js
test('getContributorLevel reads the contributor level number', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.getContributorLevel(r[0]), 1);  // Row A "Level 1+"
});

test('getContributorLevel returns 0 when no level column exists', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.getContributorLevel(r[3]), 0);  // Row D has no level column
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `GiveawayCore.getContributorLevel is not a function`.

- [ ] **Step 3: Implement `getContributorLevel`**

In `content_scripts/giveaway-core.js`, add this method to the `GiveawayCore` object (place it right after `getScore`):

```js
    getContributorLevel(row) {
      const el = row.querySelector('.giveaway__column--contributor-level');
      if (!el) return 0;
      const value = Number((el.textContent || '').replace(/[^0-9]/g, ''));
      return Number.isNaN(value) ? 0 : value;
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — both new tests green.

- [ ] **Step 5: Commit**

```bash
git add content_scripts/giveaway-core.js tests/giveaway-core.test.js
git commit -m "feat: getContributorLevel reads contributor level from a row"
```

---

## Task 3: `passesMinimum` in giveaway-core

**Files:**
- Modify: `content_scripts/giveaway-core.js`
- Test: `tests/giveaway-core.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/giveaway-core.test.js`:

```js
test('passesMinimum passes when no constraints are set', () => {
  const r = rows(loadFixture());
  assert.strictEqual(
    GiveawayCore.passesMinimum(r[0], { minScore: 0, minLevel: 0, requiredTypes: {} }),
    true
  );
});

test('passesMinimum fails when score is below minScore', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.passesMinimum(r[0], { minScore: 150 }), false);  // Row A score 120
});

test('passesMinimum fails when level is below minLevel', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.passesMinimum(r[0], { minLevel: 2 }), false);  // Row A level 1
});

test('passesMinimum (mode any) matches a region-restricted row', () => {
  const r = rows(loadFixture());
  assert.strictEqual(
    GiveawayCore.passesMinimum(r[3], { requiredTypes: { restricted: true, mode: 'any' } }),
    true   // Row D is region-restricted
  );
  assert.strictEqual(
    GiveawayCore.passesMinimum(r[0], { requiredTypes: { restricted: true, mode: 'any' } }),
    false  // Row A is not region-restricted
  );
});

test('passesMinimum (mode all) requires every checked type', () => {
  const dom = new (require('jsdom').JSDOM)(
    '<div class="giveaway__row-inner-wrap">' +
    '<div class="giveaway__column--region-restricted"></div>' +
    '<div class="giveaway__column--whitelist"></div></div>'
  );
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(
    GiveawayCore.passesMinimum(row, { requiredTypes: { restricted: true, whitelist: true, mode: 'all' } }),
    true
  );
  assert.strictEqual(
    GiveawayCore.passesMinimum(row, { requiredTypes: { restricted: true, whitelist: true, group: true, mode: 'all' } }),
    false  // no group column
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `GiveawayCore.passesMinimum is not a function`.

- [ ] **Step 3: Implement `passesMinimum`**

In `content_scripts/giveaway-core.js`, add this method to the `GiveawayCore` object (place it right after `getContributorLevel`):

```js
    passesMinimum(row, config) {
      const cfg = config || {};

      const minScore = Number(cfg.minScore) || 0;
      if (minScore > 0 && GiveawayCore.getScore(row) < minScore) return false;

      const minLevel = Number(cfg.minLevel) || 0;
      if (minLevel > 0 && GiveawayCore.getContributorLevel(row) < minLevel) return false;

      const rt = cfg.requiredTypes || {};
      const checks = [];
      if (rt.restricted) checks.push(!!row.querySelector('.giveaway__column--region-restricted'));
      if (rt.whitelist) checks.push(!!row.querySelector('.giveaway__column--whitelist'));
      if (rt.group) checks.push(!!row.querySelector('.giveaway__column--group'));
      if (checks.length > 0) {
        const ok = rt.mode === 'all' ? checks.every(Boolean) : checks.some(Boolean);
        if (!ok) return false;
      }

      return true;
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all `passesMinimum` tests green.

- [ ] **Step 5: Commit**

```bash
git add content_scripts/giveaway-core.js tests/giveaway-core.test.js
git commit -m "feat: passesMinimum gates rows by score/level/required types"
```

---

## Task 4: Apply minimum filter + point floor in autoStart

**Files:**
- Modify: `content_scripts/autoStart.js`

This wires the already-tested `passesMinimum` into the entry loop, adds the `pointFloor` affordability check, and emits a completion message (used by full-auto in Task 7).

- [ ] **Step 1: Replace autoStart.js with the updated version**

Overwrite `content_scripts/autoStart.js` with:

```js
chrome.storage.sync.get(["minScore", "minLevel", "requiredTypes", "pointFloor"], function (cfg) {
  setTimeout(() => {
    // 用來變更 giftCard 的組件 UI
    const CARD_TEXT = {
      Enter: '(Enter Giveaway)',
      Fail: '(Enter Giveaway Fail)',
      NotEnough: '(Not Enough Point)'
    };
    const CARD_STATE = {
      Success: { textColor: 'green', bgColor: '#0ff1' },
      Fail: { textColor: 'red', bgColor: '#f001' }
    };

    function giftCardUiChange({ cardElement, text, textColor, bgColor }) {
      cardElement.querySelector('.giveaway__heading__name').innerHTML += ` <span style="color:${textColor};">${text}</span>`;
      cardElement.classList.add('is-faded');
      cardElement.parentNode.style.backgroundColor = bgColor;
    }

    const core = window.GiveawayCore;
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    const minConfig = {
      minScore: cfg.minScore,
      minLevel: cfg.minLevel,
      requiredTypes: cfg.requiredTypes
    };
    const pointFloor = Number(cfg.pointFloor) || 0;

    // 1) 收集可加入且通過最低限度的禮物，依分數由高到低排序
    const giftElements = [...document.getElementsByClassName('giveaway__row-inner-wrap')]
      .filter((row) => core.isEnterable(row) && core.passesMinimum(row, minConfig));

    giftElements.sort((a, b) => core.getScore(b) - core.getScore(a));

    // 2) 依目前點數篩選，扣完不能低於保留點數門檻
    let myPoint = Number(document.querySelector('.nav__points').innerText);
    let countEntryGift = 0;

    const readyToEnterGiftElements = giftElements.filter((row) => {
      const cost = core.parsePointCost(row) || 0;
      if (myPoint - cost >= pointFloor) {
        myPoint -= cost;
        return true;
      }
      giftCardUiChange({ cardElement: row, text: CARD_TEXT.NotEnough, ...CARD_STATE.Fail });
      return false;
    });

    // 3) 點擊 inline 的 quick-entry 按鈕後，輪詢該列是否變成 is-faded（代表抽取成功）
    function enterGiveaway(row) {
      return new Promise((resolve, reject) => {
        const insertBtn = row.querySelector('.giveaway__quick-entry-btn--insert');
        if (!insertBtn || insertBtn.classList.contains('is-locked')) {
          reject(new Error('not enterable'));
          return;
        }

        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.parentNode.style.backgroundColor = '#ff01';
        insertBtn.click();

        let tries = 0;
        const timer = setInterval(() => {
          tries++;
          if (row.classList.contains('is-faded')) {
            clearInterval(timer);
            resolve();
          } else if (insertBtn.classList.contains('is-locked')) {
            clearInterval(timer);
            reject(new Error('locked after click'));
          } else if (tries > 12) {
            clearInterval(timer);
            reject(new Error('timeout'));
          }
        }, 500);
      });
    }

    // 4) 逐一抽取，每次之間留一點隨機間隔
    async function enterAll(list) {
      for (const row of list) {
        try {
          await enterGiveaway(row);
          countEntryGift++;
          chrome.runtime.sendMessage({ type: "setBadgeText", text: String(countEntryGift) });
          chrome.storage.sync.get(["totalEnterGiveaway"], function (config) {
            const total = ((config.totalEnterGiveaway || 0) * 1) + 1;
            chrome.storage.sync.set({ totalEnterGiveaway: total });
          });
          giftCardUiChange({ cardElement: row, text: CARD_TEXT.Enter, ...CARD_STATE.Success });
        } catch (e) {
          giftCardUiChange({ cardElement: row, text: CARD_TEXT.Fail, ...CARD_STATE.Fail });
        }
        await delay(Math.floor(Math.random() * 200) + 100);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      chrome.runtime.sendMessage({ type: "autoEnterDone", count: countEntryGift });
    }

    enterAll(readyToEnterGiftElements);
  }, 500);
});
```

- [ ] **Step 2: Run the core tests to confirm nothing regressed**

Run: `npm test`
Expected: PASS — all tests still green (autoStart is not unit-tested; the gating logic it calls is covered by Tasks 2-3).

- [ ] **Step 3: Manual smoke test**

1. Open `chrome://extensions`, enable Developer mode, **Load unpacked** → select the project directory (reload the extension if already loaded).
2. In the popup (old layout is fine at this point), turn ON「自動計算分數」and「自動開始抽取」.
3. Open `https://www.steamgifts.com/giveaways/search?type=wishlist` while logged in.
4. Expected: rows get `(Score:NN)`, then enterable rows get entered top-down; entries stop leaving at least `pointFloor` points (still 0 at this stage, so behaviour matches today).

- [ ] **Step 4: Commit**

```bash
git add content_scripts/autoStart.js
git commit -m "feat: autoStart applies minimum criteria, point floor, emits done"
```

---

## Task 5: New popup markup & styles

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.css`

- [ ] **Step 1: Replace popup.html**

Overwrite `popup/popup.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>__MSG_extName__-__MSG_popTitle__</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <h1>__MSG_popTitle__</h1>

  <button id="fullAutoBtn" class="full-auto-btn">__MSG_popFullAuto__</button>
  <p class="warn">__MSG_popFullAutoWarn__</p>

  <div class="status">
    <div class="status-card">
      <div class="status-label">__MSG_popPoints__</div>
      <div class="status-value" id="pointSpan">—</div>
    </div>
    <div class="status-card">
      <div class="status-label">__MSG_popTotal__</div>
      <div class="status-value" id="totalSpan">0</div>
    </div>
  </div>

  <div class="toggles">
    <label class="toggle-row">
      <span>__MSG_formAutoScore__</span>
      <input id="form-autoScoreCheckBox" type="checkbox">
    </label>
    <label class="toggle-row">
      <span>__MSG_formAutoStart__</span>
      <input id="form-autoStartCheckBox" type="checkbox">
    </label>
  </div>

  <button id="goSteamBtn" class="go-btn">__MSG_popGoSteam__</button>

  <div class="footer">
    <a id="popLinkOptions" href="#">__MSG_popLinkOptions__</a>
  </div>

  <script src="init.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace popup.css**

Overwrite `popup/popup.css` with:

```css
* { padding: 0; margin: 0; box-sizing: border-box; }

body {
  padding: 12px;
  width: 240px;
  font-family: system-ui, sans-serif;
  font-size: 14px;
}

h1 { font-size: 16px; margin-bottom: 10px; }

.full-auto-btn {
  width: 100%;
  padding: 10px;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  background: #c65a30;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.warn {
  font-size: 11px;
  color: #b25a1f;
  text-align: center;
  margin: 6px 0 12px;
}

.status { display: flex; gap: 8px; margin-bottom: 12px; }
.status-card { flex: 1; background: #f0f0f0; border-radius: 6px; padding: 6px 8px; }
.status-label { font-size: 11px; color: #666; }
.status-value { font-size: 18px; font-weight: 700; }

.toggles { margin-bottom: 12px; }
.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-top: 1px solid #eee;
  cursor: pointer;
}
.toggle-row:last-child { border-bottom: 1px solid #eee; }

.go-btn {
  width: 100%;
  padding: 9px;
  font-size: 14px;
  color: #fff;
  background: #3a8a5f;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.footer { text-align: center; margin-top: 12px; }
.footer a { color: #2b6cb0; text-decoration: none; font-size: 13px; }
```

- [ ] **Step 3: Commit**

```bash
git add popup/popup.html popup/popup.css
git commit -m "feat: rebuild popup layout (status, toggles, full-auto + go buttons)"
```

---

## Task 6: Popup behaviour (load, toggles, buttons)

**Files:**
- Modify: `popup/init.js`
- Modify: `popup/popup.js`

- [ ] **Step 1: Replace popup/init.js**

Overwrite `popup/init.js` with:

```js
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
```

- [ ] **Step 2: Replace popup/popup.js**

Overwrite `popup/popup.js` with:

```js
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
```

- [ ] **Step 3: Manual verification**

1. Reload the unpacked extension. (Requires Task 9 i18n strings to show real labels; until then placeholder `__MSG_…__` text may appear — fine for wiring.)
2. Open the popup while logged in to SteamGifts.
3. Expected: 目前點數 shows a number (or `—` if logged out); 累計加入 shows the stored count; the two toggles reflect storage and toggling either one persists immediately (re-open popup to confirm).
4. Click「前往 SteamGifts」→ opens the wishlist search page (default target).

- [ ] **Step 4: Commit**

```bash
git add popup/init.js popup/popup.js
git commit -m "feat: popup loads status, immediate-apply toggles, full-auto & go buttons"
```

---

## Task 7: Full-auto handler & reload guard in service worker

**Files:**
- Modify: `service-worker.js`

Adds: a full-auto message handler that opens/reuses the wishlist tab and injects scoring + entering; a guard so the normal `countScoreEnd` path does not double-inject autoStart on a full-auto tab; a done-notification; and a narrowed reload guard so cosmetic keys don't reload tabs.

- [ ] **Step 1: Add the full-auto tab tracker and helpers**

In `service-worker.js`, add near the top (after the existing top-of-file comment block, before the `onInstalled` listener):

```js
const fullAutoTabs = new Set();

function openWishlistTab(callback) {
  const url = "https://www.steamgifts.com/giveaways/search?type=wishlist";
  chrome.tabs.query({ url: "https://www.steamgifts.com/*" }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { url, active: true }, (tab) => callback(tab.id));
    } else {
      chrome.tabs.create({ url }, (tab) => callback(tab.id));
    }
  });
}

function injectFullAuto(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "content_scripts/giveaway-core.js",
      "content_scripts/countScore.js",
      "content_scripts/autoStart.js"
    ]
  });
}
```

- [ ] **Step 2: Update the `onMessage` handler**

Replace the existing `chrome.runtime.onMessage.addListener(...)` block in `service-worker.js` with:

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "countScoreEnd": {
      // full-auto tabs already inject autoStart themselves — don't double-inject
      if (sender.tab && fullAutoTabs.has(sender.tab.id)) break;
      chrome.storage.sync.get(["autoStart"], function (config) {
        if (config.autoStart.trigger) {
          injectAutoScript(sender.tab.id);
        }
      });
      break;
    }

    case "autoEnterDone": {
      if (sender.tab && fullAutoTabs.has(sender.tab.id)) {
        fullAutoTabs.delete(sender.tab.id);
        chrome.notifications.create({
          type: 'basic',
          iconUrl: "icons/logo.png",
          title: chrome.i18n.getMessage("extName"),
          message: chrome.i18n.getMessage("notifyFullAutoDone", [String(message.count)])
        });
      }
      break;
    }

    case "fullAutoWishlist": {
      openWishlistTab((tabId) => {
        fullAutoTabs.add(tabId);
        const listener = (updatedId, info) => {
          if (updatedId === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            injectFullAuto(tabId);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
      break;
    }

    case "setBadgeText": {
      chrome.action.setBadgeText({ tabId: sender.tab.id, text: message.text });
      chrome.action.setBadgeBackgroundColor({ color: "#583628" });
      break;
    }
    default:
      break;
  }
})
// ^^^^^^^^^^ 接收資訊
```

- [ ] **Step 3: Narrow the reload guard**

In `service-worker.js`, replace the body of the `chrome.storage.onChanged` listener's reload condition. Change:

```js
  if(!(Object.keys(changes).length === 1 &&  changes.totalEnterGiveaway)) {
    // 更新重整網站
    chrome.tabs.query({url: "https://www.steamgifts.com/*"}, function (tabs){
```

to:

```js
  const NO_RELOAD_KEYS = ["totalEnterGiveaway", "fullAutoWarned", "goLinkTarget"];
  const onlyCosmetic = Object.keys(changes).every((k) => NO_RELOAD_KEYS.includes(k));
  if(!onlyCosmetic) {
    // 更新重整網站
    chrome.tabs.query({url: "https://www.steamgifts.com/*"}, function (tabs){
```

(Leave the rest of that block — the `tabs.forEach` reload — unchanged.)

- [ ] **Step 4: Manual verification (after Task 9 strings exist)**

1. Reload the unpacked extension.
2. Open the popup, click「全自動抽取願望清單」. First click shows a confirm dialog; accept.
3. Expected: a SteamGifts wishlist tab opens (or an existing SteamGifts tab navigates there), rows get scored and enterable ones are entered, and a system notification「已自動抽取 N 件願望清單禮物」appears when done.
4. Re-open popup, click full-auto again → no confirm dialog this time (remembered).
5. Change「前往 SteamGifts 目標頁」in options → confirm SteamGifts tabs do NOT reload from that change.

- [ ] **Step 5: Commit**

```bash
git add service-worker.js
git commit -m "feat: full-auto wishlist handler, done notification, narrowed reload guard"
```

---

## Task 8: Build the settings page

**Files:**
- Modify: `options/options.html`
- Create: `options/options.css`
- Create: `options/options.js`
- Modify: `options/init.js` (no change needed — verify it still only does i18n; leave as-is)

- [ ] **Step 1: Replace options/options.html**

Overwrite `options/options.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>__MSG_extName__-__MSG_optTitle__</title>
  <link rel="stylesheet" href="options.css">
</head>
<body>
  <h1>__MSG_optTitle__</h1>

  <section>
    <h2>__MSG_optWeights__</h2>
    <div class="weight-row"><input type="checkbox" id="w-restricted-on"><label>__MSG_formRestricted__</label><input type="number" id="w-restricted-val" min="0" step="1"></div>
    <div class="weight-row"><input type="checkbox" id="w-whitelist-on"><label>__MSG_formWhitelist__</label><input type="number" id="w-whitelist-val" min="0" step="1"></div>
    <div class="weight-row"><input type="checkbox" id="w-group-on"><label>__MSG_formGroup__</label><input type="number" id="w-group-val" min="0" step="1"></div>
    <div class="weight-row"><input type="checkbox" id="w-level-on"><label>__MSG_formLevel__</label><input type="number" id="w-level-val" min="0" step="1"></div>
    <div class="weight-row"><input type="checkbox" id="w-cost-on"><label>__MSG_formCost__</label><input type="number" id="w-cost-val" min="0" step="1"></div>
  </section>

  <section>
    <h2>__MSG_optMinimum__</h2>
    <div class="field"><label for="minScore">__MSG_optMinScore__</label><input type="number" id="minScore" min="0" step="1"></div>
    <div class="field"><label for="minLevel">__MSG_optMinLevel__</label><input type="number" id="minLevel" min="0" step="1"></div>
    <div class="field">
      <label>__MSG_optRequiredTypes__</label>
      <label class="inline"><input type="checkbox" id="rt-restricted">__MSG_formRestricted__</label>
      <label class="inline"><input type="checkbox" id="rt-whitelist">__MSG_formWhitelist__</label>
      <label class="inline"><input type="checkbox" id="rt-group">__MSG_formGroup__</label>
      <select id="rt-mode">
        <option value="any">__MSG_optModeAny__</option>
        <option value="all">__MSG_optModeAll__</option>
      </select>
    </div>
  </section>

  <section>
    <h2>__MSG_optTarget__</h2>
    <select id="goLinkTarget">
      <option value="wishlist">__MSG_optTargetWishlist__</option>
      <option value="home">__MSG_optTargetHome__</option>
      <option value="reuse">__MSG_optTargetReuse__</option>
    </select>
  </section>

  <section>
    <h2>__MSG_optAutomation__</h2>
    <label class="field inline"><input type="checkbox" id="opt-autoScore">__MSG_formAutoScore__</label>
    <label class="field inline"><input type="checkbox" id="opt-autoStart">__MSG_formAutoStart__</label>
  </section>

  <section>
    <h2>__MSG_optPointFloorTitle__</h2>
    <div class="field"><label for="pointFloor">__MSG_optPointFloor__</label><input type="number" id="pointFloor" min="0" step="1"></div>
  </section>

  <section>
    <h2>__MSG_optData__</h2>
    <button id="resetTotal">__MSG_optResetTotal__</button>
    <button id="resetDefault">__MSG_optResetDefault__</button>
  </section>

  <script src="init.js"></script>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create options/options.css**

Create `options/options.css`:

```css
* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; font-size: 14px; padding: 20px; max-width: 520px; }
h1 { font-size: 20px; margin-bottom: 16px; }
section { border: 1px solid #e2e2e2; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; }
h2 { font-size: 15px; margin-bottom: 10px; }
.weight-row { display: grid; grid-template-columns: 24px 1fr 90px; gap: 8px; align-items: center; margin-bottom: 6px; }
.field { margin-bottom: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.field input[type="number"], select { padding: 4px 6px; }
.field input[type="number"] { width: 90px; }
label.inline { display: inline-flex; align-items: center; gap: 4px; }
button { padding: 8px 12px; margin-right: 8px; cursor: pointer; border: 1px solid #bbb; border-radius: 6px; background: #f6f6f6; }
```

- [ ] **Step 3: Create options/options.js**

Create `options/options.js`:

```js
const WEIGHT_KEYS = ["restricted", "whitelist", "group", "level", "cost"];

function load() {
  chrome.storage.sync.get(
    [...WEIGHT_KEYS, "autoScore", "autoStart", "minScore", "minLevel", "requiredTypes", "pointFloor", "goLinkTarget"],
    function (cfg) {
      WEIGHT_KEYS.forEach((k) => {
        if (cfg[k]) {
          document.getElementById(`w-${k}-on`).checked = !!cfg[k].trigger;
          document.getElementById(`w-${k}-val`).value = cfg[k].value;
        }
      });
      document.getElementById("minScore").value = cfg.minScore || 0;
      document.getElementById("minLevel").value = cfg.minLevel || 0;
      const rt = cfg.requiredTypes || { restricted: false, whitelist: false, group: false, mode: "any" };
      document.getElementById("rt-restricted").checked = !!rt.restricted;
      document.getElementById("rt-whitelist").checked = !!rt.whitelist;
      document.getElementById("rt-group").checked = !!rt.group;
      document.getElementById("rt-mode").value = rt.mode || "any";
      document.getElementById("pointFloor").value = cfg.pointFloor || 0;
      document.getElementById("goLinkTarget").value = cfg.goLinkTarget || "wishlist";
      document.getElementById("opt-autoScore").checked = !!(cfg.autoScore && cfg.autoScore.trigger);
      document.getElementById("opt-autoStart").checked = !!(cfg.autoStart && cfg.autoStart.trigger);
    }
  );
}

function saveWeight(key) {
  chrome.storage.sync.set({
    [key]: {
      trigger: document.getElementById(`w-${key}-on`).checked,
      value: document.getElementById(`w-${key}-val`).value
    }
  });
}

function saveRequiredTypes() {
  chrome.storage.sync.set({
    requiredTypes: {
      restricted: document.getElementById("rt-restricted").checked,
      whitelist: document.getElementById("rt-whitelist").checked,
      group: document.getElementById("rt-group").checked,
      mode: document.getElementById("rt-mode").value
    }
  });
}

WEIGHT_KEYS.forEach((k) => {
  document.getElementById(`w-${k}-on`).addEventListener("change", () => saveWeight(k));
  document.getElementById(`w-${k}-val`).addEventListener("change", () => saveWeight(k));
});

["rt-restricted", "rt-whitelist", "rt-group", "rt-mode"].forEach((id) => {
  document.getElementById(id).addEventListener("change", saveRequiredTypes);
});

document.getElementById("minScore").addEventListener("change", (e) =>
  chrome.storage.sync.set({ minScore: Number(e.target.value) || 0 }));
document.getElementById("minLevel").addEventListener("change", (e) =>
  chrome.storage.sync.set({ minLevel: Number(e.target.value) || 0 }));
document.getElementById("pointFloor").addEventListener("change", (e) =>
  chrome.storage.sync.set({ pointFloor: Number(e.target.value) || 0 }));
document.getElementById("goLinkTarget").addEventListener("change", (e) =>
  chrome.storage.sync.set({ goLinkTarget: e.target.value }));
document.getElementById("opt-autoScore").addEventListener("change", (e) =>
  chrome.storage.sync.set({ autoScore: { trigger: e.target.checked } }));
document.getElementById("opt-autoStart").addEventListener("change", (e) =>
  chrome.storage.sync.set({ autoStart: { trigger: e.target.checked } }));

document.getElementById("resetTotal").addEventListener("click", () => {
  chrome.storage.sync.set({ totalEnterGiveaway: 0 });
});

document.getElementById("resetDefault").addEventListener("click", () => {
  fetch(chrome.runtime.getURL("defaultSchema.json"))
    .then((res) => res.json())
    .then((data) => { chrome.storage.sync.set(data, () => location.reload()); });
});

load();
```

- [ ] **Step 4: Manual verification (after Task 9 strings exist)**

1. Reload the unpacked extension. Open the popup →「進入設定頁」.
2. Expected: five sections render with current values. Editing a weight value (blur the field) persists — re-open the page to confirm. Toggling「自動開始抽取」here also flips it in the popup.
3. Set 最低分數門檻 = 100; visit the wishlist page with auto-start on → rows scoring under 100 are skipped.
4. Click「重置累計加入」→ popup 累計加入 becomes 0. Click「回復預設值」→ fields return to defaults and page reloads.

- [ ] **Step 5: Commit**

```bash
git add options/options.html options/options.css options/options.js
git commit -m "feat: build settings page (weights, minimum, target, automation, data)"
```

---

## Task 9: i18n strings

**Files:**
- Modify: `_locales/en/messages.json`
- Modify: `_locales/zh_TW/messages.json`

- [ ] **Step 1: Add the English strings**

In `_locales/en/messages.json`, add these entries inside the root object (before the closing `}`; add a comma after the current last entry):

```json
  "popFullAuto": { "message": "Full-Auto Enter Wishlist", "description": "popup full-auto button" },
  "popFullAutoWarn": { "message": "Overuse may get your account banned. Use with care.", "description": "popup full-auto warning" },
  "popFullAutoConfirm": { "message": "This auto-enters your wishlist giveaways. Overuse may get your account banned. Continue?", "description": "popup full-auto confirm dialog" },
  "popPoints": { "message": "Current Points", "description": "popup current points label" },
  "popGoSteam": { "message": "Go to SteamGifts", "description": "popup go to steamgifts button" },
  "notifyFullAutoDone": { "message": "Auto-entered $COUNT$ wishlist giveaways", "placeholders": { "count": { "content": "$1" } }, "description": "full-auto done notification" },
  "optTitle": { "message": "Settings", "description": "options page title" },
  "optWeights": { "message": "Scoring Weights", "description": "options weights section" },
  "optMinimum": { "message": "Minimum Criteria (skip if not met)", "description": "options minimum section" },
  "optMinScore": { "message": "Minimum score", "description": "options min score" },
  "optMinLevel": { "message": "Minimum level", "description": "options min level" },
  "optRequiredTypes": { "message": "Required types", "description": "options required types" },
  "optModeAny": { "message": "Match at least one", "description": "options required types any" },
  "optModeAll": { "message": "Match all", "description": "options required types all" },
  "optTarget": { "message": "Go to SteamGifts opens", "description": "options target page" },
  "optTargetWishlist": { "message": "Wishlist search (default)", "description": "options target wishlist" },
  "optTargetHome": { "message": "Home page", "description": "options target home" },
  "optTargetReuse": { "message": "Reuse an open SteamGifts tab", "description": "options target reuse" },
  "optAutomation": { "message": "Automation", "description": "options automation section" },
  "optPointFloorTitle": { "message": "Entry Behaviour", "description": "options point floor section" },
  "optPointFloor": { "message": "Stop entering below this many points", "description": "options point floor" },
  "optData": { "message": "Data", "description": "options data section" },
  "optResetTotal": { "message": "Reset cumulative count", "description": "options reset total" },
  "optResetDefault": { "message": "Restore defaults", "description": "options reset defaults" }
```

- [ ] **Step 2: Add the Traditional Chinese strings**

In `_locales/zh_TW/messages.json`, add these entries inside the root object (before the closing `}`; add a comma after the current last entry):

```json
  "popFullAuto": { "message": "全自動抽取願望清單", "description": "popup 全自動按鈕" },
  "popFullAutoWarn": { "message": "過度使用可能導致帳號被封鎖，請謹慎", "description": "popup 全自動警告" },
  "popFullAutoConfirm": { "message": "這會自動抽取你的願望清單禮物。過度使用可能導致帳號被封鎖，確定要繼續嗎？", "description": "popup 全自動確認對話框" },
  "popPoints": { "message": "目前點數", "description": "popup 目前點數標籤" },
  "popGoSteam": { "message": "前往 SteamGifts", "description": "popup 前往按鈕" },
  "notifyFullAutoDone": { "message": "已自動抽取 $COUNT$ 件願望清單禮物", "placeholders": { "count": { "content": "$1" } }, "description": "全自動完成通知" },
  "optTitle": { "message": "設定", "description": "設定頁標題" },
  "optWeights": { "message": "計分權重", "description": "設定頁權重區塊" },
  "optMinimum": { "message": "最低限度（不符合就不抽）", "description": "設定頁最低限度區塊" },
  "optMinScore": { "message": "最低分數門檻", "description": "設定頁最低分數" },
  "optMinLevel": { "message": "最低等級", "description": "設定頁最低等級" },
  "optRequiredTypes": { "message": "必須符合類型", "description": "設定頁必須符合類型" },
  "optModeAny": { "message": "至少符合一項", "description": "必須符合類型 OR" },
  "optModeAll": { "message": "全部符合", "description": "必須符合類型 AND" },
  "optTarget": { "message": "前往 SteamGifts 開啟", "description": "設定頁目標頁" },
  "optTargetWishlist": { "message": "願望清單搜尋頁（預設）", "description": "目標頁願望清單" },
  "optTargetHome": { "message": "首頁", "description": "目標頁首頁" },
  "optTargetReuse": { "message": "沿用已開的 SteamGifts 分頁", "description": "目標頁沿用分頁" },
  "optAutomation": { "message": "自動化", "description": "設定頁自動化區塊" },
  "optPointFloorTitle": { "message": "抽取行為", "description": "設定頁抽取行為區塊" },
  "optPointFloor": { "message": "低於此點數就停止抽取", "description": "設定頁保留點數門檻" },
  "optData": { "message": "資料", "description": "設定頁資料區塊" },
  "optResetTotal": { "message": "重置累計加入", "description": "設定頁重置累計" },
  "optResetDefault": { "message": "回復預設值", "description": "設定頁回復預設" }
```

- [ ] **Step 3: Verify both JSON files are valid**

Run: `node -e "require('./_locales/en/messages.json'); require('./_locales/zh_TW/messages.json'); console.log('ok')"`
Expected: prints `ok` (no JSON parse error).

- [ ] **Step 4: Manual verification**

1. Reload the unpacked extension.
2. Expected: popup and settings page show real labels (no `__MSG_…__` leftovers) in your browser locale; the full-auto confirm dialog and the done-notification read correctly with the count substituted.

- [ ] **Step 5: Commit**

```bash
git add _locales/en/messages.json _locales/zh_TW/messages.json
git commit -m "feat: add i18n strings for new popup & settings UI"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Popup full-auto wishlist button + warning + first-time confirm + done notification → Tasks 5, 6, 7, 9.
  - Status (points + cumulative) → Tasks 5, 6.
  - Immediate-apply toggles, no save button → Tasks 5, 6.
  - 前往 SteamGifts button (default wishlist, target configurable) → Tasks 6, 8.
  - Weights removed from popup → Task 5.
  - Settings ① weights + minimum (minScore/minLevel/requiredTypes with any|all) → Tasks 1, 2, 3, 4, 8.
  - Settings ② target page → Task 8 (+6 consumes it).
  - Settings ③ automation mirror → Task 8.
  - Settings ④ point floor → Tasks 1, 4, 8.
  - Settings ⑤ data (reset total / restore defaults) → Task 8.
  - Storage model new keys + defaultSchema → Task 1.
  - Entry logic gating → Task 4 (logic in Tasks 2-3).
  - i18n en + zh_TW → Task 9.
- **Type consistency:** storage keys (`minScore`, `minLevel`, `requiredTypes{restricted,whitelist,group,mode}`, `pointFloor`, `goLinkTarget`, `fullAutoWarned`) and message names (`fullAutoWishlist`, `autoEnterDone`, `setBadgeText`, `countScoreEnd`) are used consistently across `popup.js`, `options.js`, `autoStart.js`, and `service-worker.js`. `passesMinimum(row, config)` signature matches its callers.
- **Note on test scope:** Only `giveaway-core.js` logic and `defaultSchema.json` are unit-tested (the project has no chrome-API mock harness; introducing one is out of scope). All chrome-dependent UI is verified via the explicit load-unpacked manual steps in each task.
```
