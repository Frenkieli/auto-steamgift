# SteamGifts Quick-Entry Auto-Giveaway Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the extension's auto-giveaway logic so it enters giveaways by clicking the new inline `giveaway__quick-entry-btn--insert` button on the list page, replacing the old `window.open()` popup flow that the SteamGifts page update broke.

**Architecture:** Extract the pure, DOM-reading logic (cost parsing, code extraction, enterable check, score reading, weight calculation) into a single shared, unit-testable module `content_scripts/giveaway-core.js`. The two content scripts (`countScore.js` scores rows; `autoStart.js` enters them) consume that module. `autoStart.js` is rewritten to click the inline insert button and poll the row for the `is-faded` success state instead of opening new windows. A minimal Node + jsdom test harness verifies the pure logic against a fixture built from the real new DOM.

**Tech Stack:** Chrome Extension Manifest V3 (vanilla JS, IIFE content scripts, `chrome.scripting`/`chrome.storage`), Node built-in test runner (`node --test`), jsdom for DOM-based unit tests.

---

## Background: What changed on the SteamGifts page

Confirmed from a saved copy of the live list page (`/Users/frenkie/Documents/Free Giveaways and Keys for Steam Games.html`):

| Concern | Old selector / mechanism | New reality |
|---|---|---|
| Enter a giveaway | `window.open()` the giveaway page, click `div[data-do="entry_insert"]` | Click inline `.giveaway__quick-entry-btn--insert` on the list row (SteamGifts JS POSTs to `/ajax.php`) |
| Not-enterable state | button hidden via `is-hidden` | insert button carries **`is-locked`** |
| Entered/success state | button gains `is-hidden` in the popup | `.giveaway__row-inner-wrap` gains **`is-faded`** |
| Row container | `.giveaway__row-inner-wrap` | unchanged |
| Title link | `.giveaway__heading__name` | unchanged (`/giveaway/{CODE}/{slug}`) |
| Point cost | last `.giveaway__heading__thin` | still `.giveaway__heading__thin`, but a `(NN Copies)` span shares the class — must match `(\d+P)` |
| Giveaway code | parsed from href only | also in `form.giveaway__quick-entry-form input[name="code"]` |
| Point balance | `.nav__points` | unchanged |
| region-restricted column | `.giveaway__column--region-restricted` | unchanged |
| contributor-level column | `.giveaway__column--contributor-level` | unchanged (text like `Level 1+`) |
| whitelist / group columns | `.giveaway__column--whitelist` / `--group` | **absent** (harmless: `querySelector` → null → 0) |
| Pinned toggle | `.pinned-giveaways__button` | now `.pinned-giveaways-expand[data-more]` |

**Design decisions locked in (from user):**
- Enter by **clicking the inline `--insert` button** (the user explicitly wants "直接點擊 giveaway__quick-entry-btn"); the `window.open()` flow is removed.
- Success is detected by polling the row for `is-faded` (with a timeout fallback).
- `jsdom` does not implement `innerText`; all core functions read `textContent` so they work in both the browser and tests.

## File Structure

- **Create** `content_scripts/giveaway-core.js` — pure, side-effect-free DOM-reading helpers, attached to `window.GiveawayCore`, also `module.exports` for tests. Responsibility: read a single giveaway row element and answer questions about it (cost, code, enterable, score, weight). No `chrome.*`, no clicking, no UI writes.
- **Create** `tests/giveaway-core.test.js` — Node `node:test` unit tests over a jsdom fixture.
- **Create** `tests/fixtures/list-page.html` — a minimal, hand-authored list page using the real new markup, with deliberately varied row states (enterable / locked / faded / copies+cost).
- **Create** `package.json` — declares the `jsdom` dev dependency and the `test` script. (No build step; the extension stays plain files.)
- **Modify** `content_scripts/countScore.js` — delegate weight math to `GiveawayCore.calculateWeight`; keep only the DOM span injection.
- **Modify** `content_scripts/autoStart.js` — full rewrite: click inline `--insert`, poll for `is-faded`, no `window.open()`.
- **Modify** `service-worker.js` — load `giveaway-core.js` before `countScore.js` (registered) and before `autoStart.js` (injected).
- **Modify (optional, Task 10)** `steamgift.js` — the standalone bookmarklet; bring it to the same click-based logic.

---

### Task 1: Test harness, fixture, and core module skeleton

