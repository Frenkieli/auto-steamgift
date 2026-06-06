# Description-Gated Giveaways: Enter Locked-by-Description Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the extension enter SteamGifts giveaways whose insert button is `is-locked` because they have a description, by replicating SteamGifts' own "view description first, then enter" flow.

**Architecture:** SteamGifts renders a giveaway's `giveaway__quick-entry-btn--insert` as `is-locked` exactly when the giveaway has a description (it also shows a `giveaway__quick-entry-btn--description` button). The site unlocks the insert button only after a successful `do=giveaway_description` AJAX call. Our shared `giveaway-core.js` currently treats any `is-locked` insert as not-enterable, so every description-gated giveaway is skipped. We add a single core helper `isDescriptionGated(row)`, relax `isEnterable(row)` to accept locked-but-description rows, and teach each consumer to do the description step first: the background path (`offscreen.js`) POSTs `do=giveaway_description` before `do=entry_insert`; the in-page paths (`autoStart.js`, `steamgift.js`) click the description button and wait for the lock to clear before clicking insert.

**Tech Stack:** Chrome Extension Manifest V3 (vanilla JS, IIFE/injected content scripts, `chrome.offscreen`, `chrome.scripting`, `chrome.storage`), Node built-in test runner (`node --test`), jsdom for DOM-based unit tests.

---

## Background: What the live page and bundle confirm

Evidence gathered from the saved live page `/Users/frenkie/Documents/Free Giveaways and Keys for Steam Games.html` (25 rows) and its script bundle `…_files/bundle-v18.js`:

| Fact | Evidence |
|---|---|
| `is-locked` on the insert button correlates **1:1** with the presence of a `giveaway__quick-entry-btn--description` button | 16 rows are `is-locked`; the same 16 have a `--description` button; the 9 unlocked rows have no `--description` button. The single not-yet-entered row (`code=1bvNQ`, "Stray Path") is locked + has description — this is the exact element the user pasted. |
| The description button drives an AJAX call that unlocks the insert | In `bundle-v18.js`, the `--description` click handler does `FormData → do=giveaway_description, code=data-code`, `fetch(ajax_url,{method:"POST",…})`, and on `P.type==="success"` runs `…--insert").classList.remove("is-locked")`. |
| `is-locked` has **no other cause** | The only `add("is-locked")` / `remove("is-locked")` sites in the bundle are the description collapse (`te()` re-adds it) and the description-success handler (removes it). Insufficient points/level surface as an `error`-typed response shown inline, not as `is-locked`. |
| Entering posts to the same endpoint | The insert button is `data-do="entry_insert"`; the form carries `xsrf_token` + `code`; the success handler adds `is-faded` to the row. This matches the existing `offscreen.js` `enterOne()` POST. |
| Description POST shape | The bundle's description call sends only `do` + `code` (no `xsrf_token`). We send `xsrf_token` too for uniformity with `enterOne`; the extra field is ignored by the server. |

**Design decisions locked in:**
- A row is "description-gated" when its insert button is `is-locked` **and** a `--description` button exists in the row. Only these locked rows become enterable; a locked row with **no** description button stays not-enterable (genuinely blocked).
- We always perform the description step before entering a gated row (POST in background, click in-page). This mirrors the manual flow the user described and is correct whether or not the server strictly enforces it; the extra request is cheap and rate-limited by existing delays.
- The unit-testable surface is `giveaway-core.js` only. `offscreen.js`, `autoStart.js`, and `steamgift.js` use `fetch`/`chrome.*`/live DOM and are verified manually on the live site, consistent with the existing repo (no harness mocks `chrome`/`fetch`).

## File Structure

- **Modify** `content_scripts/giveaway-core.js` — add `isDescriptionGated(row)`; relax `isEnterable(row)` to accept description-gated locked rows. Still pure, side-effect-free, `window.GiveawayCore` + `module.exports`.
- **Modify** `tests/fixtures/list-page.html` — append **Row E**: not faded, insert `is-locked`, with a `--description` button and a `code` input. Existing rows A–D keep indices 0–3.
- **Modify** `tests/giveaway-core.test.js` — add tests for `isDescriptionGated` and the new `isEnterable` case (Row E).
- **Modify** `offscreen.js` — generalize the AJAX POST helper and, for gated rows, POST `do=giveaway_description` before `do=entry_insert`.
- **Modify** `content_scripts/autoStart.js` — before clicking insert, if the row is locked, click the `--description` button and wait for `is-locked` to clear.
- **Modify (optional, Task 5)** `steamgift.js` — same unlock-then-enter logic, inlined (the bookmarklet is self-contained).
- **Modify (Task 6)** `README.md`, `manifest.json:5` — document the fix and bump the version.

