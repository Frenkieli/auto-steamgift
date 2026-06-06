# Point Cache + 6-Hour Staleness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop fetching SteamGifts points on every popup open and every browser startup; instead cache the point value and only re-fetch when the cache is older than 6 hours, while refreshing it for free whenever the user browses SteamGifts or runs full-auto.

**Architecture:** Store `currentPoint` + `pointUpdatedAt` in `chrome.storage.local`. A single service-worker helper `refreshPointsIfStale({notify})` fetches the home page (with credentials) only when the cache is ≥6h old; `onStartup` and the popup both call it. Two free sources keep the cache fresh without any extra request: a new always-on content script reads `.nav__points` on any SteamGifts page, and the full-auto offscreen run reports its leftover points. The popup displays the cached value plus a relative "updated N ago" line and reacts to `storage.onChanged`.

**Tech Stack:** Chrome Extension Manifest V3 (vanilla JS, service worker, offscreen document, static + dynamic content scripts, `chrome.storage.local`, `chrome.i18n`), Node built-in test runner for the unrelated pure-logic suite (`node --test`).

---

## Background: current behavior being replaced

- `popup/init.js` runs `fetch('https://www.steamgifts.com/')` on **every** popup open (no `credentials`, so it hits the logged-out page and points usually render `—`).
- `service-worker.js` `onStartup` runs the same credential-less fetch on **every** browser startup and shows a "你的點數:X" notification.
- `offscreen.js` `runFullAuto` already reads points from the wishlist page it fetches for entering; it currently returns only `count`.
- `countScore.js` only runs when the "autoScore" toggle is on (registered via `chrome.scripting.registerContentScripts`), so it cannot be the always-on point reader.

## File Structure

- **Modify** `service-worker.js` — add `POINT_TTL_MS`, `refreshPointsIfStale({notify})`, `storePoints(point)`; rewrite `onStartup` to call the gate; handle a new `refreshPointsIfStale` message; call `storePoints` in the `fullAutoResult` handler.
- **Modify** `offscreen.js` — `runFullAuto` returns `{count, point}`; the message listener forwards `point` in `fullAutoResult`.
- **Create** `content_scripts/readPoints.js` — always-on reader: scrape `.nav__points` → write `chrome.storage.local`.
- **Modify** `manifest.json` — declare the static content script; bump version `1.2`→`1.3`.
- **Create** `content_scripts/relativeTime.js` — a tiny pure function `relativeUpdatedText(updatedAt, now, t)` (testable) that maps a timestamp to the "updated N ago" string via an injected i18n lookup.
- **Create** `tests/relative-time.test.js` — unit tests for `relativeUpdatedText`.
- **Modify** `popup/popup.html` — add a `#pointUpdatedSpan` small line; load `relativeTime.js` before `init.js`.
- **Modify** `popup/init.js` — remove the fetch; show cached point + relative text; send `refreshPointsIfStale`; subscribe to `storage.onChanged`.
- **Modify** `_locales/zh_TW/messages.json` and `_locales/en/messages.json` — add relative-time i18n keys.

**Task ordering rationale:** Task 1 establishes the cache contract in the SW (startup gate) — the extension stays working. Task 2 adds the always-on free reader. Task 3 wires full-auto's free report. Task 4 builds + tests the pure relative-time helper. Task 5 rewires the popup to consume the cache. Task 6 does manifest version + manual end-to-end verification.

---

### Task 1: Service worker — cache, staleness gate, startup, and message handler

**Files:**
- Modify: `service-worker.js`

This task changes startup from "always fetch + notify" to "fetch only if ≥6h stale", adds the cache writer, and adds the message handler the popup will call in Task 5. There is no unit harness for `chrome.*`/`fetch`; verification is `node --check` plus the manual checks in Task 6.

- [ ] **Step 1: Add constants and helpers near the top of `service-worker.js`**

Find the current top of the file:

```js
let fullAutoRunning = false;

const FULL_AUTO_CFG_KEYS = [
  "restricted", "whitelist", "group", "level", "cost",
  "minScore", "minLevel", "requiredTypes", "pointFloor"
];
```

Insert immediately **after** that block:

```js
const HOME_URL = "https://www.steamgifts.com/";
const POINT_TTL_MS = 6 * 60 * 60 * 1000; // 6 小時

// 寫入點數快取（供免費更新來源使用）
function storePoints(point) {
  chrome.storage.local.set({ currentPoint: point, pointUpdatedAt: Date.now() });
}

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

Note: `NOTIFICATION_TYPE` is defined lower in the file; it is read at call time (inside the fetch callback), so the forward reference is fine.

- [ ] **Step 2: Replace the `onStartup` body's point fetch with the gate**

Find the `onStartup` listener (it currently re-registers content scripts, then fetches the home page and creates a notification):

```js
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.sync.get(["autoScore"], function(config) {
    if(config.autoScore.trigger) {
      registerCountScoreContentScripts();
    }
  })

  fetch('https://www.steamgifts.com/').then(res=>res.text()).then(htmlText=>{
    const regex = /<span class="nav__points">(\d+)<\/span>/;
    const match = htmlText.match(regex);
    const point = match ? parseInt(match[1]) : null;
    chrome.notifications.clear(NOTIFICATION_TYPE.CurrentPoint);

    chrome.notifications.create(
      NOTIFICATION_TYPE.CurrentPoint, {
        type: 'basic',
        iconUrl: "icons/logo.png",
        title: chrome.i18n.getMessage("extName"),
        contextMessage: `你目前的點數為:${point}`,
        message: "立即前往 SteamGift 網站",
        eventTime: new Date().getTime() + 60000,
        isClickable: true
      }
    )
  })
});
```

Replace the whole listener with:

```js
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.sync.get(["autoScore"], function(config) {
    if(config.autoScore.trigger) {
      registerCountScoreContentScripts();
    }
  })

  refreshPointsIfStale({ notify: true });
});
```

- [ ] **Step 3: Add the `refreshPointsIfStale` message case**

In the `chrome.runtime.onMessage.addListener` switch, find the `fullAutoWishlist` case and add a new case directly **before** it:

```js
    case "refreshPointsIfStale": {
      refreshPointsIfStale({ notify: false });
      break;
    }

    case "fullAutoWishlist": {
```

- [ ] **Step 4: Store points from the full-auto result**

Find the `fullAutoResult` case (after Task done earlier it looks like this):

```js
    case "fullAutoResult": {
      fullAutoRunning = false;
      if (message.count > 0) {
        chrome.storage.sync.get(["totalEnterGiveaway"], (c) => {
          chrome.storage.sync.set({ totalEnterGiveaway: (c.totalEnterGiveaway || 0) + message.count });
        });
      }
      chrome.notifications.create({
```

Insert the point write right after `fullAutoRunning = false;`:

```js
    case "fullAutoResult": {
      fullAutoRunning = false;
      if (message.point != null) storePoints(message.point);
      if (message.count > 0) {
        chrome.storage.sync.get(["totalEnterGiveaway"], (c) => {
          chrome.storage.sync.set({ totalEnterGiveaway: (c.totalEnterGiveaway || 0) + message.count });
        });
      }
      chrome.notifications.create({
```

- [ ] **Step 5: Verify it parses and the unrelated suite is green**

Run: `node --check service-worker.js`
Expected: no output, exit 0.

Run: `npm test`
Expected: `# pass 27 # fail 0` (giveaway-core suite untouched).

- [ ] **Step 6: Commit**

```bash
git add service-worker.js
git commit -m "feat: point cache with 6h staleness gate; startup fetch only when stale"
```

---

### Task 2: Always-on content script that reads points while browsing

**Files:**
- Create: `content_scripts/readPoints.js`
- Modify: `manifest.json`

- [ ] **Step 1: Create `content_scripts/readPoints.js`**

```js
// 常駐：使用者逛任何 SteamGifts 頁面時，免費讀取目前點數寫入快取（不發請求）
(() => {
  const el = document.querySelector('.nav__points');
  if (!el) return;
  const point = Number((el.textContent || '').replace(/[^0-9]/g, ''));
  if (Number.isNaN(point)) return;
  chrome.storage.local.set({ currentPoint: point, pointUpdatedAt: Date.now() });
})();
```

- [ ] **Step 2: Declare the static content script in `manifest.json`**

In `manifest.json`, find the top-level keys. After the `"background"` block (and before `"options_page"`), add a `"content_scripts"` array:

```json
  "background": {
    "service_worker": "service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["*://www.steamgifts.com/*"],
      "js": ["content_scripts/readPoints.js"],
      "run_at": "document_idle"
    }
  ],
  "options_page": "options/options.html",
```

(Leave every other field unchanged. No new permissions: `storage` is already granted and the match URL is already in `host_permissions`.)

- [ ] **Step 3: Verify manifest is valid JSON and the script parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest OK')"`
Expected: `manifest OK`

Run: `node --check content_scripts/readPoints.js`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add content_scripts/readPoints.js manifest.json
git commit -m "feat: always-on content script caches points while browsing SteamGifts"
```

---

### Task 3: Full-auto reports leftover points (free refresh)

**Files:**
- Modify: `offscreen.js`

`runFullAuto` already tracks `myPoint` (starting points minus each successful entry's cost). Return it alongside `count` and forward it in the result message so the SW (Task 1, Step 4) can cache it without any extra request.

- [ ] **Step 1: Return `{count, point}` from `runFullAuto`**

In `offscreen.js`, find the end of `runFullAuto`:

```js
    await delayRandom();
  }
  return count;
}
```

Change the return to include the leftover points:

```js
    await delayRandom();
  }
  return { count, point: myPoint };
}
```

- [ ] **Step 2: Forward `point` in the result message**

Find the message listener at the top of `offscreen.js`:

```js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "runFullAuto") return;
  runFullAuto(message.cfg || {})
    .then((count) => chrome.runtime.sendMessage({ type: "fullAutoResult", count }))
    .catch(() => chrome.runtime.sendMessage({ type: "fullAutoResult", count: 0 }));
});
```

Replace it with (destructure the new return shape):

```js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "runFullAuto") return;
  runFullAuto(message.cfg || {})
    .then(({ count, point }) => chrome.runtime.sendMessage({ type: "fullAutoResult", count, point }))
    .catch(() => chrome.runtime.sendMessage({ type: "fullAutoResult", count: 0 }));
});
```

- [ ] **Step 3: Verify it parses**

Run: `node --check offscreen.js`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add offscreen.js
git commit -m "feat: full-auto reports leftover points so the cache refreshes for free"
```

