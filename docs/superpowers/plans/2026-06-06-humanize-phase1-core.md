# Humanize Phase 1 — Core In-Page Humanization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the in-page auto-enter (`autoStart.js`) behave like a human — arrival delay, scroll/hover pauses, a realistic "reading" delay after opening a giveaway's description, and a heavy-tailed (log-normal) gap between entries with occasional long breaks — backed by a new pure, unit-tested timing module.

**Architecture:** A new side-effect-free `content_scripts/humanize.js` exposes timing helpers (`humanDelayMs`, `readingDelayMs`, `maybeBreakMs`) that take an injectable `rng` so they are deterministic and unit-testable. `autoStart.js` consumes them via `window.Humanize` (injected alongside `giveaway-core.js`). This phase does NOT add daily caps, active-hours, or the background-mode gating — those are Phases 2 and 3 (separate plans).

**Tech Stack:** Chrome Extension Manifest V3 (vanilla JS, injected content scripts, `chrome.scripting`), Node built-in test runner (`node --test`) for the pure module. The `autoStart.js` DOM/timing behavior is verified manually (no chrome/DOM harness exists).

**Scope note:** This is Phase 1 of the spec `docs/superpowers/specs/2026-06-06-humanize-anti-detection-design.md`. Phase 2 (daily randomized cap + active hours 10:00–02:00 + probabilistic early-stop + options/popup UI) and Phase 3 (background AJAX gated behind a default-off "aggressive mode") are separate plans built on top of this module.

---

## File Structure

- **Create** `content_scripts/humanize.js` — pure timing helpers, `window.Humanize` + `module.exports`. One responsibility: turn an `rng` into realistic delays. No `chrome.*`, no DOM.
- **Create** `tests/humanize.test.js` — Node `node:test` unit tests for the helpers.
- **Modify** `content_scripts/autoStart.js` — consume `window.Humanize`; add arrival delay, scroll/hover pauses, description reading delay, and replace the fixed inter-entry delay with `humanDelayMs` + `maybeBreakMs`.
- **Modify** `service-worker.js` — inject `humanize.js` between `giveaway-core.js` and `autoStart.js` in `injectAutoScript`.

---

### Task 1: `humanize.js` timing helpers (TDD)

**Files:**
- Create: `content_scripts/humanize.js`
- Create: `tests/humanize.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/humanize.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const Humanize = require('../content_scripts/humanize.js');

// rng that returns a fixed sequence (cycles), for deterministic assertions
const seqRng = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('humanDelayMs hits the median when the gaussian is 0', () => {
  // Box-Muller with u1=0.5, u2=0.25 → cos(π/2)=0 → gaussian 0 → exp(ln(median)) = median
  assert.strictEqual(Humanize.humanDelayMs(seqRng([0.5, 0.25])), 13000);
});

test('humanDelayMs always stays within [6000, 240000]', () => {
  for (let i = 0; i < 2000; i++) {
    const d = Humanize.humanDelayMs();
    assert.ok(d >= 6000 && d <= 240000, `out of range: ${d}`);
  }
});

test('readingDelayMs grows with description length', () => {
  const r = () => 0.5;
  assert.ok(Humanize.readingDelayMs(1000, r) > Humanize.readingDelayMs(100, r));
});

test('readingDelayMs is clamped to [1500, 15000]', () => {
  assert.ok(Humanize.readingDelayMs(0, () => 0.5) >= 1500);
  assert.ok(Humanize.readingDelayMs(1000000, () => 0.5) <= 15000);
});

test('maybeBreakMs returns 0 when the draw is above the break probability', () => {
  assert.strictEqual(Humanize.maybeBreakMs(() => 0.9), 0);
});

test('maybeBreakMs returns a bounded long break when triggered', () => {
  const b = Humanize.maybeBreakMs(seqRng([0.1, 0.5]));
  assert.ok(b >= 60000 && b <= 300000, `out of range: ${b}`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../content_scripts/humanize.js'`.

- [ ] **Step 3: Implement `content_scripts/humanize.js`**

