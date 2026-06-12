# Previously Won Skip-List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect SteamGifts' "Previously Won" quick-entry error after an auto-entry click, persist those giveaways to `chrome.storage.local`, never attempt them again (safe + aggressive mode), mark their cards red as `(Previously Won)` (same treatment as `(Not Enough Point)`), and list them on the options page.

**Architecture:** A new pure DOM helper `GiveawayCore.getQuickEntryError(row)` reads the transient error div (it appears for ~2–3 s after the click, well within the existing 500 ms poll). A new pure list helper `EntryRecord.pushWonEntry` dedups by giveaway code. The service worker owns the `previouslyWon` list in `chrome.storage.local` via the existing serial-list pattern (message type `recordPreviouslyWon`). `autoStart.js` (safe mode) pre-filters known-won rows and detects new ones after click; `offscreen.js` (aggressive mode) receives the won codes from the SW, skips them, and detects "Previously Won" in the ajax response. The options page renders the list with a clear button.

**Tech Stack:** Chrome MV3 extension (vanilla JS, no bundler), `node --test` + jsdom for unit tests.

---

## Background for the implementer (zero-context summary)

- **Safe mode flow** (`content_scripts/autoStart.js`): runs on the SteamGifts wishlist page. It collects `.giveaway__row-inner-wrap` rows, filters via `GiveawayCore.isEnterable`/`passesMinimum`, filters again by point budget (rows that fail get marked red with `(Not Enough Point)` via `giftCardUiChange`), then clicks each row's `.giveaway__quick-entry-btn--insert` and polls every 500 ms (12 tries) for `is-faded` (success) / `is-locked` (fail). All persistent writes go through `chrome.runtime.sendMessage` to the service worker.
- **Aggressive mode flow** (`offscreen.js`): fetches the wishlist HTML in an offscreen document and POSTs `do=entry_insert&code=...` to `https://www.steamgifts.com/ajax.php`. Success response is JSON `{"type":"success",...}`; errors are `{"type":"error","msg":"..."}`.
- **The error we detect** (from the saved real page `Free Giveaways and Keys for Steam Games.html`): when the user has already won that game, SteamGifts injects, inside the row's `.giveaway__quick-entry-wrap`:
  ```html
  <div class="giveaway__quick-entry-error"><i class="fa fa-exclamation-circle"></i><span>Previously Won</span></div>
  ```
  It disappears after ~2–3 seconds. The row does NOT become `is-faded` and the insert button does NOT become `is-locked`, so today this case burns 6 s of polling and is recorded as a generic fail — and is retried forever on every page load.