**Files:**
- Create: `package.json`
- Create: `tests/fixtures/list-page.html`
- Create: `content_scripts/giveaway-core.js`
- Create: `tests/giveaway-core.test.js`

- [ ] **Step 1: Create `package.json`**

Create `package.json`:

```json
{
  "name": "auto-steamgift",
  "version": "1.0.0",
  "private": true,
  "description": "Tooling/tests for the auto-steamgift Chrome extension",
  "scripts": {
    "test": "node --test"
  },
  "devDependencies": {
    "jsdom": "^24.1.0"
  }
}
```

- [ ] **Step 2: Install the test dependency**

Run: `npm install`
Expected: creates `node_modules/` and `package-lock.json`; exit code 0. (Add `node_modules/` to `.gitignore` in Step 5.)

- [ ] **Step 3: Create the fixture `tests/fixtures/list-page.html`**

This uses the exact new SteamGifts markup. Four rows with distinct states. `nav__points` is 50.

```html
<!DOCTYPE html>
<html>
<body>
  <header>
    <a class="nav__button" href="#">Account (<span class="nav__points">50</span>P / <span title="4.24">Level 4</span>)</a>
  </header>

  <!-- Row A: enterable, level requirement, cost 5P, score 120, code aaaaa -->
  <div class="giveaway__row-outer-wrap" data-game-id="111">
    <div class="giveaway__row-inner-wrap">
      <div class="giveaway__summary">
        <h2 class="giveaway__heading">
          <a class="giveaway__heading__name" href="https://www.steamgifts.com/giveaway/aaaaa/game-a">Game A</a>
          <span class="giveaway__heading__thin">(5P)</span>
          <span class="auto_steam-score">(Score:120)</span>
        </h2>
        <div class="giveaway__columns">
          <div class="giveaway__column--contributor-level giveaway__column--contributor-level--positive" title="Contributor Level">Level 1+</div>
        </div>
      </div>
      <div class="giveaway__quick-entry-wrap">
        <form class="giveaway__quick-entry-form">
          <input type="hidden" name="xsrf_token" value="TESTTOKEN">
          <input type="hidden" name="do" value="">
          <input type="hidden" name="code" value="aaaaa">
          <div data-do="entry_insert" class="giveaway__quick-entry-btn giveaway__quick-entry-btn--insert"><i class="fa fa-plus-circle"></i></div>
          <div data-do="entry_delete" class="giveaway__quick-entry-btn giveaway__quick-entry-btn--delete"><i class="fa fa-minus-circle"></i></div>
        </form>
      </div>
    </div>
  </div>

  <!-- Row B: NOT enterable (insert is-locked), cost 10P, score 80, code bbbbb -->
  <div class="giveaway__row-outer-wrap" data-game-id="222">
    <div class="giveaway__row-inner-wrap">
      <div class="giveaway__summary">
        <h2 class="giveaway__heading">
          <a class="giveaway__heading__name" href="https://www.steamgifts.com/giveaway/bbbbb/game-b">Game B</a>
          <span class="giveaway__heading__thin">(10P)</span>
          <span class="auto_steam-score">(Score:80)</span>
        </h2>
      </div>
      <div class="giveaway__quick-entry-wrap">
        <form class="giveaway__quick-entry-form">
          <input type="hidden" name="xsrf_token" value="TESTTOKEN">
          <input type="hidden" name="do" value="">
          <input type="hidden" name="code" value="bbbbb">
          <div data-do="entry_insert" class="giveaway__quick-entry-btn giveaway__quick-entry-btn--insert is-locked"><i class="fa fa-plus-circle"></i></div>
          <div data-do="entry_delete" class="giveaway__quick-entry-btn giveaway__quick-entry-btn--delete"><i class="fa fa-minus-circle"></i></div>
        </form>
      </div>
    </div>
  </div>

  <!-- Row C: already entered (is-faded), cost 2P, code ccccc -->
  <div class="giveaway__row-outer-wrap" data-game-id="333">
    <div class="giveaway__row-inner-wrap is-faded">
      <div class="giveaway__summary">
        <h2 class="giveaway__heading">
          <a class="giveaway__heading__name" href="https://www.steamgifts.com/giveaway/ccccc/game-c">Game C</a>
          <span class="giveaway__heading__thin">(2P)</span>
          <span class="auto_steam-score">(Score:30)</span>
        </h2>
      </div>
      <div class="giveaway__quick-entry-wrap">
        <form class="giveaway__quick-entry-form">
          <input type="hidden" name="code" value="ccccc">
          <div data-do="entry_insert" class="giveaway__quick-entry-btn giveaway__quick-entry-btn--insert"><i class="fa fa-plus-circle"></i></div>
          <div data-do="entry_delete" class="giveaway__quick-entry-btn giveaway__quick-entry-btn--delete"><i class="fa fa-minus-circle"></i></div>
        </form>
      </div>
    </div>
  </div>

  <!-- Row D: enterable, region-restricted, copies + cost 2P, score 50, code ddddd -->
  <div class="giveaway__row-outer-wrap" data-game-id="444">
    <div class="giveaway__row-inner-wrap">
      <div class="giveaway__summary">
        <h2 class="giveaway__heading">
          <a class="giveaway__heading__name" href="https://www.steamgifts.com/giveaway/ddddd/game-d">Game D</a>
          <span class="giveaway__heading__thin">(100 Copies)</span>
          <span class="giveaway__heading__thin">(2P)</span>
          <span class="auto_steam-score">(Score:50)</span>
        </h2>
        <div class="giveaway__columns">
          <a href="#" class="giveaway__column--region-restricted" title="Region Restricted"><i class="fa fa-fw fa-globe"></i></a>
        </div>
      </div>
      <div class="giveaway__quick-entry-wrap">
        <form class="giveaway__quick-entry-form">
          <input type="hidden" name="code" value="ddddd">
          <div data-do="entry_insert" class="giveaway__quick-entry-btn giveaway__quick-entry-btn--insert"><i class="fa fa-plus-circle"></i></div>
          <div data-do="entry_delete" class="giveaway__quick-entry-btn giveaway__quick-entry-btn--delete"><i class="fa fa-minus-circle"></i></div>
        </form>
      </div>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 4: Create the core module skeleton `content_scripts/giveaway-core.js`**

Functions are stubbed so the harness loads but tests fail. Real bodies arrive in Tasks 2–6.

```js
(function (root) {
  if (root.GiveawayCore) return; // browser: idempotent across double-injection

  const GiveawayCore = {
    parsePointCost(row) { return null; },
    extractCode(row) { return null; },
    isEnterable(row) { return false; },
    getScore(row) { return 0; },
    calculateWeight(row, config) { return 0; },
  };

  root.GiveawayCore = GiveawayCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = GiveawayCore;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 5: Create the test file `tests/giveaway-core.test.js` with a shared fixture loader**

Only one (failing) assertion for now — it proves the harness runs.

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const GiveawayCore = require('../content_scripts/giveaway-core.js');

function loadFixture() {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'list-page.html'), 'utf8');
  const dom = new JSDOM(html);
  return dom.window.document;
}