```js
(function (root) {
  // 標準常態（Box-Muller）；注入 rng 以利測試。u1=0.5,u2=0.25 → 0
  function gaussian(rng) {
    const u1 = Math.max(rng(), 1e-9); // 避免 log(0)
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  // 兩次抽獎之間的「思考/瀏覽」間隔：對數常態（重尾），夾在 [min,max]
  function humanDelayMs(rng = Math.random) {
    const MEDIAN = 13000, SIGMA = 0.6, MIN = 6000, MAX = 240000;
    const ms = Math.exp(Math.log(MEDIAN) + SIGMA * gaussian(rng));
    return Math.round(Math.min(MAX, Math.max(MIN, ms)));
  }

  // 點開描述後的閱讀停留：依字數（textLen/5 詞）以略讀 ~300wpm + 變異，夾 [1500,15000]
  function readingDelayMs(textLen, rng = Math.random) {
    const WPM = 300, BASE = 1200, MIN = 1500, MAX = 15000;
    const words = textLen / 5;
    const variance = 0.7 + rng() * 0.6; // 0.7..1.3
    const ms = BASE + (words / WPM) * 60000 * variance;
    return Math.round(Math.min(MAX, Math.max(MIN, ms)));
  }

  // 偶發長休息：機率 P 回傳 60–300 秒，否則 0
  function maybeBreakMs(rng = Math.random) {
    const P = 0.15, MIN = 60000, MAX = 300000;
    if (rng() >= P) return 0;
    return Math.round(MIN + rng() * (MAX - MIN));
  }

  const Humanize = { humanDelayMs, readingDelayMs, maybeBreakMs };
  root.Humanize = Humanize;
  if (typeof module !== 'undefined' && module.exports) module.exports = Humanize;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the 6 new tests pass and the existing 33 stay green (39 total).

- [ ] **Step 5: Commit**

```bash
git add content_scripts/humanize.js tests/humanize.test.js
git commit -m "feat: humanize.js realistic delay helpers (humanDelay/readingDelay/maybeBreak)"
```

---

### Task 2: Humanize `autoStart.js` and inject `humanize.js`

**Files:**
- Modify: `content_scripts/autoStart.js`
- Modify: `service-worker.js`

This rewires the in-page enter loop to use the new helpers and adds scroll/hover reading pauses. There is no DOM harness, so verification is `node --check` + the manual checks in Step 7.

- [ ] **Step 1: Expose `Humanize` and add a `hover` helper**

In `content_scripts/autoStart.js`, find:

```js
    const core = window.GiveawayCore;
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
```

Replace with:

```js
    const core = window.GiveawayCore;
    const human = window.Humanize;
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    // 派發基本 hover 事件（客戶端便宜保險）
    function hover(el) {
      ['mouseover', 'mousemove', 'mouseenter'].forEach((type) =>
        el.dispatchEvent(new MouseEvent(type, { bubbles: true })));
    }