---

### Task 4: Relative "updated N ago" helper (TDD)

**Files:**
- Create: `content_scripts/relativeTime.js`
- Create: `tests/relative-time.test.js`

A pure, testable function that converts a timestamp into a localized "updated N ago" string. It takes the current time and an i18n lookup as parameters so it is deterministic and has no `chrome.*`/`Date.now()` dependency inside.

- [ ] **Step 1: Write the failing tests**

Create `tests/relative-time.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { relativeUpdatedText } = require('../content_scripts/relativeTime.js');

// Fake i18n: returns "key" or "key:N" so tests assert on the chosen branch + number.
const t = (key, n) => (n === undefined ? key : `${key}:${n}`);
const NOW = 1_000_000_000_000;

test('returns the "never" string when updatedAt is missing/0', () => {
  assert.strictEqual(relativeUpdatedText(0, NOW, t), 'pointUpdatedNever');
  assert.strictEqual(relativeUpdatedText(undefined, NOW, t), 'pointUpdatedNever');
});

test('under 60 seconds is "just now"', () => {
  assert.strictEqual(relativeUpdatedText(NOW - 30 * 1000, NOW, t), 'pointUpdatedJustNow');
});

test('minutes branch reports whole minutes', () => {
  assert.strictEqual(relativeUpdatedText(NOW - 5 * 60 * 1000, NOW, t), 'pointUpdatedMinutes:5');
});

test('hours branch reports whole hours', () => {
  assert.strictEqual(relativeUpdatedText(NOW - 3 * 60 * 60 * 1000, NOW, t), 'pointUpdatedHours:3');
});

test('days branch reports whole days', () => {
  assert.strictEqual(relativeUpdatedText(NOW - 2 * 24 * 60 * 60 * 1000, NOW, t), 'pointUpdatedDays:2');
});

test('a future-ish/zero diff still reads as just now, not negative', () => {
  assert.strictEqual(relativeUpdatedText(NOW, NOW, t), 'pointUpdatedJustNow');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../content_scripts/relativeTime.js'`.

- [ ] **Step 3: Implement `content_scripts/relativeTime.js`**

```js
(function (root) {
  // updatedAt: epoch ms (0/undefined = 從未更新)；now: epoch ms；t: (key, n?) => string
  function relativeUpdatedText(updatedAt, now, t) {
    if (!updatedAt) return t('pointUpdatedNever');
    const diff = Math.max(0, now - updatedAt);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return t('pointUpdatedJustNow');
    const min = Math.floor(sec / 60);
    if (min < 60) return t('pointUpdatedMinutes', min);
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('pointUpdatedHours', hr);
    const day = Math.floor(hr / 24);
    return t('pointUpdatedDays', day);
  }

  root.RelativeTime = { relativeUpdatedText };
  if (typeof module !== 'undefined' && module.exports) module.exports = { relativeUpdatedText };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all `relative-time` tests pass and the existing 27 stay green.

- [ ] **Step 5: Commit**

```bash
git add content_scripts/relativeTime.js tests/relative-time.test.js
git commit -m "feat: pure relativeUpdatedText helper for the popup point line"
```

---

### Task 5: Popup consumes the cache instead of fetching

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/init.js`
- Modify: `_locales/zh_TW/messages.json`
- Modify: `_locales/en/messages.json`