- **Storage decision:** the user said "localStorage", but `window.localStorage` on steamgifts.com is not readable from the options page. The codebase convention for exactly this kind of data (`recentEntries`) is `chrome.storage.local` written serially by the service worker. We use `chrome.storage.local` key `previouslyWon`: an array, newest first, deduped by `code`, uncapped (a user's won list grows slowly), entries shaped `{ code, name, url, time }`.
- **Reset semantics:** "Reset cumulative count" (`resetTotal`) does NOT touch `previouslyWon` (it is a skip-list, not a statistic). "Restore defaults" (`resetDefault`) clears it, and the new section has its own "Clear list" button (escape hatch for false positives).
- **No reload loop risk:** the SW's `storage.onChanged` reload listener only reacts to `sync` area changes; `previouslyWon` lives in `local`.
- **Run tests with:** `npm test` (uses `node --test`, requires `npm install` once for jsdom).

---

### Task 1: `GiveawayCore.getQuickEntryError(row)`

**Files:**
- Modify: `content_scripts/giveaway-core.js` (add method to the `GiveawayCore` object literal)
- Test: `tests/giveaway-core.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/giveaway-core.test.js`:

```js
test('getQuickEntryError returns the error text when the error div is present', () => {
  const dom = new (require('jsdom').JSDOM)(
    '<div class="giveaway__row-inner-wrap"><div class="giveaway__quick-entry-wrap">' +
    '<div class="giveaway__quick-entry-error"><i class="fa fa-exclamation-circle"></i><span>Previously Won</span></div>' +
    '</div></div>'
  );
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(GiveawayCore.getQuickEntryError(row), 'Previously Won');
});

test('getQuickEntryError returns null when no error div exists', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.getQuickEntryError(r[0]), null); // Row A: normal enterable row
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the two new tests FAIL with `TypeError: GiveawayCore.getQuickEntryError is not a function`; all pre-existing tests still pass.

- [ ] **Step 3: Implement the helper**

In `content_scripts/giveaway-core.js`, add a method to the object literal, after `isDescriptionGated` (i.e. after the line `return !!row.querySelector('.giveaway__quick-entry-btn--description');` and its closing `},`):

```js
    getQuickEntryError(row) {
      const el = row.querySelector('.giveaway__quick-entry-error');
      if (!el) return null;
      return (el.textContent || '').trim();
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/giveaway-core.test.js content_scripts/giveaway-core.js
git commit -m "feat: GiveawayCore.getQuickEntryError reads quick-entry error text"
```

---

### Task 2: `EntryRecord.pushWonEntry(list, entry)`

**Files:**
- Modify: `content_scripts/entryRecord.js`
- Test: `tests/entry-record.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/entry-record.test.js`, change the require line to also import the new function:

```js
const { pushRecentEntry, successRate, pushWonEntry } = require('../content_scripts/entryRecord.js');
```

Append:

```js
test('pushWonEntry puts the newest entry first', () => {
  const list = [{ code: 'aaa', name: 'A' }];
  assert.deepStrictEqual(
    pushWonEntry(list, { code: 'bbb', name: 'B' }),
    [{ code: 'bbb', name: 'B' }, { code: 'aaa', name: 'A' }]
  );
});

test('pushWonEntry ignores a duplicate code and returns the list unchanged', () => {
  const list = [{ code: 'aaa', name: 'A' }];
  assert.deepStrictEqual(pushWonEntry(list, { code: 'aaa', name: 'A again' }), [{ code: 'aaa', name: 'A' }]);
});

test('pushWonEntry tolerates a non-array starting value', () => {
  assert.deepStrictEqual(pushWonEntry(undefined, { code: 'xxx' }), [{ code: 'xxx' }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the three new tests FAIL with `TypeError: pushWonEntry is not a function`.

- [ ] **Step 3: Implement**

In `content_scripts/entryRecord.js`, add after the `successRate` function:

```js
  // Previously-won skip list: newest first, deduped by giveaway code, uncapped.
  function pushWonEntry(list, entry) {
    const base = Array.isArray(list) ? list : [];
    if (base.some((e) => e && e.code === entry.code)) return base;
    return [entry, ...base];
  }
```

And update both export lines to include it:

```js
  root.EntryRecord = { pushRecentEntry, successRate, pushWonEntry };
  if (typeof module !== 'undefined' && module.exports) module.exports = { pushRecentEntry, successRate, pushWonEntry };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/entry-record.test.js content_scripts/entryRecord.js
git commit -m "feat: EntryRecord.pushWonEntry deduped skip-list helper"
```

---

### Task 3: Service worker — persist `previouslyWon` via `recordPreviouslyWon` message

**Files:**
- Modify: `service-worker.js`

The SW already builds `recentList` with `SerialCounter.createSerialList` (lines 14–20). We add a parallel `wonList` and a message case. There are no unit tests for the SW (it is chrome-API glue, consistent with the rest of the file); verification is the full suite still passing plus the manual check in Task 7.

- [ ] **Step 1: Add the serial list**

In `service-worker.js`, directly after the `recentList` definition (after line 20), add:

```js
const wonList = self.SerialCounter.createSerialList(
  {
    get: (key) => new Promise((res) => chrome.storage.local.get([key], (o) => res(o[key] || []))),
    set: (key, value) => new Promise((res) => chrome.storage.local.set({ [key]: value }, res)),
  },
  (list, item) => self.EntryRecord.pushWonEntry(list, item)
);
```

- [ ] **Step 2: Add the message case**

In the `chrome.runtime.onMessage` switch, after the `case "recordEntry": { ... }` block, add:

```js
    case "recordPreviouslyWon": {
      // 已中獎偵測：寫入 local 的 previouslyWon 跳過清單（SW 串行化、依 code 去重）。
      wonList.push("previouslyWon", {
        code: message.code || "",
        name: message.name || "",
        url: message.url || "",
        time: message.time || Date.now(),
      });
      break;
    }
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all tests PASS (no test touches the SW; this guards against accidental syntax breakage elsewhere).

- [ ] **Step 4: Commit**

```bash
git add service-worker.js
git commit -m "feat: service worker persists previouslyWon skip list"
```

---

### Task 4: Safe mode (`autoStart.js`) — skip known-won rows, detect new ones after click

**Files:**
- Modify: `content_scripts/autoStart.js`

Four edits, all inside the existing `chrome.storage.local.get(...)` callback structure.

- [ ] **Step 1: Fetch the skip list with the daily-budget keys**

Change the `chrome.storage.local.get` key list (line 24) from:

```js
          ["autoJoinDate", "autoJoinCount", "autoJoinCap"],
```

to:

```js
          ["autoJoinDate", "autoJoinCount", "autoJoinCap", "previouslyWon"],
```

- [ ] **Step 2: Add the card text and the won-code set**

In the `CARD_TEXT` object (lines 44–48), add a `Won` entry:

```js
            const CARD_TEXT = {
              Enter: "(Enter Giveaway)",
              Fail: "(Enter Giveaway Fail)",
              NotEnough: "(Not Enough Point)",
              Won: "(Previously Won)",
            };
```

Directly after the `let remaining = ...` / `if (remaining <= 0) return;` lines (lines 40–41), add:

```js
            const wonCodes = new Set(
              (budget.previouslyWon || []).map((e) => e && e.code).filter(Boolean),
            );
```

- [ ] **Step 3: Pre-filter known-won rows (red card, never entered)**

`giftElements` is built and sorted around lines 83–90. Insert a filter between the sort and the points filter — after `giftElements.sort((a, b) => core.getScore(b) - core.getScore(a));` add:

```js
            // 已中獎的遊戲：標紅、永不嘗試
            const notWonGiftElements = giftElements.filter((row) => {
              if (!wonCodes.has(core.extractCode(row))) return true;
              giftCardUiChange({
                cardElement: row,
                text: CARD_TEXT.Won,
                ...CARD_STATE.Fail,
              });
              return false;
            });
```

Then change the points filter source (line 97) from:

```js
            const readyToEnterGiftElements = giftElements.filter((row) => {
```

to:

```js
            const readyToEnterGiftElements = notWonGiftElements.filter((row) => {
```

- [ ] **Step 4: Detect "Previously Won" in the post-click poll**

In `enterGiveaway(row)`, the post-click `setInterval` poll (lines 170–185) currently checks `is-faded` → resolve, `is-locked` → reject, timeout → reject. Add an error-div check as the first branch (the error shows for ~2–3 s; the 500 ms poll catches it). Replace the poll body:

```js
              return new Promise((resolve, reject) => {
                let tries = 0;
                const timer = setInterval(() => {
                  tries++;
                  const errText = core.getQuickEntryError(row);
                  if (errText && /previously won/i.test(errText)) {
                    clearInterval(timer);
                    const err = new Error("previously won");
                    err.previouslyWon = true;
                    reject(err);
                  } else if (row.classList.contains("is-faded")) {
                    clearInterval(timer);
                    resolve();
                  } else if (insertBtn.classList.contains("is-locked")) {
                    clearInterval(timer);
                    reject(new Error("locked after click"));
                  } else if (tries > 12) {
                    clearInterval(timer);
                    reject(new Error("timeout"));
                  }
                }, 500);
              });
```

- [ ] **Step 5: Record the won game in the catch path**

In `enterAll(list)`, the loop header already extracts `gameName`, `gameUrl`, `gameCost` (lines 192–195). Add the code right below them:

```js
                const gameCode = core.extractCode(row);
```

Then replace the `catch (e) { ... }` block (lines 220–234) with:

```js
                } catch (e) {
                  if (e && e.previouslyWon) {
                    chrome.runtime.sendMessage({
                      type: "recordPreviouslyWon",
                      code: gameCode,
                      name: gameName,
                      url: gameUrl,
                      time: Date.now(),
                    });
                  }
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
                    text: e && e.previouslyWon ? CARD_TEXT.Won : CARD_TEXT.Fail,
                    ...CARD_STATE.Fail,
                  });
                }
```

(The attempt still counts as a fail in `recentEntries`/`totalAttempts` — it was an attempt; the skip list prevents future ones.)

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add content_scripts/autoStart.js
git commit -m "feat: safe mode skips previously-won games and detects the error after click"
```

---

### Task 5: Aggressive mode (`offscreen.js` + SW) — skip and detect via ajax response

**Files:**
- Modify: `service-worker.js` (pass won codes into the offscreen run)
- Modify: `offscreen.js` (skip known codes; detect "Previously Won" in the JSON `msg`)

- [ ] **Step 1: SW passes the won codes to the offscreen document**

In `service-worker.js`, inside `case "fullAutoWishlist"`, change the inner budget read (line 191) from:

```js
        chrome.storage.local.get(["autoJoinDate", "autoJoinCount", "autoJoinCap"], (b) => {
```

to:

```js
        chrome.storage.local.get(["autoJoinDate", "autoJoinCount", "autoJoinCap", "previouslyWon"], (b) => {
```

and change the `runFullAuto` send (line 206) from:

```js
            .then(() => chrome.runtime.sendMessage({ type: "runFullAuto", cfg, maxEntries: remaining }))
```

to:

```js
            .then(() => chrome.runtime.sendMessage({
              type: "runFullAuto",
              cfg,
              maxEntries: remaining,
              wonCodes: (b.previouslyWon || []).map((e) => e && e.code).filter(Boolean),
            }))
```

- [ ] **Step 2: Offscreen accepts the codes**

In `offscreen.js`, change the message listener (lines 6–11) so `runFullAuto` receives them:

```js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "runFullAuto") return;
  runFullAuto(message.cfg || {}, message.maxEntries || 0, message.wonCodes || [])
    .then(({ count, point, loggedIn, entries }) => chrome.runtime.sendMessage({ type: "fullAutoResult", count, point, loggedIn, entries }))
    .catch(() => chrome.runtime.sendMessage({ type: "fullAutoResult", count: 0 }));
});
```

and the function signature (line 42):

```js
async function runFullAuto(cfg, maxEntries, wonCodes) {
```

with, as the first line of the function body:

```js
  const wonSet = new Set(wonCodes || []);
```

- [ ] **Step 3: `enterOne` returns the error message too**

Replace `enterOne` (lines 31–34) with:

```js
const enterOne = async (code, xsrf) => {
  const data = await postAjax("entry_insert", code, xsrf);
  return {
    ok: !!data && data.type === "success",
    msg: data && data.msg ? String(data.msg) : "",
  };
};
```

- [ ] **Step 4: Skip known codes, detect new wins in the entry loop**

In the `for (const row of eligible)` loop, after `const code = core.extractCode(row); if (!code) continue;` add:

```js
    if (wonSet.has(code)) continue; // 已中獎：永不嘗試
```

Then hoist the name/url extraction above the entry call and use the new `enterOne` shape. The loop body from the description-gate block through the `entries.push` currently reads:

```js
    if (core.isDescriptionGated(row)) {
      const len = await fetchDescriptionLen(code, xsrf);
      await delay(human.readingDelayMs(len, hcfg)); // 閱讀停留（伺服器可觀測）
    }
    const ok = await enterOne(code, xsrf);
    if (ok) {
      myPoint -= cost;
      count++;
    }
    const nameLink = row.querySelector('.giveaway__heading__name');
    const name = nameLink ? nameLink.textContent.trim() : "";
    const path = nameLink ? nameLink.getAttribute('href') : "";
    const url = path ? new URL(path, "https://www.steamgifts.com").href : "";
    entries.push({ name, url, points: ok ? cost : 0, result: ok ? "success" : "fail", time: Date.now() });
```

Replace it with:

```js
    if (core.isDescriptionGated(row)) {
      const len = await fetchDescriptionLen(code, xsrf);
      await delay(human.readingDelayMs(len, hcfg)); // 閱讀停留（伺服器可觀測）
    }
    const nameLink = row.querySelector('.giveaway__heading__name');
    const name = nameLink ? nameLink.textContent.trim() : "";
    const path = nameLink ? nameLink.getAttribute('href') : "";
    const url = path ? new URL(path, "https://www.steamgifts.com").href : "";
    const { ok, msg } = await enterOne(code, xsrf);
    if (ok) {
      myPoint -= cost;
      count++;
    } else if (/previously won/i.test(msg)) {
      wonSet.add(code);
      chrome.runtime.sendMessage({ type: "recordPreviouslyWon", code, name, url, time: Date.now() });
    }
    entries.push({ name, url, points: ok ? cost : 0, result: ok ? "success" : "fail", time: Date.now() });
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add service-worker.js offscreen.js
git commit -m "feat: aggressive mode skips previously-won codes and detects wins from ajax response"
```

---

### Task 6: Options page — display the list, clear button, i18n

**Files:**
- Modify: `options/options.html` (new panel under the recent-entries panel)
- Modify: `options/options.js` (render, live refresh, clear, restore-defaults)
- Modify: `options/options.css` (panel spacing + 3-column row)
- Modify: `_locales/en/messages.json`, `_locales/zh_TW/messages.json`

- [ ] **Step 1: i18n messages**

In `_locales/en/messages.json`, after the `"badgeFail"` entry, add:

```json
  "wonTitle": { "message": "Previously won (never re-entered)", "description": "dashboard: previously-won list title" },
  "wonEmpty": { "message": "No previously-won games recorded", "description": "dashboard: previously-won empty list" },
  "wonClear": { "message": "Clear list", "description": "dashboard: clear previously-won list button" },
  "badgeWon": { "message": "Won", "description": "dashboard: previously-won badge" },
```

In `_locales/zh_TW/messages.json`, after the `"badgeFail"` entry, add:

```json
  "wonTitle": { "message": "已中獎遊戲（不再嘗試抽取）", "description": "儀表板：已中獎清單標題" },
  "wonEmpty": { "message": "尚無已中獎紀錄", "description": "儀表板：已中獎清單空狀態" },
  "wonClear": { "message": "清除清單", "description": "儀表板：清除已中獎清單按鈕" },
  "badgeWon": { "message": "已中獎", "description": "儀表板：已中獎徽章" },
```

(Mind the trailing commas — both files keep `"optSettings"` as the last key; these blocks go before it, comma-terminated.)

- [ ] **Step 2: HTML panel**

In `options/options.html`, inside `<div class="dashboard">`, directly after the closing `</div>` of the `<div class="recent">` block (line 26), add:

```html
    <div class="recent won">
      <div class="recent-head">
        <h2>__MSG_wonTitle__</h2>
        <button id="clearWon">__MSG_wonClear__</button>
      </div>
      <div class="recent-list" id="wonList"></div>
    </div>
```

- [ ] **Step 3: CSS**

In `options/options.css`, after the `.recent-empty` rule (line 34), add:

```css
.won { margin-top: 16px; }
.won-row { grid-template-columns: 56px 1fr 84px; }
.recent-head button { padding: 3px 9px; font-size: 12px; margin: 0; }
```

- [ ] **Step 4: Render + wire up in options.js**

In `options/options.js`, after the `renderRecent` function, add:

```js
function renderWon(list) {
  const box = document.getElementById("wonList");
  box.textContent = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "recent-empty";
    empty.textContent = chrome.i18n.getMessage("wonEmpty");
    box.appendChild(empty);
    return;
  }
  list.forEach((e) => {
    const row = document.createElement("div");
    row.className = "recent-row won-row";

    const badge = document.createElement("span");
    badge.className = "badge fail";
    badge.textContent = chrome.i18n.getMessage("badgeWon");

    const name = document.createElement("a");
    name.className = "recent-name";
    name.textContent = e.name || e.code || "—"; // textContent: never trust page-derived names as HTML
    if (e.url) { name.href = e.url; name.target = "_blank"; name.rel = "noreferrer"; }

    const tm = document.createElement("span");
    tm.className = "recent-tm";
    tm.textContent = window.RelativeTime.relativeAgoText(e.time || 0, Date.now(), t);

    row.append(badge, name, tm);
    box.appendChild(row);
  });
}
```

In `renderDashboard`, change the `chrome.storage.local.get` call to also fetch and render the list:

```js
  chrome.storage.local.get(["currentPoint", "pointUpdatedAt", "autoJoinCount", "autoJoinCap", "recentEntries", "previouslyWon"], (s) => {
    document.getElementById("kpiPoints").textContent = s.currentPoint == null ? "—" : String(s.currentPoint);
    document.getElementById("kpiPointsSub").textContent = window.RelativeTime.relativeUpdatedText(s.pointUpdatedAt || 0, Date.now(), t);
    document.getElementById("kpiToday").textContent = `${s.autoJoinCount || 0} / ${s.autoJoinCap == null ? "—" : s.autoJoinCap}`;
    renderRecent(s.recentEntries || []);
    renderWon(s.previouslyWon || []);
  });
```

Next to the existing `resetTotal` listener, add the clear button listener:

```js
document.getElementById("clearWon").addEventListener("click", () => {
  chrome.storage.local.set({ previouslyWon: [] }, renderDashboard);
});
```

In the `resetDefault` listener, extend the local clear from:

```js
      chrome.storage.local.set({ recentEntries: [] }); // local 不在 sync schema，需另外清
```

to:

```js
      chrome.storage.local.set({ recentEntries: [], previouslyWon: [] }); // local 不在 sync schema，需另外清
```

(`resetTotal` intentionally does NOT clear `previouslyWon` — it resets statistics, not the skip list.)

In the `chrome.storage.onChanged` listener at the bottom, add `"previouslyWon"` to the `hit` array:

```js
  const hit = ["recentEntries", "currentPoint", "pointUpdatedAt", "autoJoinCount", "autoJoinCap", "totalEnterGiveaway", "totalAttempts", "previouslyWon"];
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add options/options.html options/options.js options/options.css _locales/en/messages.json _locales/zh_TW/messages.json
git commit -m "feat: options page lists previously-won games with clear button"
```

---

### Task 7: End-to-end verification (manual, in Chrome)

No code changes. Load the unpacked extension (`chrome://extensions` → Developer mode → Load unpacked → repo root; or Reload if already loaded).

- [ ] **Step 1: Seed a fake won entry and check the options page**

On the extension's service-worker console (chrome://extensions → "service worker" link), run:

```js
chrome.storage.local.set({ previouslyWon: [{ code: "ZzZzZ", name: "Fake Won Game", url: "https://www.steamgifts.com/giveaway/ZzZzZ/fake", time: Date.now() }] });
```

Open the options page. Expected: a "Previously won (never re-entered)" panel below the recent list showing one row with a red "Won" badge, the name linking to the giveaway, and a relative time. Click "Clear list" → the panel shows the empty message and storage `previouslyWon` is `[]`.

- [ ] **Step 2: Verify the message round-trip**

On any steamgifts.com tab's console:

```js
chrome.runtime.sendMessage({ type: "recordPreviouslyWon", code: "abc12", name: "RT Test", url: "", time: Date.now() });
```

Expected: the open options page updates live (onChanged) and shows "RT Test". Sending the same message again does not create a duplicate row. Clean up with the "Clear list" button.

- [ ] **Step 3: Verify safe-mode skip on a real wishlist page**

Seed `previouslyWon` with the code of a real enterable giveaway visible on your wishlist (read the code from the row's `input[name="code"]`). With auto-start enabled, reload the wishlist. Expected: that row turns red with `(Previously Won)`, is never clicked, and no points are deducted for it.

- [ ] **Step 4: Verify live detection (opportunistic)**

If your account actually has a previously-won game in the list, let auto-start run. Expected: after the click, the row is marked `(Previously Won)` (red), an entry appears in the options-page won panel, and on the next page load the row is pre-skipped without a click.

- [ ] **Step 5: Final test run and wrap-up**

Run: `npm test`
Expected: all tests PASS, working tree committed.

---

## Self-review notes

- **Spec coverage:** detect after click (Task 4 step 4) ✓; record to local storage (Task 3, interpreted as `chrome.storage.local` — `window.localStorage` cannot be shared between the content page and options page) ✓; show on settings page (Task 6) ✓; never attempt again — safe mode (Task 4 step 3) and aggressive mode (Task 5) ✓; red `(Previously Won)` card state alongside `(Not Enough Point)` (Task 4 steps 2–3) ✓.
- **Beyond-spec additions, kept deliberately:** aggressive-mode skip/detection (the spec says "never attempt again", which must hold in both entry paths) and the "Clear list" button (only undo path for a false positive short of restore-defaults). Nothing else added.
- **Type consistency:** won entry shape `{ code, name, url, time }` is identical across autoStart (Task 4), offscreen (Task 5), SW (Task 3), and options rendering (Task 6, which tolerates missing `name`/`url`). Message type string is `recordPreviouslyWon` everywhere. Storage key is `previouslyWon` everywhere.