---

### Task 1: Core — `isDescriptionGated` + relaxed `isEnterable` (TDD)

**Files:**
- Modify: `tests/fixtures/list-page.html`
- Modify: `tests/giveaway-core.test.js`
- Modify: `content_scripts/giveaway-core.js`

- [ ] **Step 1: Add Row E to the fixture**

In `tests/fixtures/list-page.html`, insert this block immediately **before** the closing `</body>` (after Row D's closing `</div>` on line 97). It mirrors the real markup the user pasted: the `--description` button sits **outside** the form, the `is-locked` insert sits inside it.

```html
  <!-- Row E: description-gated — insert is-locked, has a --description button, cost 3P, score 90, code eeeee -->
  <div class="giveaway__row-outer-wrap" data-game-id="555">
    <div class="giveaway__row-inner-wrap">
      <div class="giveaway__summary">
        <h2 class="giveaway__heading">
          <a class="giveaway__heading__name" href="https://www.steamgifts.com/giveaway/eeeee/game-e">Game E</a>
          <span class="giveaway__heading__thin">(3P)</span>
          <span class="auto_steam-score">(Score:90)</span>
        </h2>
      </div>
      <div class="giveaway__quick-entry-wrap">
        <div data-code="eeeee" class="giveaway__quick-entry-btn giveaway__quick-entry-btn--description"><i class="fa fa-align-left"></i></div>
        <form class="giveaway__quick-entry-form">
          <input type="hidden" name="xsrf_token" value="TESTTOKEN">
          <input type="hidden" name="do" value="">
          <input type="hidden" name="code" value="eeeee">
          <div data-do="entry_insert" class="giveaway__quick-entry-btn giveaway__quick-entry-btn--insert is-locked"><i class="fa fa-plus-circle"></i></div>
          <div data-do="entry_delete" class="giveaway__quick-entry-btn giveaway__quick-entry-btn--delete"><i class="fa fa-minus-circle"></i></div>
        </form>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/giveaway-core.test.js`:

```js
test('isDescriptionGated is true for a locked row that has a description button', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isDescriptionGated(r[4]), true);   // Row E
});

test('isDescriptionGated is false for an unlocked row', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isDescriptionGated(r[0]), false);  // Row A (not locked)
});

test('isDescriptionGated is false for a locked row with no description button', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isDescriptionGated(r[1]), false);  // Row B (locked, no description)
});

test('isEnterable is true for a description-gated locked row', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isEnterable(r[4]), true);          // Row E
});
```

Note: the existing test `isEnterable is false when the insert button is locked` uses Row B (locked, **no** description button) and must stay `false` — do not change it.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `isDescriptionGated` is undefined (throws / not a function) and `isEnterable(r[4])` returns `false` instead of `true`. The pre-existing tests still pass.

- [ ] **Step 4: Implement the core changes**

In `content_scripts/giveaway-core.js`, replace the existing `isEnterable` method (lines 21–26):

```js
    isEnterable(row) {
      if (row.classList.contains('is-faded')) return false;
      const insert = row.querySelector('.giveaway__quick-entry-btn--insert');
      if (!insert) return false;
      return !insert.classList.contains('is-locked');
    },
```

with both methods (relaxed `isEnterable` + new `isDescriptionGated`):

```js
    isEnterable(row) {
      if (row.classList.contains('is-faded')) return false;
      const insert = row.querySelector('.giveaway__quick-entry-btn--insert');
      if (!insert) return false;
      if (!insert.classList.contains('is-locked')) return true;
      // A locked insert is still enterable if it is only gated behind "view description".
      return GiveawayCore.isDescriptionGated(row);
    },
    isDescriptionGated(row) {
      const insert = row.querySelector('.giveaway__quick-entry-btn--insert');
      if (!insert || !insert.classList.contains('is-locked')) return false;
      return !!row.querySelector('.giveaway__quick-entry-btn--description');
    },
```

(`GiveawayCore` is the surrounding object literal — it is in scope by the time these methods run, matching the existing `GiveawayCore.getScore(...)` self-reference in `passesMinimum`.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all new tests pass and the full suite is green (the locked-no-description Row B test still returns `false`).

- [ ] **Step 6: Commit**

```bash
git add content_scripts/giveaway-core.js tests/giveaway-core.test.js tests/fixtures/list-page.html
git commit -m "feat: treat description-gated locked giveaways as enterable"
```

---

### Task 2: Background path — view description before entering (`offscreen.js`)

The background full-auto path POSTs directly to `ajax.php` and never clicks anything. Now that `isEnterable` includes description-gated rows, they will appear in `eligible`; for each such row we first POST `do=giveaway_description` (the same call the site makes when you click the description button), then POST `do=entry_insert` as before.

**Files:**
- Modify: `offscreen.js`

- [ ] **Step 1: Generalize the POST helper**

In `offscreen.js`, replace the existing `enterOne` function (lines 14–31):

```js
async function enterOne(code, xsrf) {
  const body = new URLSearchParams({ xsrf_token: xsrf, do: "entry_insert", code });
  try {
    const res = await fetch(ENTRY_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: body.toString()
    });
    const data = await res.json();
    return !!data && data.type === "success";
  } catch (e) {
    return false;
  }
}
```

with a generic `postAjax` (same request shape, parameterized `do`) plus thin wrappers:

```js
async function postAjax(doValue, code, xsrf) {
  const body = new URLSearchParams({ xsrf_token: xsrf, do: doValue, code });
  try {
    const res = await fetch(ENTRY_URL, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: body.toString()
    });
    const data = await res.json();
    return !!data && data.type === "success";
  } catch (e) {
    return false;
  }
}

const enterOne = (code, xsrf) => postAjax("entry_insert", code, xsrf);
const viewDescription = (code, xsrf) => postAjax("giveaway_description", code, xsrf);
```

- [ ] **Step 2: Do the description step before entering a gated row**

In `offscreen.js`, inside the `for (const row of eligible)` loop, find (currently lines 75–77):

```js
    const code = core.extractCode(row);
    if (!code) continue;
    const ok = await enterOne(code, xsrf);
```

and change it to view the description first for gated rows:

```js
    const code = core.extractCode(row);
    if (!code) continue;
    if (core.isDescriptionGated(row)) {
      await viewDescription(code, xsrf);
      await delayRandom();
    }
    const ok = await enterOne(code, xsrf);
```

(Leave the rest of the loop — point accounting, `count++`, `totalEnterGiveaway` increment, trailing `await delayRandom()` — unchanged.)

- [ ] **Step 3: Manually verify background full-auto enters a gated giveaway**

> This spends real points. Use an account/state where that is acceptable.

1. `chrome://extensions` → Developer mode → reload the unpacked extension (repo root).
2. Ensure your wishlist (`https://www.steamgifts.com/giveaways/search?type=wishlist`) currently contains at least one **not-yet-entered** giveaway that shows the "View Description" (align-left) icon — i.e. a description-gated row like the user's `1bvNQ`.
3. Trigger full-auto from the popup (the button that sends `fullAutoWishlist`).
4. Open the offscreen/service-worker console (`chrome://extensions` → "service worker"; the offscreen document logs route there) and confirm no uncaught errors.
5. Reload the wishlist page and confirm the previously description-gated giveaway is now entered (row faded / shows as entered), and the completion notification's count includes it.

Expected: description-gated wishlist giveaways are now entered by full-auto; the done-notification count increases accordingly.

> If a gated giveaway still is not entered, capture the `ajax.php` response for its `do=giveaway_description` and `do=entry_insert` calls (Network tab won't show the offscreen requests; temporarily add `console.log(await res.text())` inside `postAjax` before `res.json()` and re-run) to see the server's `type`/`msg`, then adjust.

- [ ] **Step 4: Run the unit suite to confirm no regression**

Run: `npm test`
Expected: PASS (this task did not touch `giveaway-core.js`).

- [ ] **Step 5: Commit**

```bash
git add offscreen.js
git commit -m "feat: full-auto views description before entering gated giveaways"
```

---

### Task 3: In-page path — click description to unlock, then enter (`autoStart.js`)

The injected `autoStart.js` enters by clicking the real `--insert` button and polling for `is-faded`. For a locked row it currently rejects immediately. New behavior: if the insert is locked, click the `--description` button and wait until SteamGifts removes `is-locked`, then proceed to click insert.

**Files:**
- Modify: `content_scripts/autoStart.js`

- [ ] **Step 1: Add an `unlockIfNeeded` helper**

In `content_scripts/autoStart.js`, immediately **above** the existing `function enterGiveaway(row) {` (currently line 52), add:

```js
    // 若該列因「需先看說明」而 is-locked，點開 description 按鈕並等待解鎖
    function unlockIfNeeded(row) {
      return new Promise((resolve, reject) => {
        const insertBtn = row.querySelector('.giveaway__quick-entry-btn--insert');
        if (insertBtn && !insertBtn.classList.contains('is-locked')) {
          resolve();
          return;
        }
        const descBtn = row.querySelector('.giveaway__quick-entry-btn--description');
        if (!insertBtn || !descBtn) {
          reject(new Error('locked, no description'));
          return;
        }
        descBtn.click();
        let tries = 0;
        const timer = setInterval(() => {
          tries++;
          if (!insertBtn.classList.contains('is-locked')) {
            clearInterval(timer);
            resolve();
          } else if (tries > 12) {
            clearInterval(timer);
            reject(new Error('unlock timeout'));
          }
        }, 500);
      });
    }
```

- [ ] **Step 2: Make `enterGiveaway` unlock first**

In `content_scripts/autoStart.js`, replace the existing `enterGiveaway` function (currently lines 52–79):

```js
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
```

with an `async` version that unlocks first, then clicks and polls:

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

(`enterAll` already does `await enterGiveaway(row)` inside a `try/catch`, so returning a Promise from an `async` function needs no other change. A row that fails to unlock rejects and is marked `(Enter Giveaway Fail)`, same as any other failure.)

- [ ] **Step 3: Manually verify in-page auto-enter unlocks and enters a gated giveaway**

> This spends real points. Use an account/state where that is acceptable.

1. `chrome://extensions` → reload the unpacked extension.
2. In the popup/options, enable both `autoScore` and `autoStart`.
3. Open `https://www.steamgifts.com/giveaways/search?type=wishlist` (logged in, with points), containing at least one not-yet-entered description-gated giveaway.
4. Watch a gated row: its description panel opens (the site fetches the description), `is-locked` clears, then the row is clicked and turns faded/green with `(Enter Giveaway)`; the badge increments.
5. Confirm in DevTools there are no uncaught errors and no new tabs/popups open.

Expected: gated rows are unlocked then entered in-page; non-gated rows behave exactly as before.

- [ ] **Step 4: Run the unit suite to confirm no regression**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add content_scripts/autoStart.js
git commit -m "feat: autoStart unlocks description-gated rows before entering"
```

---

### Task 4: Sync wording of the spec doc (so docs match behavior)

The repo keeps a written spec alongside the code. Add a short note so the description-gating behavior is recorded.

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-popup-settings-redesign-design.md`

- [ ] **Step 1: Append a behavior note**

Append to the end of `docs/superpowers/specs/2026-06-05-popup-settings-redesign-design.md`:

```markdown

## Description-gated giveaways (2026-06-06)

SteamGifts renders a giveaway's quick-entry insert button as `is-locked` whenever the giveaway has a description (it also shows a `giveaway__quick-entry-btn--description` button). The site unlocks the insert only after a successful `do=giveaway_description` AJAX call. The extension therefore:

- treats a locked insert with a sibling `--description` button as enterable (`GiveawayCore.isDescriptionGated` / relaxed `isEnterable`);
- background full-auto (`offscreen.js`) POSTs `do=giveaway_description` before `do=entry_insert`;
- in-page auto-enter (`autoStart.js`) clicks the description button and waits for `is-locked` to clear before clicking insert.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-05-popup-settings-redesign-design.md
git commit -m "docs: record description-gated giveaway handling"
```

---

### Task 5 (Optional): Update the standalone bookmarklet `steamgift.js`

`steamgift.js` is the self-contained paste-able version. Bring it to the same unlock-then-enter logic. Do this only if the bookmarklet is still distributed.

**Files:**
- Modify: `steamgift.js`

- [ ] **Step 1: Relax the bookmarklet's `isEnterable`**

In `steamgift.js`, replace the existing `isEnterable` function (currently lines 31–35):

```js
  function isEnterable(row) {
    if (row.classList.contains('is-faded')) return false;
    const insert = row.querySelector('.giveaway__quick-entry-btn--insert');
    return !!insert && !insert.classList.contains('is-locked');
  }
```

with:

```js
  function isEnterable(row) {
    if (row.classList.contains('is-faded')) return false;
    const insert = row.querySelector('.giveaway__quick-entry-btn--insert');
    if (!insert) return false;
    if (!insert.classList.contains('is-locked')) return true;
    return !!row.querySelector('.giveaway__quick-entry-btn--description');
  }
```

- [ ] **Step 2: Add `unlockIfNeeded` and unlock before clicking insert**

In `steamgift.js`, replace the existing `enterGiveaway` function (currently lines 61–89):

```js
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
```

with an unlock helper plus an `async` `enterGiveaway`:

```js
  function unlockIfNeeded(row) {
    return new Promise((resolve, reject) => {
      const insertBtn = row.querySelector('.giveaway__quick-entry-btn--insert');
      if (insertBtn && !insertBtn.classList.contains('is-locked')) {
        resolve();
        return;
      }
      const descBtn = row.querySelector('.giveaway__quick-entry-btn--description');
      if (!insertBtn || !descBtn) {
        reject(new Error('locked, no description'));
        return;
      }
      descBtn.click();
      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        if (!insertBtn.classList.contains('is-locked')) {
          clearInterval(timer);
          resolve();
        } else if (tries > 12) {
          clearInterval(timer);
          reject(new Error('unlock timeout'));
        }
      }, 500);
    });
  }

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

- [ ] **Step 3: Manually verify the bookmarklet**

1. On the logged-in wishlist page (with a not-yet-entered description-gated giveaway), open DevTools console.
2. Paste the full contents of `steamgift.js` and run it.
3. Confirm gated rows open their description, unlock, then enter (faded green); the final `alert` reports the count; no popups.

Expected: same unlock-then-enter behavior as the extension.

- [ ] **Step 4: Commit**

```bash
git add steamgift.js
git commit -m "feat: bookmarklet unlocks description-gated rows before entering"
```

---

### Task 6: Bump the manifest version and note the fix

**Files:**
- Modify: `manifest.json:5`
- Modify: `README.md`

- [ ] **Step 1: Bump the manifest version**

In `manifest.json`, change:

```json
  "version": "1.1",
```

to:

```json
  "version": "1.2",
```

- [ ] **Step 2: Note the fix in `README.md`**

Append under the existing content of `README.md`:

```markdown

- v1.2：支援「需先看說明」(description) 才能加入的抽獎 — 背景全自動會先送出 `giveaway_description` 再加入；頁面內自動加入會先點開說明解鎖再點擊加入。
```

- [ ] **Step 3: Commit**

```bash
git add manifest.json README.md
git commit -m "docs: bump version to 1.2 and note description-gated support"
```

---

## Self-Review

**Spec coverage:**
- User's report — locked giveaways needing the description opened first cannot be entered → fixed in the shared core (Task 1), the background path (Task 2), the in-page path (Task 3), and the bookmarklet (Task 5).
- The user's exact pasted element (`code=1bvNQ`, locked insert + `--description` button, form with `xsrf_token`/`code`) is modeled by fixture Row E (Task 1) and is the live target of the manual checks in Tasks 2–3.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows complete before/after code; every run step gives the exact command and expected pass/fail.

**Type/name consistency:** New method `isDescriptionGated(row)` is defined on `GiveawayCore` (Task 1) and consumed by the same name in `offscreen.js` (Task 2, `core.isDescriptionGated`). `isEnterable(row)` keeps its signature; the locked-no-description case (fixture Row B) still returns `false`, preserving the existing test. `postAjax(doValue, code, xsrf)` is defined once and reused via `enterOne`/`viewDescription` wrappers (Task 2). The unlock helper is named `unlockIfNeeded(row)` in both `autoStart.js` (Task 3) and `steamgift.js` (Task 5). The unlock/poll success signal is the removal of `is-locked`, matching what `bundle-v18.js` does on `giveaway_description` success.

**Known risk (flagged, not a placeholder):** It is not 100% confirmed whether the server *requires* the `giveaway_description` call before accepting `entry_insert`, or whether the lock is purely client-side. The plan always performs the description step first, which is correct either way; the cost is one extra request per gated giveaway, throttled by the existing `delayRandom()`. Tasks 2–3 verify the end-to-end result on the live site, and Task 2 Step 3 includes the concrete debugging hook (log the `ajax.php` response) if a gated giveaway still fails to enter.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-06-description-gated-giveaways.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