- [ ] **Step 1: Add the relative-time i18n keys (zh_TW)**

In `_locales/zh_TW/messages.json`, add these entries before the final closing `}` (append a comma to the current last entry `optResetDefault`):

```json
  "optResetDefault": { "message": "回復預設值", "description": "設定頁回復預設" },
  "pointUpdatedNever": { "message": "尚未更新", "description": "點數從未更新" },
  "pointUpdatedJustNow": { "message": "剛剛更新", "description": "點數剛剛更新" },
  "pointUpdatedMinutes": { "message": "更新於 $N$ 分鐘前", "placeholders": { "n": { "content": "$1" } }, "description": "點數更新於 N 分鐘前" },
  "pointUpdatedHours": { "message": "更新於 $N$ 小時前", "placeholders": { "n": { "content": "$1" } }, "description": "點數更新於 N 小時前" },
  "pointUpdatedDays": { "message": "更新於 $N$ 天前", "placeholders": { "n": { "content": "$1" } }, "description": "點數更新於 N 天前" }
```

- [ ] **Step 2: Add the same keys to `_locales/en/messages.json`**

Open `_locales/en/messages.json`, and add these entries before its final closing `}` (append a comma to its current last entry):

```json
  "pointUpdatedNever": { "message": "Not updated yet", "description": "points never updated" },
  "pointUpdatedJustNow": { "message": "Updated just now", "description": "points updated just now" },
  "pointUpdatedMinutes": { "message": "Updated $N$ min ago", "placeholders": { "n": { "content": "$1" } }, "description": "points updated N minutes ago" },
  "pointUpdatedHours": { "message": "Updated $N$ h ago", "placeholders": { "n": { "content": "$1" } }, "description": "points updated N hours ago" },
  "pointUpdatedDays": { "message": "Updated $N$ d ago", "placeholders": { "n": { "content": "$1" } }, "description": "points updated N days ago" }
```

- [ ] **Step 3: Add the updated-time element and load `relativeTime.js` in `popup/popup.html`**

Find the points status card:

```html
    <div class="status-card">
      <div class="status-label">__MSG_popPoints__</div>
      <div class="status-value" id="pointSpan">—</div>
    </div>
```

Replace it with (adds a small line under the value):

```html
    <div class="status-card">
      <div class="status-label">__MSG_popPoints__</div>
      <div class="status-value" id="pointSpan">—</div>
      <div class="status-sub" id="pointUpdatedSpan"></div>
    </div>
```

Then find the scripts at the bottom:

```html
  <script src="init.js"></script>
  <script src="popup.js"></script>
```

Add `relativeTime.js` **before** `init.js` (so `window.RelativeTime` exists when `init.js` runs):

```html
  <script src="../content_scripts/relativeTime.js"></script>
  <script src="init.js"></script>
  <script src="popup.js"></script>
```

- [ ] **Step 4: Replace the fetch in `popup/init.js` with cache display + gate trigger + live updates**

In `popup/init.js`, find the points fetch block:

```js
// fetch current SteamGifts points
fetch('https://www.steamgifts.com/')
  .then((res) => res.text())
  .then((html) => {
    const match = html.match(/<span class="nav__points">(\d+)<\/span>/);
    document.getElementById("pointSpan").innerText = match ? match[1] : '—';
  })
  .catch(() => { document.getElementById("pointSpan").innerText = '—'; });
```

Replace it with:

```js
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
```

- [ ] **Step 5: Add a style for the sub line in `popup/popup.css`**

Append to `popup/popup.css`:

```css
.status-sub {
  margin-top: 2px;
  font-size: 11px;
  opacity: 0.6;
}
```

- [ ] **Step 6: Verify locales are valid JSON and scripts parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('_locales/zh_TW/messages.json','utf8')); JSON.parse(require('fs').readFileSync('_locales/en/messages.json','utf8')); console.log('locales OK')"`
Expected: `locales OK`

