# Dashboard Settings Page + Entry History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Chrome-extension options page into a single-scroll dashboard (KPI stats + last-20-games list) and add the per-entry data collection that feeds it.

**Architecture:** Pure, unit-tested helper modules (`entryRecord.js`, plus additions to `serial-counter.js` and `relativeTime.js`) hold all logic. The service worker composes them to serialize writes of a capped `recentEntries` list (`storage.local`) and a `totalAttempts` counter (`storage.sync`). Both entry paths (safe-mode `autoStart.js`, aggressive-mode `offscreen.js`) report each attempt; `options.js` reads storage and renders the dashboard with DOM APIs (no innerHTML, to stay safe against game-name HTML).

**Tech Stack:** Vanilla JS Chrome MV3 extension, `node --test` for unit tests, jsdom (already a devDependency, not needed here), `chrome.i18n` + `_locales` for strings.

---

## File Structure

**New files:**
- `content_scripts/entryRecord.js` — pure `pushRecentEntry(list, entry, max)` + `successRate(success, attempts)`.
- `tests/entry-record.test.js` — unit tests for the above.

**Modified files:**
- `lib/serial-counter.js` — add `createSerialList(adapter, transform)`; export it.
- `tests/serial-counter.test.js` — add a `createSerialList` test.
- `content_scripts/relativeTime.js` — add `relativeAgoText(time, now, t)`; export it.
- `tests/relative-time.test.js` — add `relativeAgoText` tests.
- `defaultSchema.json` — add `totalAttempts: 0`.
- `tests/default-schema.test.js` — assert `totalAttempts`.
- `service-worker.js` — import `entryRecord.js`; build `recentList`; handle `recordEntry`; process `entries` in `fullAutoResult`; add `totalAttempts` to `NO_RELOAD_KEYS`.
- `content_scripts/autoStart.js` — send `recordEntry` on success and fail.
- `offscreen.js` — collect `entries`, return them in `fullAutoResult`.
- `_locales/en/messages.json` + `_locales/zh_TW/messages.json` — new keys.
- `options/options.html` — dashboard markup + settings card grid.
- `options/options.css` — dashboard + grid styles, wider body.
- `options/options.js` — render KPIs/list, include new scripts, reset-all.

**Note on tests:** Tasks 1–4 are pure logic → full TDD with `node --test`. Tasks 5–8 and 11 touch `chrome.*` / DOM globals that `node --test` cannot load, so they are verified by the **manual load-and-observe** steps spelled out in each task (load the unpacked extension in Chrome and watch storage/UI). Do not fabricate automated tests for chrome-API glue.

---

## Task 1: Pure entry-record module

**Files:**
- Create: `content_scripts/entryRecord.js`
- Test: `tests/entry-record.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/entry-record.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { pushRecentEntry, successRate } = require('../content_scripts/entryRecord.js');

test('pushRecentEntry puts the newest entry first', () => {
  const list = [{ name: 'A' }];
  assert.deepStrictEqual(pushRecentEntry(list, { name: 'B' }), [{ name: 'B' }, { name: 'A' }]);
});

test('pushRecentEntry caps the list at max (default 20)', () => {
  let list = [];
  for (let i = 0; i < 25; i++) list = pushRecentEntry(list, { name: String(i) });
  assert.strictEqual(list.length, 20);
  assert.strictEqual(list[0].name, '24'); // newest
  assert.strictEqual(list[19].name, '5'); // oldest kept
});

test('pushRecentEntry tolerates a non-array starting value', () => {
  assert.deepStrictEqual(pushRecentEntry(undefined, { name: 'X' }), [{ name: 'X' }]);
});

test('successRate returns an integer percent', () => {
  assert.strictEqual(successRate(9, 10), 90);
  assert.strictEqual(successRate(1, 3), 33);
});

test('successRate returns null when there are no attempts', () => {
  assert.strictEqual(successRate(0, 0), null);
  assert.strictEqual(successRate(5, undefined), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/entry-record.test.js`