// Helper: return the row inner-wrap elements in fixture order [A, B, C, D]
function rows(doc) {
  return [...doc.querySelectorAll('.giveaway__row-inner-wrap')];
}

test('harness loads fixture and core module', () => {
  const doc = loadFixture();
  assert.strictEqual(rows(doc).length, 4);
  // Sanity placeholder that will pass once parsePointCost is implemented (Task 2)
  assert.strictEqual(GiveawayCore.parsePointCost(rows(doc)[0]), 5);
});
```

Also create `.gitignore`:

```
node_modules/
```

- [ ] **Step 6: Run the test to confirm the harness works and the placeholder fails**

Run: `npm test`
Expected: the test file is discovered and runs; `harness loads fixture and core module` FAILS on the `parsePointCost === 5` assertion (got `null`), while the `rows.length === 4` assertion passes. This proves jsdom + fixture + module wiring is correct.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore content_scripts/giveaway-core.js tests/
git commit -m "test: add jsdom harness, fixture, and giveaway-core skeleton"
```

---

### Task 2: `parsePointCost` — read a row's point cost

**Files:**
- Modify: `content_scripts/giveaway-core.js`
- Test: `tests/giveaway-core.test.js`

- [ ] **Step 1: Write the failing tests**

Replace the placeholder `harness loads...` test with real `parsePointCost` tests (keep the `loadFixture`/`rows` helpers at the top of the file):