Run: `node --check popup/init.js`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add popup/popup.html popup/init.js popup/popup.css _locales/zh_TW/messages.json _locales/en/messages.json
git commit -m "feat: popup shows cached points + updated-ago, fetches only when stale"
```

---

### Task 6: Version bump + end-to-end manual verification

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Bump the manifest version**

In `manifest.json`, change:

```json
  "version": "1.2",
```

to:

```json
  "version": "1.3",
```

- [ ] **Step 2: Reload and verify the four behaviors on the live extension**

1. `chrome://extensions` → reload the unpacked extension. Make sure you are **logged in** to SteamGifts in this browser.
2. **No-fetch-on-repeat-open:** Open DevTools on the popup (right-click the popup → Inspect), go to the Network tab, and open the popup several times within a few minutes. Expected: at most **one** request to `steamgifts.com` (only if the cache was ≥6h old / empty); subsequent opens show the cached number and an "updated …ago" line with **no** new request.
3. **Free refresh while browsing:** Visit any SteamGifts page (e.g. the wishlist). Then open the popup. Expected: `currentPoint` reflects the page's nav points and the sub-line says it updated moments ago. Confirm in DevTools → Application → Storage → Extension storage (`local`) that `currentPoint`/`pointUpdatedAt` changed, and that loading the SteamGifts page issued **no** extra extension-initiated point request (it just read the DOM).
4. **Full-auto refresh:** Run full-auto once. After the done notification, open the popup. Expected: the point value dropped to the post-run leftover and the sub-line shows it just updated — with no separate point fetch beyond full-auto's own wishlist load.
5. **Startup gate:** With a fresh cache (just updated), fully quit and reopen the browser. Expected: **no** startup point notification (cache is <6h fresh). To see the notification, set the cache stale first: DevTools on the service worker → Console → `chrome.storage.local.set({ pointUpdatedAt: 0 })`, then restart the browser → expect one fetch + the "你目前的點數" notification.

- [ ] **Step 3: Confirm the unit suite is still green**

Run: `npm test`
Expected: `# fail 0` (giveaway-core + relative-time suites pass).

- [ ] **Step 4: Commit**

```bash
git add manifest.json
git commit -m "chore: bump version to 1.3 for point-cache staleness gate"
```

---

## Self-Review

**Spec coverage:**
- Cache in `chrome.storage.local` (`currentPoint`/`pointUpdatedAt`) → Task 1 (`storePoints`), Task 2 (content script), Task 5 (popup read).
- 6h staleness gate, fetch with `credentials:"include"`, fixes the credential-less bug → Task 1 (`refreshPointsIfStale`).
- Startup trigger gated + notify-only-when-fetched → Task 1 Step 2.
- Popup trigger: show cache, gate via SW, react to `storage.onChanged`, "updated N ago" line → Tasks 4 + 5.
- Always-on content script (independent of countScore/autoScore) → Task 2.
- Full-auto free report of leftover points → Task 3 (offscreen return + message) + Task 1 Step 4 (`storePoints(message.point)`).
- Relative-time text + i18n keys → Task 4 (logic/tests) + Task 5 Steps 1–2 (keys).
- No new permissions; no `chrome.alarms`; version 1.2→1.3 → Task 2 (manifest, no perms) + Task 6.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows complete before/after code; every run step states the exact command and expected output.

**Type/name consistency:** `refreshPointsIfStale({notify})`, `storePoints(point)`, `POINT_TTL_MS`, `HOME_URL`, and message type `"refreshPointsIfStale"` are defined in Task 1 and reused verbatim in Tasks 3/5. `fullAutoResult` carries `{count, point}` — produced in Task 3 (offscreen) and consumed in Task 1 Step 4 (`message.point`). `relativeUpdatedText(updatedAt, now, t)` is defined in Task 4 and called in Task 5 with `(pointUpdatedAt||0, Date.now(), i18n)`; the i18n keys `pointUpdatedNever/JustNow/Minutes/Hours/Days` match between the helper branches (Task 4), the locale files (Task 5 Steps 1–2), and the `$N$` placeholder name `n`. Storage area is `local` consistently across writer (`storePoints`, content script) and readers (popup `get` + `onChanged area === "local"`).

**Known note (not a placeholder):** the SW point paths use `chrome.*`/`fetch` and have no unit harness, matching the existing repo; they are covered by the Task 6 manual checks. Only the pure `relativeUpdatedText` helper is unit-tested, by design.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-06-point-cache-staleness-gate.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