```

- [ ] **Step 2: Hover the description button before clicking it**

In `unlockIfNeeded`, find:

```js
        descBtn.click();
        let tries = 0;
        const timer = setInterval(() => {
          tries++;
          if (!insertBtn.classList.contains('is-locked')) {
```

Replace with:

```js
        hover(descBtn);
        descBtn.click();
        let tries = 0;
        const timer = setInterval(() => {
          tries++;
          if (!insertBtn.classList.contains('is-locked')) {
```

- [ ] **Step 3: Rewrite `enterGiveaway` with reading + scroll + hover pauses**

Replace the entire `enterGiveaway` function (the block starting at the comment `// 3) 需要時先解鎖…` through the closing `}` of the function):

```js
    // 3) 需要時先解鎖（看說明），再點擊 inline 的 quick-entry 按鈕，輪詢該列是否變成 is-faded（代表抽取成功）
    async function enterGiveaway(row) {
      await unlockIfNeeded(row);
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
```

with:

```js
    // 3) 需要時先解鎖（看說明），讀完描述、捲動、hover 後再點擊；輪詢該列是否變成 is-faded（代表抽取成功）
    async function enterGiveaway(row) {
      await unlockIfNeeded(row);

      // 點開描述後的閱讀停留（gated 才會有 description-panel，它是 row-inner-wrap 的兄弟節點）
      const panel = row.parentNode.querySelector('.giveaway__description-panel');
      if (panel) await delay(human.readingDelayMs((panel.textContent || '').length));

      const insertBtn = row.querySelector('.giveaway__quick-entry-btn--insert');
      if (!insertBtn || insertBtn.classList.contains('is-locked')) throw new Error('not enterable');

      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(300 + Math.floor(Math.random() * 500)); // 捲動後停頓
      row.parentNode.style.backgroundColor = '#ff01';
      hover(insertBtn);
      await delay(200 + Math.floor(Math.random() * 400)); // hover 後停頓
      insertBtn.click();

      return new Promise((resolve, reject) => {
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
```

(Note: `enterGiveaway` was already `async` and `enterAll` already `await`s it inside a `try/catch`, so throwing `'not enterable'` instead of rejecting a wrapped Promise behaves identically.)

- [ ] **Step 4: Replace the fixed inter-entry delay with humanized timing + breaks**

In `enterAll`, find:

```js
        await delay(Math.floor(Math.random() * 200) + 100);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
```

Replace with:

```js
        await delay(human.humanDelayMs());
        const breakMs = human.maybeBreakMs();
        if (breakMs) await delay(breakMs);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
```

- [ ] **Step 5: Add an arrival delay before the run starts**

At the very bottom of `content_scripts/autoStart.js`, find:

```js
    enterAll(readyToEnterGiftElements);
  }, 500);
});
```

Replace with:

```js
    enterAll(readyToEnterGiftElements);
  }, 2000 + Math.floor(Math.random() * 8000)); // 抵達延遲：頁面載入後 2–10 秒才開始
});
```

- [ ] **Step 6: Inject `humanize.js` in `service-worker.js`**

In `service-worker.js`, find `injectAutoScript`:

```js
function injectAutoScript (tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: ["content_scripts/giveaway-core.js", "content_scripts/autoStart.js"]
  });
}
```

Replace the `files` array to inject `humanize.js` before `autoStart.js`:

```js
function injectAutoScript (tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    files: ["content_scripts/giveaway-core.js", "content_scripts/humanize.js", "content_scripts/autoStart.js"]
  });
}
```

- [ ] **Step 7: Verify (parse + unit suite + manual)**

Run: `node --check content_scripts/autoStart.js`
Expected: exit 0.

Run: `node --check service-worker.js`
Expected: exit 0.

Run: `npm test`
Expected: `# pass 39 # fail 0` (Task 1's module + existing suites; this task changed no tested code).

Manual (live, spends points — use an account where that's acceptable):
1. `chrome://extensions` → reload the unpacked extension; ensure you are signed in and `autoScore`+`autoStart` are enabled.
2. Open `https://www.steamgifts.com/giveaways/search?type=wishlist`.
3. Observe: the page sits for a few seconds (arrival delay) before anything happens; then rows are entered one at a time with **multi-second, visibly irregular gaps** (not the old ~0.1s machine-gun); for a giveaway that has a "View Description" icon, the description panel opens and there is a pause before it is entered; occasionally a much longer pause occurs (break).
4. Confirm entries still succeed (rows fade green with `(Enter Giveaway)`), the badge increments, and no uncaught errors appear in the page console.

- [ ] **Step 8: Commit**

```bash
git add content_scripts/autoStart.js service-worker.js
git commit -m "feat: autoStart enters like a human (arrival, reading, scroll/hover, heavy-tailed gaps)"
```

---

## Self-Review

**Spec coverage (Phase 1 portion):**
- Pure testable timing module (`humanDelayMs`/`readingDelayMs`/`maybeBreakMs`) → Task 1.
- Arrival delay → Task 2 Step 5.
- Scroll + hover pauses → Task 2 Steps 1–3.
- Description reading delay (server-observable gap between `giveaway_description` and `entry_insert`) → Task 2 Step 3 (`readingDelayMs` on the `.giveaway__description-panel` text).
- Heavy-tailed inter-entry gap + occasional break → Task 2 Step 4.
- Injection of the module → Task 2 Step 6.
- Explicitly deferred to later plans: daily randomized cap, active hours, probabilistic early-stop, background "aggressive mode", options/popup UI — noted in the scope/architecture, no task here (correct for Phase 1).

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows complete before/after code; every run step states the exact command and expected output.

**Type/name consistency:** The module exports `humanDelayMs`, `readingDelayMs`, `maybeBreakMs` (Task 1) and `autoStart.js` calls exactly those on `window.Humanize` via `const human = window.Humanize` (Task 2). The `hover(el)` helper is defined once (Task 2 Step 1) and used in `unlockIfNeeded` (Step 2) and `enterGiveaway` (Step 3). The `.giveaway__description-panel` selector matches the panel SteamGifts inserts as a sibling of `.giveaway__row-inner-wrap` (so `row.parentNode.querySelector(...)` is correct, since `row` is the inner-wrap). Injection order puts `humanize.js` before `autoStart.js` so `window.Humanize` exists at use.

**Known note (not a placeholder):** `autoStart.js` is DOM/timing code with no unit harness (matching the repo); it is covered by `node --check` + the Task 2 Step 7 manual checks. Only the pure `humanize.js` helpers are unit-tested — by design.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-06-humanize-phase1-core.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