Expected: FAIL — `Cannot find module '../content_scripts/entryRecord.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `content_scripts/entryRecord.js`:

```js
(function (root) {
  // Newest-first, capped list of giveaway entry records.
  function pushRecentEntry(list, entry, max = 20) {
    const base = Array.isArray(list) ? list : [];
    return [entry, ...base].slice(0, max);
  }

  // Lifetime success rate as an integer percent, or null when there are no attempts.
  function successRate(success, attempts) {
    const a = Number(attempts) || 0;
    if (a <= 0) return null;
    const s = Number(success) || 0;
    return Math.round((s / a) * 100);
  }

  root.EntryRecord = { pushRecentEntry, successRate };
  if (typeof module !== 'undefined' && module.exports) module.exports = { pushRecentEntry, successRate };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/entry-record.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add content_scripts/entryRecord.js tests/entry-record.test.js
git commit -m "feat: pure entryRecord module (pushRecentEntry, successRate)"
```

---

## Task 2: Serialized list writer

**Files:**
- Modify: `lib/serial-counter.js`
- Test: `tests/serial-counter.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/serial-counter.test.js` (note the import line at the top of that file currently destructures only `createSerialCounter` — update it to also pull `createSerialList`):

Change the existing top line:

```js
const { createSerialCounter } = require('../lib/serial-counter.js');
```

to:

```js
const { createSerialCounter, createSerialList } = require('../lib/serial-counter.js');
```

Then append this test:

```js
test('createSerialList serializes pushes and applies the transform/cap', async () => {
  let value;
  const adapter = {
    get: () => new Promise((r) => setTimeout(() => r(value), 1)),
    set: (key, v) => new Promise((r) => setTimeout(() => { value = v; r(); }, 1)),
  };
  // newest-first, cap 3
  const list = createSerialList(adapter, (l, item) => [item, ...l].slice(0, 3));
  await Promise.all([1, 2, 3, 4, 5].map((n) => list.push('k', n)));
  assert.deepStrictEqual(value, [5, 4, 3]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/serial-counter.test.js`
Expected: FAIL — `createSerialList is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/serial-counter.js`, add `createSerialList` after `createSerialCounter` and export it. Replace the export line `root.SerialCounter = { createSerialCounter };` and the `module.exports` line accordingly:

```js
  // Serialize read-modify-write list updates through one promise chain, same as
  // createSerialCounter but for arrays. `transform(currentList, item) -> newList`.
  function createSerialList(adapter, transform) {
    let chain = Promise.resolve();
    function push(key, item) {
      const result = chain.then(async () => {
        const current = (await adapter.get(key)) || [];
        await adapter.set(key, transform(current, item));
      });
      chain = result.catch(() => {});
      return result;
    }
    return { push };
  }

  root.SerialCounter = { createSerialCounter, createSerialList };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createSerialCounter, createSerialList };
```

(Delete the previous `root.SerialCounter = { createSerialCounter };` and its old `module.exports` line so they are not declared twice.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/serial-counter.test.js`
Expected: PASS (existing 3 tests + new one).

- [ ] **Step 5: Commit**

```bash
git add lib/serial-counter.js tests/serial-counter.test.js
git commit -m "feat: createSerialList for serialized capped-list writes"
```

---

## Task 3: Relative "N ago" formatter + locale keys

**Files:**
- Modify: `content_scripts/relativeTime.js`
- Modify: `_locales/en/messages.json`, `_locales/zh_TW/messages.json`
- Test: `tests/relative-time.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/relative-time.test.js` (its top already imports from the module; update that import). Change:

```js
const { relativeUpdatedText } = require('../content_scripts/relativeTime.js');
```

to:

```js
const { relativeUpdatedText, relativeAgoText } = require('../content_scripts/relativeTime.js');
```

Append:

```js
test('relativeAgoText: under a minute is just now', () => {
  assert.strictEqual(relativeAgoText(NOW - 20 * 1000, NOW, t), 'agoJustNow');
});
test('relativeAgoText: minutes / hours / days branches', () => {
  assert.strictEqual(relativeAgoText(NOW - 5 * 60 * 1000, NOW, t), 'agoMinutes:5');
  assert.strictEqual(relativeAgoText(NOW - 3 * 60 * 60 * 1000, NOW, t), 'agoHours:3');
  assert.strictEqual(relativeAgoText(NOW - 2 * 24 * 60 * 60 * 1000, NOW, t), 'agoDays:2');
});
test('relativeAgoText: zero/negative diff reads as just now', () => {
  assert.strictEqual(relativeAgoText(NOW, NOW, t), 'agoJustNow');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/relative-time.test.js`
Expected: FAIL — `relativeAgoText is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `content_scripts/relativeTime.js`, add `relativeAgoText` and export it. Add this function above the export, and replace the export lines:

```js
  // time: epoch ms when the thing happened; now: epoch ms; t: (key, n?) => string.
  function relativeAgoText(time, now, t) {
    const diff = Math.max(0, now - time);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return t('agoJustNow');
    const min = Math.floor(sec / 60);
    if (min < 60) return t('agoMinutes', min);
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('agoHours', hr);
    const day = Math.floor(hr / 24);
    return t('agoDays', day);
  }

  root.RelativeTime = { relativeUpdatedText, relativeAgoText };
  if (typeof module !== 'undefined' && module.exports) module.exports = { relativeUpdatedText, relativeAgoText };
```

(Remove the old single-function `root.RelativeTime = { relativeUpdatedText };` and its `module.exports` so nothing is declared twice.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/relative-time.test.js`
Expected: PASS.

- [ ] **Step 5: Add locale keys**

In `_locales/zh_TW/messages.json`, add:

```json
  "agoJustNow": { "message": "剛剛", "description": "相對時間：剛剛" },
  "agoMinutes": { "message": "$N$ 分鐘前", "placeholders": { "n": { "content": "$1" } }, "description": "相對時間：N 分鐘前" },
  "agoHours": { "message": "$N$ 小時前", "placeholders": { "n": { "content": "$1" } }, "description": "相對時間：N 小時前" },
  "agoDays": { "message": "$N$ 天前", "placeholders": { "n": { "content": "$1" } }, "description": "相對時間：N 天前" }
```

In `_locales/en/messages.json`, add:

```json
  "agoJustNow": { "message": "just now", "description": "relative time: just now" },
  "agoMinutes": { "message": "$N$ min ago", "placeholders": { "n": { "content": "$1" } }, "description": "relative time: N minutes ago" },
  "agoHours": { "message": "$N$ hr ago", "placeholders": { "n": { "content": "$1" } }, "description": "relative time: N hours ago" },
  "agoDays": { "message": "$N$ days ago", "placeholders": { "n": { "content": "$1" } }, "description": "relative time: N days ago" }
```

(Insert before the final closing `}` of each file; ensure the preceding entry ends with a comma. Verify with `node -e "require('./_locales/en/messages.json'); require('./_locales/zh_TW/messages.json'); console.log('json ok')"`.)

- [ ] **Step 6: Commit**

```bash
git add content_scripts/relativeTime.js tests/relative-time.test.js _locales/en/messages.json _locales/zh_TW/messages.json
git commit -m "feat: relativeAgoText formatter + ago* locale keys"
```

---

## Task 4: Seed totalAttempts in defaultSchema

**Files:**
- Modify: `defaultSchema.json`
- Test: `tests/default-schema.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/default-schema.test.js`:

```js
test('defaultSchema seeds totalAttempts at 0', () => {
  assert.strictEqual(schema.totalAttempts, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/default-schema.test.js`
Expected: FAIL — `undefined !== 0`.

- [ ] **Step 3: Add the key**

In `defaultSchema.json`, add `"totalAttempts": 0,` right after the `"totalEnterGiveaway": 0,` line:

```json
  "totalEnterGiveaway": 0,
  "totalAttempts": 0,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/default-schema.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add defaultSchema.json tests/default-schema.test.js
git commit -m "feat: seed totalAttempts default in defaultSchema"
```

---

## Task 5: Service worker — record attempts and entries

**Files:**
- Modify: `service-worker.js`

This task wires `chrome.*` glue; verify it manually (Step 5). No `node --test`.

- [ ] **Step 1: Import the module and build the list writer**

At the top of `service-worker.js`, after the existing `importScripts('content_scripts/humanize.js');` line add:

```js
importScripts('content_scripts/entryRecord.js');
```

After the existing `const totalCounter = self.SerialCounter.createSerialCounter({ ... });` block, add:

```js
const recentList = self.SerialCounter.createSerialList(
  {
    get: (key) => new Promise((res) => chrome.storage.local.get([key], (o) => res(o[key] || []))),
    set: (key, value) => new Promise((res) => chrome.storage.local.set({ [key]: value }, res)),
  },
  (list, item) => self.EntryRecord.pushRecentEntry(list, item, 20)
);
```

- [ ] **Step 2: Add the `recordEntry` message case**

In the `chrome.runtime.onMessage.addListener` switch, add a new case (place it next to `enterCommitted`):

```js
    case "recordEntry": {
      // 每次抽獎嘗試（成功或失敗）：累計嘗試數 + 寫入最近 20 款（皆走 SW 串行化）。
      totalCounter.increment("totalAttempts", 1);
      recentList.push("recentEntries", {
        name: message.name || "",
        url: message.url || "",
        points: message.points || 0,
        result: message.result,
        time: message.time || Date.now(),
      });
      break;
    }
```

- [ ] **Step 3: Process `entries` from aggressive mode**

Inside the existing `case "fullAutoResult":` block, after the `if (message.count > 0) { ... }` counter section, add:

```js
      if (Array.isArray(message.entries)) {
        message.entries.forEach((e) => {
          totalCounter.increment("totalAttempts", 1);
          recentList.push("recentEntries", e);
        });
      }
```

- [ ] **Step 4: Keep totalAttempts from reloading pages**

`totalAttempts` lives in `storage.sync`, and the `chrome.storage.onChanged` handler reloads all SteamGifts tabs on any non-cosmetic sync change. Add `"totalAttempts"` to the existing `NO_RELOAD_KEYS` array so per-attempt writes don't trigger reloads:

```js
  const NO_RELOAD_KEYS = ["totalEnterGiveaway", "totalAttempts", "fullAutoWarned", "goLinkTarget"];
```

- [ ] **Step 5: Manual verification**

Load the unpacked extension (chrome://extensions → Developer mode → Load unpacked → project root). Open the service worker console (the extension's "service worker" link). Run in that console:

```js
chrome.runtime.sendMessage({ type: "recordEntry", name: "Test Game", url: "https://www.steamgifts.com/giveaway/abc/test", points: 12, result: "success" });
setTimeout(() => chrome.storage.local.get(["recentEntries"], (o) => console.log(o.recentEntries)), 200);
setTimeout(() => chrome.storage.sync.get(["totalAttempts"], (o) => console.log("attempts", o.totalAttempts)), 200);
```

Expected: `recentEntries` is a 1-element array with the test entry (has a numeric `time`); `attempts` incremented by 1. Confirm no SteamGifts tab reloaded.

- [ ] **Step 6: Commit**

```bash
git add service-worker.js
git commit -m "feat: SW records entry attempts into recentEntries + totalAttempts"
```

---

## Task 6: Safe mode — report each attempt

**Files:**
- Modify: `content_scripts/autoStart.js`

This task touches DOM/`chrome.*` glue; verify manually (Step 3).

- [ ] **Step 1: Capture game info and send `recordEntry`**

In the `enterAll(list)` function, the loop currently reads:

```js
            async function enterAll(list) {
              for (const row of list) {
                if (remaining <= 0) break; // 今日額度用完就停
                try {
                  await enterGiveaway(row);
                  countEntryGift++;
                  autoJoinCount++;
                  remaining--;
                  chrome.runtime.sendMessage({
                    type: "setBadgeText",
                    text: String(countEntryGift),
                  });
                  // 計數寫入交由 SW 串行化（autoJoinCount + totalEnterGiveaway），避免多分頁競態。
                  chrome.runtime.sendMessage({ type: "enterCommitted" });
                  giftCardUiChange({
                    cardElement: row,
                    text: CARD_TEXT.Enter,
                    ...CARD_STATE.Success,
                  });
                } catch (e) {
                  giftCardUiChange({
                    cardElement: row,
                    text: CARD_TEXT.Fail,
                    ...CARD_STATE.Fail,
                  });
                }
```

Replace that portion (from `for (const row of list) {` through the `} catch (e) { ... }` block) with the version below. It captures name/url/cost **before** `giftCardUiChange` mutates the heading, and sends `recordEntry` on both paths:

```js
            async function enterAll(list) {
              for (const row of list) {
                if (remaining <= 0) break; // 今日額度用完就停
                const nameLink = row.querySelector(".giveaway__heading__name");
                const gameName = nameLink ? nameLink.textContent.trim() : "";
                const gameUrl = nameLink ? nameLink.href : "";
                const gameCost = core.parsePointCost(row) || 0;
                try {
                  await enterGiveaway(row);
                  countEntryGift++;
                  autoJoinCount++;
                  remaining--;
                  chrome.runtime.sendMessage({
                    type: "setBadgeText",
                    text: String(countEntryGift),
                  });
                  // 計數寫入交由 SW 串行化（autoJoinCount + totalEnterGiveaway），避免多分頁競態。
                  chrome.runtime.sendMessage({ type: "enterCommitted" });
                  chrome.runtime.sendMessage({
                    type: "recordEntry",
                    name: gameName,
                    url: gameUrl,
                    points: gameCost,
                    result: "success",
                    time: Date.now(),
                  });
                  giftCardUiChange({
                    cardElement: row,
                    text: CARD_TEXT.Enter,
                    ...CARD_STATE.Success,
                  });
                } catch (e) {
                  chrome.runtime.sendMessage({
                    type: "recordEntry",
                    name: gameName,
                    url: gameUrl,
                    points: 0,
                    result: "fail",
                    time: Date.now(),
                  });
                  giftCardUiChange({
                    cardElement: row,
                    text: CARD_TEXT.Fail,
                    ...CARD_STATE.Fail,
                  });
                }
```

(Leave the rest of the loop — the `await delay(...)`, break, and early-stop lines — unchanged.)

- [ ] **Step 2: Lint check (syntax only)**

Run: `node --check content_scripts/autoStart.js`
Expected: no output (exit 0) = valid syntax.

- [ ] **Step 3: Manual verification**

Reload the unpacked extension. Enable safe-mode auto-start (Options: 全自動 on; aggressive OFF), open the wishlist page so `autoStart.js` runs and enters at least one giveaway. Then in the service-worker console:

```js
chrome.storage.local.get(["recentEntries"], (o) => console.log(o.recentEntries));
```

Expected: the entered game(s) appear newest-first with real `name`, absolute `url`, `points`, `result:"success"`.

- [ ] **Step 4: Commit**

```bash
git add content_scripts/autoStart.js
git commit -m "feat: safe-mode reports each entry attempt to SW"
```

---

## Task 7: Aggressive mode — collect entries

**Files:**
- Modify: `offscreen.js`

- [ ] **Step 1: Collect entries in the loop and return them**

In `offscreen.js`, `runFullAuto` currently has `let count = 0;` before the `for (const row of eligible)` loop, and returns `{ count, point: myPoint, loggedIn: true }`. Make three edits:

(a) Before the loop, after `let count = 0;`, add:

```js
  const entries = [];
```

(b) Inside the loop, after the `const ok = await enterOne(code, xsrf);` / `if (ok) { myPoint -= cost; count++; }` lines and **before** `await delay(human.humanDelayMs(hcfg));`, add:

```js
    const nameLink = row.querySelector('.giveaway__heading__name');
    const name = nameLink ? nameLink.textContent.trim() : "";
    const path = nameLink ? nameLink.getAttribute('href') : "";
    const url = path ? new URL(path, "https://www.steamgifts.com").href : "";
    entries.push({ name, url, points: ok ? cost : 0, result: ok ? "success" : "fail", time: Date.now() });
```

(c) Change the final `return { count, point: myPoint, loggedIn: true };` to:

```js
  return { count, point: myPoint, loggedIn: true, entries };
```

- [ ] **Step 2: Forward entries to the service worker**

In the `chrome.runtime.onMessage.addListener` at the top of `offscreen.js`, the success path currently reads:

```js
    .then(({ count, point, loggedIn }) => chrome.runtime.sendMessage({ type: "fullAutoResult", count, point, loggedIn }))
```

Change it to:

```js
    .then(({ count, point, loggedIn, entries }) => chrome.runtime.sendMessage({ type: "fullAutoResult", count, point, loggedIn, entries }))
```

- [ ] **Step 3: Lint check**

Run: `node --check offscreen.js`
Expected: exit 0, no output.

- [ ] **Step 4: Manual verification**

Reload the extension. Enable aggressive mode (Options: 激進模式 on) and trigger 全自動 from the popup during active hours. After the run notification, in the service-worker console:

```js
chrome.storage.local.get(["recentEntries"], (o) => console.log(o.recentEntries));
chrome.storage.sync.get(["totalAttempts"], (o) => console.log("attempts", o.totalAttempts));
```

Expected: attempted games (success and any fail) appear newest-first with absolute `url`s; `totalAttempts` rose by the number of attempts.

- [ ] **Step 5: Commit**

```bash
git add offscreen.js
git commit -m "feat: aggressive mode collects entry records and returns them"
```

---

## Task 8: Dashboard locale keys

**Files:**
- Modify: `_locales/en/messages.json`, `_locales/zh_TW/messages.json`

- [ ] **Step 1: Add the keys**

In `_locales/zh_TW/messages.json`, add:

```json
  "kpiTotal": { "message": "累計抽獎", "description": "儀表板 KPI：累計抽獎數" },
  "kpiToday": { "message": "今日 / 上限", "description": "儀表板 KPI：今日已抽/上限" },
  "kpiPoints": { "message": "目前點數", "description": "儀表板 KPI：目前點數" },
  "kpiSuccess": { "message": "成功率", "description": "儀表板 KPI：全期成功率" },
  "recentTitle": { "message": "最近進入的 20 款遊戲", "description": "儀表板：最近抽獎清單標題" },
  "recentHint": { "message": "點名稱可開啟抽獎頁", "description": "儀表板：清單提示" },
  "recentEmpty": { "message": "尚無抽獎紀錄", "description": "儀表板：清單空狀態" },
  "badgeSuccess": { "message": "成功", "description": "儀表板：成功徽章" },
  "badgeFail": { "message": "失敗", "description": "儀表板：失敗徽章" },
  "optSettings": { "message": "設定", "description": "設定區分隔標題" }
```

In `_locales/en/messages.json`, add:

```json
  "kpiTotal": { "message": "Total entries", "description": "dashboard KPI: cumulative entries" },
  "kpiToday": { "message": "Today / Cap", "description": "dashboard KPI: today vs cap" },
  "kpiPoints": { "message": "Current points", "description": "dashboard KPI: current points" },
  "kpiSuccess": { "message": "Success rate", "description": "dashboard KPI: lifetime success rate" },
  "recentTitle": { "message": "Last 20 giveaways entered", "description": "dashboard: recent list title" },
  "recentHint": { "message": "Click a name to open its giveaway", "description": "dashboard: list hint" },
  "recentEmpty": { "message": "No entries yet", "description": "dashboard: empty list" },
  "badgeSuccess": { "message": "Success", "description": "dashboard: success badge" },
  "badgeFail": { "message": "Fail", "description": "dashboard: fail badge" },
  "optSettings": { "message": "Settings", "description": "settings section divider" }
```

(Insert before each file's final `}`; make sure the preceding line ends with a comma.)

- [ ] **Step 2: Validate JSON**

Run: `node -e "require('./_locales/en/messages.json'); require('./_locales/zh_TW/messages.json'); console.log('json ok')"`
Expected: `json ok`.

- [ ] **Step 3: Commit**

```bash
git add _locales/en/messages.json _locales/zh_TW/messages.json
git commit -m "feat: dashboard locale keys (KPI labels, recent list, badges)"
```

---

## Task 9: Options HTML — dashboard + settings grid

**Files:**
- Modify: `options/options.html`

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `options/options.html` with:

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

  <div class="dashboard">
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">__MSG_kpiTotal__</div><div class="kpi-value" id="kpiTotal">0</div></div>
      <div class="kpi"><div class="kpi-label">__MSG_kpiToday__</div><div class="kpi-value" id="kpiToday">0 / —</div></div>
      <div class="kpi"><div class="kpi-label">__MSG_kpiPoints__</div><div class="kpi-value" id="kpiPoints">—</div><div class="kpi-sub" id="kpiPointsSub"></div></div>
      <div class="kpi"><div class="kpi-label">__MSG_kpiSuccess__</div><div class="kpi-value" id="kpiSuccess">—</div></div>
    </div>

    <div class="recent">
      <div class="recent-head">
        <h2>__MSG_recentTitle__</h2>
        <span class="hint">__MSG_recentHint__</span>
      </div>
      <div class="recent-list" id="recentList"></div>
    </div>
  </div>

  <div class="settings-divider">__MSG_optSettings__</div>

  <div class="settings-grid">
    <section>
      <h2>__MSG_optWeights__</h2>
      <div class="weight-row"><input type="checkbox" id="w-restricted-on"><label for="w-restricted-on">__MSG_formRestricted__</label><input type="number" id="w-restricted-val" min="0" step="1"></div>
      <div class="weight-row"><input type="checkbox" id="w-whitelist-on"><label for="w-whitelist-on">__MSG_formWhitelist__</label><input type="number" id="w-whitelist-val" min="0" step="1"></div>
      <div class="weight-row"><input type="checkbox" id="w-group-on"><label for="w-group-on">__MSG_formGroup__</label><input type="number" id="w-group-val" min="0" step="1"></div>
      <div class="weight-row"><input type="checkbox" id="w-level-on"><label for="w-level-on">__MSG_formLevel__</label><input type="number" id="w-level-val" min="0" step="1"></div>
      <div class="weight-row"><input type="checkbox" id="w-cost-on"><label for="w-cost-on">__MSG_formCost__</label><input type="number" id="w-cost-val" min="0" step="1"></div>
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
      <h2>__MSG_optPointFloorTitle__</h2>
      <div class="field"><label for="pointFloor">__MSG_optPointFloor__</label><input type="number" id="pointFloor" min="0" step="1"></div>
    </section>

    <section class="wide">
      <h2>__MSG_optAutomation__</h2>
      <label class="field inline"><input type="checkbox" id="opt-autoScore">__MSG_formAutoScore__</label>
      <label class="field inline"><input type="checkbox" id="opt-autoStart">__MSG_formAutoStart__</label>
      <div class="field"><label>__MSG_optActiveHours__</label><input type="time" id="activeStart"> – <input type="time" id="activeEnd"></div>
      <label class="field inline"><input type="checkbox" id="opt-aggressive">__MSG_optAggressive__</label>
      <p class="warn">__MSG_optAggressiveWarn__</p>
    </section>

    <section class="wide">
      <h2>__MSG_optHumanizeTitle__</h2>
      <p class="hint">__MSG_optHumanizeHint__</p>

      <div class="field"><label for="hz-delayMedian">__MSG_hzDelayMedian__</label><input type="number" id="hz-delayMedian" min="2" step="1"></div>
      <div class="field"><label for="hz-delayMin">__MSG_hzDelayMin__</label><input type="number" id="hz-delayMin" min="2" step="1"></div>
      <div class="field"><label for="hz-delayMax">__MSG_hzDelayMax__</label><input type="number" id="hz-delayMax" min="2" step="1"></div>
      <div class="field"><label for="hz-readWpm">__MSG_hzReadWpm__</label><input type="number" id="hz-readWpm" min="60" max="1000" step="1"></div>
      <label class="field inline"><input type="checkbox" id="hz-readingEnabled">__MSG_hzReadingEnabled__</label>
      <div class="field"><label for="hz-breakProb">__MSG_hzBreakProb__</label><input type="number" id="hz-breakProb" min="0" max="100" step="1"></div>
      <div class="field"><label for="hz-earlyStopProb">__MSG_hzEarlyStopProb__</label><input type="number" id="hz-earlyStopProb" min="0" max="100" step="1"></div>
      <div class="field"><label for="hz-capMin">__MSG_hzCapMin__</label><input type="number" id="hz-capMin" min="0" step="1"></div>
      <div class="field"><label for="hz-capMax">__MSG_hzCapMax__</label><input type="number" id="hz-capMax" min="0" step="1"></div>

      <details>
        <summary>__MSG_optHumanizeAdvanced__</summary>
        <div class="field"><label for="hz-delaySigma">__MSG_hzDelaySigma__</label><input type="number" id="hz-delaySigma" min="0" max="2" step="0.05"></div>
        <div class="field"><label for="hz-readBase">__MSG_hzReadBase__</label><input type="number" id="hz-readBase" min="0" step="0.1"></div>
        <div class="field"><label for="hz-readMin">__MSG_hzReadMin__</label><input type="number" id="hz-readMin" min="0" step="0.1"></div>
        <div class="field"><label for="hz-readMax">__MSG_hzReadMax__</label><input type="number" id="hz-readMax" min="0" step="0.1"></div>
        <div class="field"><label for="hz-breakMin">__MSG_hzBreakMin__</label><input type="number" id="hz-breakMin" min="0" step="1"></div>
        <div class="field"><label for="hz-breakMax">__MSG_hzBreakMax__</label><input type="number" id="hz-breakMax" min="0" step="1"></div>
      </details>
    </section>

    <section class="wide">
      <h2>__MSG_optData__</h2>
      <button id="resetTotal">__MSG_optResetTotal__</button>
      <button id="resetDefault">__MSG_optResetDefault__</button>
    </section>
  </div>

  <script src="../content_scripts/relativeTime.js"></script>
  <script src="../content_scripts/entryRecord.js"></script>
  <script src="../content_scripts/humanize.js"></script>
  <script src="init.js"></script>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add options/options.html
git commit -m "feat: options dashboard markup + settings card grid"
```

---

## Task 10: Options CSS — dashboard + grid styles

**Files:**
- Modify: `options/options.css`

- [ ] **Step 1: Replace the file**

Replace the entire contents of `options/options.css` with (existing rules kept, body widened, dashboard/grid rules added):

```css
* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; font-size: 14px; padding: 20px; max-width: 780px; }
h1 { font-size: 20px; margin-bottom: 16px; }
section { border: 1px solid #e2e2e2; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; }
h2 { font-size: 15px; margin-bottom: 10px; }
.weight-row { display: grid; grid-template-columns: 24px 1fr 90px; gap: 8px; align-items: center; margin-bottom: 6px; }
.field { margin-bottom: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.field input[type="number"], select { padding: 4px 6px; }
.field input[type="number"] { width: 90px; }
label.inline { display: inline-flex; align-items: center; gap: 4px; }
button { padding: 8px 12px; margin-right: 8px; cursor: pointer; border: 1px solid #bbb; border-radius: 6px; background: #f6f6f6; }

/* Dashboard */
.dashboard { margin-bottom: 8px; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
.kpi { background: #fff; border: 1px solid #e6e9ee; border-radius: 8px; padding: 12px; }
.kpi-label { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #8a93a0; margin-bottom: 6px; }
.kpi-value { font-size: 22px; font-weight: 700; color: #243044; }
.kpi-sub { font-size: 11px; color: #9aa3b0; margin-top: 3px; }

.recent { background: #fff; border: 1px solid #e6e9ee; border-radius: 8px; overflow: hidden; }
.recent-head { display: flex; align-items: baseline; justify-content: space-between; padding: 12px 14px 8px; }
.recent-head h2 { font-size: 14px; margin: 0; }
.recent-head .hint { font-size: 11px; color: #9aa3b0; }
.recent-list { padding-bottom: 4px; }
.recent-row { display: grid; grid-template-columns: 56px 1fr 64px 84px; gap: 8px; align-items: center; padding: 9px 14px; border-top: 1px solid #f0f2f5; font-size: 13px; }
.badge { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 20px; text-align: center; }
.badge.ok { background: #e3f6ea; color: #1f8a4c; }
.badge.fail { background: #fdeaea; color: #c0392b; }
.recent-name { color: #2a5db0; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.recent-name:hover { text-decoration: underline; }
.recent-pts { color: #7a6a3a; text-align: right; }
.recent-tm { color: #9aa3b0; text-align: right; }
.recent-empty { padding: 16px 14px; color: #9aa3b0; font-size: 13px; }

/* Settings */
.settings-divider { display: flex; align-items: center; gap: 10px; color: #9aa3b0; font-size: 12px; letter-spacing: .05em; text-transform: uppercase; margin: 8px 0 14px; }
.settings-divider::before, .settings-divider::after { content: ""; flex: 1; height: 1px; background: #e2e6eb; }
.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.settings-grid section { margin-bottom: 0; }
.settings-grid .wide { grid-column: 1 / -1; }

@media (max-width: 600px) {
  .kpis { grid-template-columns: repeat(2, 1fr); }
  .settings-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 2: Commit**

```bash
git add options/options.css
git commit -m "feat: dashboard + settings-grid styles, wider options page"
```

---

## Task 11: Options JS — render dashboard + reset-all

**Files:**
- Modify: `options/options.js`

This task touches `chrome.*` / DOM; verify manually (Step 4).

- [ ] **Step 1: Add the dashboard render functions**

At the top of `options/options.js` (above `const WEIGHT_KEYS = ...`), add:

```js
// i18n helper for dynamic dashboard strings (mirrors the (key, n?) shape RelativeTime expects)
function t(key, n) {
  return n == null ? chrome.i18n.getMessage(key) : chrome.i18n.getMessage(key, [String(n)]);
}

function renderRecent(list) {
  const box = document.getElementById("recentList");
  box.textContent = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "recent-empty";
    empty.textContent = chrome.i18n.getMessage("recentEmpty");
    box.appendChild(empty);
    return;
  }
  list.forEach((e) => {
    const row = document.createElement("div");
    row.className = "recent-row";

    const ok = e.result === "success";
    const badge = document.createElement("span");
    badge.className = "badge " + (ok ? "ok" : "fail");
    badge.textContent = chrome.i18n.getMessage(ok ? "badgeSuccess" : "badgeFail");

    const name = document.createElement("a");
    name.className = "recent-name";
    name.textContent = e.name || "—"; // textContent: never trust page-derived names as HTML
    if (e.url) { name.href = e.url; name.target = "_blank"; name.rel = "noreferrer"; }

    const pts = document.createElement("span");
    pts.className = "recent-pts";
    pts.textContent = ok && e.points ? `${e.points}P` : "—";

    const tm = document.createElement("span");
    tm.className = "recent-tm";
    tm.textContent = window.RelativeTime.relativeAgoText(e.time || 0, Date.now(), t);

    row.append(badge, name, pts, tm);
    box.appendChild(row);
  });
}

function renderDashboard() {
  chrome.storage.sync.get(["totalEnterGiveaway", "totalAttempts"], (s) => {
    document.getElementById("kpiTotal").textContent = (s.totalEnterGiveaway || 0).toLocaleString();
    const rate = window.EntryRecord.successRate(s.totalEnterGiveaway, s.totalAttempts);
    document.getElementById("kpiSuccess").textContent = rate == null ? "—" : `${rate}%`;
  });
  chrome.storage.local.get(["currentPoint", "pointUpdatedAt", "autoJoinCount", "autoJoinCap", "recentEntries"], (s) => {
    document.getElementById("kpiPoints").textContent = s.currentPoint == null ? "—" : String(s.currentPoint);
    document.getElementById("kpiPointsSub").textContent = window.RelativeTime.relativeUpdatedText(s.pointUpdatedAt || 0, Date.now(), t);
    document.getElementById("kpiToday").textContent = `${s.autoJoinCount || 0} / ${s.autoJoinCap == null ? "—" : s.autoJoinCap}`;
    renderRecent(s.recentEntries || []);
  });
}
```

- [ ] **Step 2: Call render on load and keep it live**

At the very bottom of `options/options.js`, the file currently ends with a single `load();` call. Replace that final `load();` line with:

```js
load();
renderDashboard();

// 即時反映抽獎/點數變化（safe & aggressive 模式都會寫這些 key）
chrome.storage.onChanged.addListener((changes, area) => {
  const keys = Object.keys(changes);
  const hit = ["recentEntries", "currentPoint", "pointUpdatedAt", "autoJoinCount", "autoJoinCap", "totalEnterGiveaway", "totalAttempts"];
  if (keys.some((k) => hit.includes(k))) renderDashboard();
});
```

- [ ] **Step 3: Make "reset total" clear all stats**

In `options/options.js`, the current `resetTotal` handler is:

```js
document.getElementById("resetTotal").addEventListener("click", () => {
  chrome.storage.sync.set({ totalEnterGiveaway: 0 });
});
```

Replace it with:

```js
document.getElementById("resetTotal").addEventListener("click", () => {
  chrome.storage.sync.set({ totalEnterGiveaway: 0, totalAttempts: 0 });
  chrome.storage.local.set({ recentEntries: [] }, renderDashboard);
});
```

- [ ] **Step 4: Lint + manual verification**

Run: `node --check options/options.js`
Expected: exit 0.

Then reload the unpacked extension and open the Options page. Verify:
- Four KPI cards show real numbers (累計抽獎, 今日/上限, 目前點數 with relative sub-line, 成功率). With no attempts yet, 成功率 shows `—`.
- After entering giveaways (Task 6/7 runs), the recent list shows newest-first rows with badge, clickable name (opens giveaway in a new tab), points, and relative time. Empty state shows 「尚無抽獎紀錄」 before any entries.
- Click 「重置累計加入」: 累計抽獎 → 0, 成功率 → `—`, recent list → empty, immediately (no manual refresh).
- Existing settings inputs still load and persist exactly as before.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all test files pass (entry-record, serial-counter, relative-time, default-schema, giveaway-core, humanize).

- [ ] **Step 6: Commit**

```bash
git add options/options.js
git commit -m "feat: render dashboard KPIs/recent list; reset clears all stats"
```

---

## Final verification

- [ ] Run `npm test` — all green.
- [ ] Run `node --check service-worker.js content_scripts/autoStart.js offscreen.js options/options.js` — all valid.
- [ ] Load unpacked, run one safe-mode and one aggressive-mode session, confirm KPI numbers, recent list (success + fail rows), success-rate math, and the reset button against the spec's acceptance criteria.
```