```js
test('parsePointCost reads a simple cost', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.parsePointCost(r[0]), 5);  // Row A "(5P)"
});

test('parsePointCost ignores a "(NN Copies)" span and reads the point span', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.parsePointCost(r[3]), 2);  // Row D "(100 Copies)(2P)"
});

test('parsePointCost returns null when no point span exists', () => {
  const dom = new (require('jsdom').JSDOM)('<div class="giveaway__row-inner-wrap"><h2 class="giveaway__heading"></h2></div>');
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(GiveawayCore.parsePointCost(row), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `parsePointCost` returns `null`, so the `=== 5` and `=== 2` assertions fail.

- [ ] **Step 3: Implement `parsePointCost`**

In `content_scripts/giveaway-core.js`, replace the `parsePointCost` stub:

```js
    parsePointCost(row) {
      const thins = row.querySelectorAll('.giveaway__heading__thin');
      for (let i = thins.length - 1; i >= 0; i--) {
        const match = (thins[i].textContent || '').match(/\((\d+)P\)/);
        if (match) return Number(match[1]);
      }
      return null;
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all three `parsePointCost` tests pass.

- [ ] **Step 5: Commit**

```bash
git add content_scripts/giveaway-core.js tests/giveaway-core.test.js
git commit -m "feat: parsePointCost reads point cost, ignoring copies span"
```

---

### Task 3: `extractCode` — read a row's giveaway code

**Files:**
- Modify: `content_scripts/giveaway-core.js`
- Test: `tests/giveaway-core.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/giveaway-core.test.js`:

```js
test('extractCode reads the code from the quick-entry form input', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.extractCode(r[0]), 'aaaaa');
});

test('extractCode falls back to the heading href when no form input exists', () => {
  const dom = new (require('jsdom').JSDOM)(
    '<div class="giveaway__row-inner-wrap"><a class="giveaway__heading__name" href="https://www.steamgifts.com/giveaway/zzzzz/game-z">Z</a></div>'
  );
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(GiveawayCore.extractCode(row), 'zzzzz');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `extractCode` returns `null`.

- [ ] **Step 3: Implement `extractCode`**

Replace the `extractCode` stub:

```js
    extractCode(row) {
      const input = row.querySelector('form.giveaway__quick-entry-form input[name="code"]');
      if (input && input.value) return input.value;
      const link = row.querySelector('a.giveaway__heading__name');
      if (!link) return null;
      const match = (link.getAttribute('href') || '').match(/\/giveaway\/([^/]+)/);
      return match ? match[1] : null;
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add content_scripts/giveaway-core.js tests/giveaway-core.test.js
git commit -m "feat: extractCode reads giveaway code from form input or href"
```

---

### Task 4: `isEnterable` — decide whether a row can be entered now

**Files:**
- Modify: `content_scripts/giveaway-core.js`
- Test: `tests/giveaway-core.test.js`

- [ ] **Step 1: Write the failing tests**

Append:

```js
test('isEnterable is true for a fresh, unlocked row', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isEnterable(r[0]), true);   // Row A
});

test('isEnterable is false when the insert button is locked', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isEnterable(r[1]), false);  // Row B is-locked
});

test('isEnterable is false when the row is already faded (entered)', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isEnterable(r[2]), false);  // Row C is-faded
});

test('isEnterable is false when there is no insert button', () => {
  const dom = new (require('jsdom').JSDOM)('<div class="giveaway__row-inner-wrap"></div>');
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(GiveawayCore.isEnterable(row), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `isEnterable` returns `false` for Row A (should be `true`).

- [ ] **Step 3: Implement `isEnterable`**

Replace the `isEnterable` stub:

```js
    isEnterable(row) {
      if (row.classList.contains('is-faded')) return false;
      const insert = row.querySelector('.giveaway__quick-entry-btn--insert');
      if (!insert) return false;
      return !insert.classList.contains('is-locked');
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add content_scripts/giveaway-core.js tests/giveaway-core.test.js
git commit -m "feat: isEnterable checks faded row and locked insert button"
```

---

### Task 5: `getScore` — read the injected score span

**Files:**
- Modify: `content_scripts/giveaway-core.js`
- Test: `tests/giveaway-core.test.js`

- [ ] **Step 1: Write the failing tests**

Append:

```js
test('getScore reads the injected auto_steam-score value', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.getScore(r[0]), 120);  // Row A
  assert.strictEqual(GiveawayCore.getScore(r[3]), 50);   // Row D
});

test('getScore returns 0 when no score span is present', () => {
  const dom = new (require('jsdom').JSDOM)('<div class="giveaway__row-inner-wrap"></div>');
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(GiveawayCore.getScore(row), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `getScore` returns `0` for Row A (should be `120`).

- [ ] **Step 3: Implement `getScore`**

Replace the `getScore` stub:

```js
    getScore(row) {
      const span = row.querySelector('span.auto_steam-score');
      if (!span) return 0;
      const value = Number((span.textContent || '').replace(/[^0-9.]/g, ''));
      return Number.isNaN(value) ? 0 : value;
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add content_scripts/giveaway-core.js tests/giveaway-core.test.js
git commit -m "feat: getScore reads the injected auto_steam-score span"
```

---

### Task 6: `calculateWeight` — score a row from config

This is ported from the old `countScore.js` inline `calculateWeight`, using `textContent` and `parsePointCost`. The config shape matches `defaultSchema.json`: each of `restricted`/`whitelist`/`group`/`level`/`cost` is `{ trigger: boolean, value: number|string }`.

**Files:**
- Modify: `content_scripts/giveaway-core.js`
- Test: `tests/giveaway-core.test.js`

- [ ] **Step 1: Write the failing tests**

Append:

```js
const CONFIG = {
  restricted: { trigger: true, value: 100 },
  whitelist: { trigger: false, value: 50 },
  group: { trigger: false, value: 50 },
  level: { trigger: true, value: 20 },
  cost: { trigger: true, value: 1 },
};

test('calculateWeight: region-restricted + copies row (Row D)', () => {
  const r = rows(loadFixture());
  // region-restricted present -> 100; no level column -> 0; cost 2 -> 2*0.1*1 = 0.2
  assert.strictEqual(GiveawayCore.calculateWeight(r[3], CONFIG), 100.2);
});

test('calculateWeight: level + cost row, no region (Row A)', () => {
  const r = rows(loadFixture());
  // no region -> 0; level "Level 1+" -> 1*20 = 20; cost 5 -> 5*0.1*1 = 0.5
  assert.strictEqual(GiveawayCore.calculateWeight(r[0], CONFIG), 20.5);
});

test('calculateWeight: a disabled trigger contributes nothing', () => {
  const r = rows(loadFixture());
  const cfg = { ...CONFIG, restricted: { trigger: false, value: 100 } };
  // Row D with restricted disabled -> only cost 0.2
  assert.strictEqual(GiveawayCore.calculateWeight(r[3], cfg), 0.2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `calculateWeight` returns `0`.

- [ ] **Step 3: Implement `calculateWeight`**

Replace the `calculateWeight` stub:

```js
    calculateWeight(row, config) {
      const restricted = config.restricted.trigger && row.querySelector('.giveaway__column--region-restricted')
        ? Number(config.restricted.value) : 0;
      const whitelist = config.whitelist.trigger && row.querySelector('.giveaway__column--whitelist')
        ? Number(config.whitelist.value) : 0;
      const group = config.group.trigger && row.querySelector('.giveaway__column--group')
        ? Number(config.group.value) : 0;

      let level = 0;
      const levelEl = row.querySelector('.giveaway__column--contributor-level');
      if (config.level.trigger && levelEl) {
        const lvl = Number((levelEl.textContent || '').replace(/[^0-9]/g, '')) || 0;
        level = lvl * Number(config.level.value);
      }

      const cost = config.cost.trigger
        ? (this.parsePointCost(row) || 0) * 0.1 * Number(config.cost.value)
        : 0;

      const total = restricted + whitelist + group + level + cost;
      return Math.round(total * 1000) / 1000;
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `calculateWeight` tests pass, and the full suite is green.

- [ ] **Step 5: Commit**

```bash
git add content_scripts/giveaway-core.js tests/giveaway-core.test.js
git commit -m "feat: calculateWeight ports weighting logic into testable core"
```

---

### Task 7: Refactor `countScore.js` to use the core, and load the core in the service worker

The scoring pipeline already works against the new DOM; this change removes the duplicated weight math and wires the shared module in.

**Files:**
- Modify: `content_scripts/countScore.js`
- Modify: `service-worker.js:119-130` (`registerCountScoreContentScripts`)

- [ ] **Step 1: Replace `content_scripts/countScore.js` entirely**

```js
(() => {
  // 頂部推播禮物區，如果有比較多就打開顯示方便後續抓取（新版改用 pinned-giveaways-expand）
  const pinnedExpand = document.querySelector('.pinned-giveaways-expand[data-more]');
  if (pinnedExpand) pinnedExpand.click();
  // ^^^^^^^^^^^^ 頂部推播禮物區

  const giftElements = document.getElementsByClassName('giveaway__row-inner-wrap');

  chrome.storage.sync.get(["restricted", "whitelist", "group", "level", "cost"], function (config) {
    // 在每個禮物的 heading 上注入/更新分數 span
    function injectScore(element) {
      const total = window.GiveawayCore.calculateWeight(element, config);
      const span = element.querySelector('span.auto_steam-score') || document.createElement('span');
      span.className = 'auto_steam-score';
      span.innerText = `(Score:${total})`;
      const heading = element.querySelector('.giveaway__heading');
      if (heading && !span.parentNode) heading.appendChild(span);
      return total;
    }

    for (let i = 0; i < giftElements.length; i++) {
      injectScore(giftElements[i]);
    }

    chrome.runtime.sendMessage({ type: "countScoreEnd" });
  });
})();
```

Notes:
- `config` keys `whitelist`/`group` still exist in storage; `calculateWeight` simply finds no matching column on the new page and contributes 0. No schema change needed.
- The span keeps class `auto_steam-score` (not `giveaway__heading__thin`), so it never interferes with `parsePointCost`.

- [ ] **Step 2: Update `registerCountScoreContentScripts` in `service-worker.js`**

In `service-worker.js`, find (around line 119):

```js
function registerCountScoreContentScripts () {
  chrome.scripting
  .registerContentScripts([{
    id: "countScore-script",
    css: ["content_scripts/countScore.css"],
    js: ["content_scripts/countScore.js"],
    persistAcrossSessions: false,
    excludeMatches: ["https://www.steamgifts.com/giveaway/*", "https://www.steamgifts.com/user/*", "https://www.steamgifts.com/stats/*"],
    matches: ["https://www.steamgifts.com/*"],
    runAt: "document_idle",
  }]);
}
```

Change the `js` array to load the core first:

```js
    js: ["content_scripts/giveaway-core.js", "content_scripts/countScore.js"],
```

(Leave every other field unchanged.)

- [ ] **Step 3: Verify the unit suite still passes**

Run: `npm test`
Expected: PASS (this task did not touch `giveaway-core.js`; the suite must remain green).

- [ ] **Step 4: Manually load the extension and confirm scoring still works**

1. Open `chrome://extensions`, enable Developer mode, "Load unpacked" → select the repo root.
2. Ensure the options/popup config has `autoScore` enabled (default is `true`).
3. Open `https://www.steamgifts.com/giveaways/search?type=wishlist` (logged in).
4. Confirm each giveaway heading shows a `(Score:NN)` span and there are no errors in the page console.

Expected: score spans appear on rows; service worker console (chrome://extensions → "service worker") shows no exceptions; a `countScoreEnd` message is sent.

- [ ] **Step 5: Commit**

```bash
git add content_scripts/countScore.js service-worker.js
git commit -m "refactor: countScore delegates weighting to giveaway-core, fix pinned toggle"
```

---

### Task 8: Rewrite `autoStart.js` to enter via the inline quick-entry button

This is the core of the rewrite. No `window.open()`. For each affordable, enterable row (highest score first), click `.giveaway__quick-entry-btn--insert` and poll the row until it gains `is-faded` (success) or times out (failure).

**Files:**
- Modify: `content_scripts/autoStart.js` (full replacement)
- Modify: `service-worker.js:112-117` (`injectAutoScript`)

- [ ] **Step 1: Replace `content_scripts/autoStart.js` entirely**

```js
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

  // 1) 收集可加入（未抽過、未鎖定）的禮物，依分數由高到低排序
  const giftElements = [...document.getElementsByClassName('giveaway__row-inner-wrap')]
    .filter((row) => core.isEnterable(row));

  giftElements.sort((a, b) => core.getScore(b) - core.getScore(a));

  // 2) 依目前點數篩選，點數不夠的標記後跳過
  let myPoint = Number(document.querySelector('.nav__points').innerText);
  let countEntryGift = 0;

  const readyToEnterGiftElements = giftElements.filter((row) => {
    const cost = core.parsePointCost(row) || 0;
    if (myPoint >= cost) {
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
        // 成功：SteamGifts 在抽取成功後會把該列加上 is-faded
        if (row.classList.contains('is-faded')) {
          clearInterval(timer);
          resolve();
        // 失敗：按鈕變成 is-locked（例如中途點數不足）
        } else if (insertBtn.classList.contains('is-locked')) {
          clearInterval(timer);
          reject(new Error('locked after click'));
        // 逾時保險（約 6 秒）
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
  }

  enterAll(readyToEnterGiftElements);
}, 500);
```

Key behavior notes for the implementer:
- `chrome.storage.sync.set({ totalEnterGiveaway })` triggers the `storage.onChanged` listener in `service-worker.js`. That listener reloads `steamgifts.com` tabs **unless** the only changed key is `totalEnterGiveaway` (see `service-worker.js:56`). Since we only change `totalEnterGiveaway` here, no reload is triggered — preserving the existing behavior. Do not also write other keys from this script.
- The success signal (`row` gains `is-faded`) is derived from the static saved page where every entered row is faded. The live dynamic toggle is verified in Step 3.

- [ ] **Step 2: Update `injectAutoScript` in `service-worker.js`**

In `service-worker.js`, find (around line 112):

```js
function injectAutoScript (tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: ["content_scripts/autoStart.js"]
  });
}
```

Change `files` to inject the core first (idempotent — `giveaway-core.js` guards against re-declaration):

```js
function injectAutoScript (tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: ["content_scripts/giveaway-core.js", "content_scripts/autoStart.js"]
  });
}
```

- [ ] **Step 3: Manually verify end-to-end entry on the live site**

> This script clicks real "Enter Giveaway" buttons and spends points. Use an account/state where that is acceptable.

1. `chrome://extensions` → reload the unpacked extension.
2. In the popup/options config, enable both `autoScore` and `autoStart`.
3. Open `https://www.steamgifts.com/giveaways/search?type=wishlist` (logged in, with some points).
4. Observe: rows get `(Score:NN)`; then, top-scored affordable rows get clicked one by one; each successful row turns faded/green with `(Enter Giveaway)`; the toolbar badge increments; points in the nav decrease.
5. Confirm in DevTools that **no new tabs/popups open** (the `window.open` behavior is gone) and there are no uncaught errors.
6. **If** success is not detected (rows never go faded after a real successful entry), inspect a freshly-entered row in DevTools to find the actual post-entry class/state and adjust the success condition in `enterGiveaway` accordingly (e.g. check `--delete` button visibility instead of `is-faded`). Re-run.

Expected: affordable wishlist giveaways are entered inline; badge count and `totalEnterGiveaway` increase; no popups.

- [ ] **Step 4: Run the unit suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS (core module unchanged).

- [ ] **Step 5: Commit**

```bash
git add content_scripts/autoStart.js service-worker.js
git commit -m "feat: enter giveaways via inline quick-entry button, drop window.open"
```

---

### Task 9: Update `README.md` and bump the manifest version

**Files:**
- Modify: `README.md`
- Modify: `manifest.json:5`

- [ ] **Step 1: Document the new mechanism in `README.md`**

Append a short note under the existing content:

```markdown

## 更新紀錄

- v1.1：改用 SteamGifts 新版列表頁的 inline quick-entry 按鈕（`giveaway__quick-entry-btn--insert`）直接抽獎，移除舊的開新分頁（`window.open`）流程。
```

- [ ] **Step 2: Bump the manifest version**

In `manifest.json`, change:

```json
  "version": "1.0",
```

to:

```json
  "version": "1.1",
```

- [ ] **Step 3: Commit**

```bash
git add README.md manifest.json
git commit -m "docs: note quick-entry rewrite and bump version to 1.1"
```

---

### Task 10 (Optional): Bring the standalone bookmarklet `steamgift.js` up to date

The README advertises a bookmark version. `steamgift.js` is a single paste-able IIFE that still uses `window.open()`. It cannot share `giveaway-core.js` (it must be self-contained), so the logic is inlined. Do this task only if the bookmarklet is still distributed.

**Files:**
- Modify: `steamgift.js` (full replacement)

- [ ] **Step 1: Replace `steamgift.js` entirely**

```js
(() => {
  // 頂部推播禮物區（新版改用 pinned-giveaways-expand）
  const pinnedExpand = document.querySelector('.pinned-giveaways-expand[data-more]');
  if (pinnedExpand) pinnedExpand.click();

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

  // 內嵌版的評分（書籤版自帶權重，無設定檔）
  function parsePointCost(row) {
    const thins = row.querySelectorAll('.giveaway__heading__thin');
    for (let i = thins.length - 1; i >= 0; i--) {
      const m = (thins[i].textContent || '').match(/\((\d+)P\)/);
      if (m) return Number(m[1]);
    }
    return null;
  }
  function isEnterable(row) {
    if (row.classList.contains('is-faded')) return false;
    const insert = row.querySelector('.giveaway__quick-entry-btn--insert');
    return !!insert && !insert.classList.contains('is-locked');
  }
  function calculateWeight(row) {
    const restricted = row.querySelector('.giveaway__column--region-restricted') ? 100 : 0;
    const levelEl = row.querySelector('.giveaway__column--contributor-level');
    const level = levelEl ? (Number((levelEl.textContent || '').replace(/[^0-9]/g, '')) || 0) * 20 : 0;
    const cost = (parsePointCost(row) || 0) * 0.1;
    return restricted + level + cost;
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  const giftElements = [...document.getElementsByClassName('giveaway__row-inner-wrap')]
    .filter(isEnterable);
  giftElements.sort((a, b) => calculateWeight(b) - calculateWeight(a));

  let myPoint = Number(document.querySelector('.nav__points').innerText);
  let countEntryGift = 0;

  const readyToEnterGiftElements = giftElements.filter((row) => {
    const cost = parsePointCost(row) || 0;
    if (myPoint >= cost) {
      myPoint -= cost;
      return true;
    }
    giftCardUiChange({ cardElement: row, text: CARD_TEXT.NotEnough, ...CARD_STATE.Fail });
    return false;
  });

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

  async function enterAll(list) {
    for (const row of list) {
      try {
        await enterGiveaway(row);
        countEntryGift++;
        giftCardUiChange({ cardElement: row, text: CARD_TEXT.Enter, ...CARD_STATE.Success });
      } catch (e) {
        giftCardUiChange({ cardElement: row, text: CARD_TEXT.Fail, ...CARD_STATE.Fail });
      }
      await delay(Math.floor(Math.random() * 500));
    }
    alert(`Enter Giveaway:${countEntryGift}`);
  }

  enterAll(readyToEnterGiftElements);
})();
```

- [ ] **Step 2: Manually verify the bookmarklet**

1. On the logged-in `https://www.steamgifts.com/giveaways/search?type=wishlist` page, open DevTools console.
2. Paste the entire contents of `steamgift.js` and run it.
3. Confirm affordable rows are entered inline (no popups), faded green, and an alert reports the count.

Expected: same inline-entry behavior as the extension; final `alert` shows the number entered.

- [ ] **Step 3: Commit**

```bash
git add steamgift.js
git commit -m "feat: update bookmarklet to inline quick-entry, drop window.open"
```

---

## Self-Review

**Spec coverage:**
- "SteamGifts page updated, rewrite the auto-giveaway logic" → Tasks 7 (scoring path fix), 8 (entry rewrite), 10 (bookmarklet).
- User's explicit ask "直接點擊 giveaway__quick-entry-btn" → Task 8 Step 1 (`insertBtn.click()`), no `window.open`.
- Broken selectors from the page update → fixed: pinned toggle (Task 7), cost-with-copies (Task 2), code source (Task 3), enterable/locked state (Task 4). Gone columns `whitelist`/`group` handled gracefully (Task 6 note).

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows complete code; every run step states the exact command and expected pass/fail.

**Type/name consistency:** `GiveawayCore` exposes `parsePointCost`, `extractCode`, `isEnterable`, `getScore`, `calculateWeight` — defined in Tasks 2–6 and consumed by the same names in `countScore.js` (Task 7) and `autoStart.js` (Task 8). `calculateWeight(row, config)` config shape matches `defaultSchema.json`. The success signal class `is-faded` is used consistently in `enterGiveaway` and the fixture.

**Known risk (flagged, not a placeholder):** the success detection assumes a successfully-entered row gains `is-faded` (true on the saved static page). Task 8 Step 3 explicitly verifies the live dynamic behavior and gives the concrete fallback (check `--delete`/`--insert` visibility) if the assumption is wrong.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-05-steamgifts-quick-entry-rewrite.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
