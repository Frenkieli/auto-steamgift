# Humanize Phase 2 — Daily Cap, Active Hours, Early-Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound the in-page auto-enter by volume and time: a per-day randomized cap (~50–58, persisted, reset daily), an active-hours window (default 10:00–02:00, wrap-aware), and a probabilistic early-stop so a session enters a variable number then stops — plus the options field to set the window and a popup "entered today X/Y" readout.

**Architecture:** Three more pure helpers in `content_scripts/humanize.js` (`inActiveHours`, `pickDailyCap`, `shouldEarlyStop`) are unit-tested. `autoStart.js` gains an active-hours gate and a daily-budget gate (state in `chrome.storage.local`: `autoJoinDate`/`autoJoinCount`/`autoJoinCap`), stops when the budget is exhausted or early-stop fires, and persists the count as it enters. Options gets an active-hours input; popup shows today's count. This builds on Phase 1 and does NOT touch the background offscreen path (Phase 3).

**Tech Stack:** Chrome Extension MV3 (vanilla JS, content scripts, `chrome.storage.local`/`sync`, options/popup pages, `chrome.i18n`), Node test runner for the pure helpers.

**Scope note:** Phase 2 of `docs/superpowers/specs/2026-06-06-humanize-anti-detection-design.md`. Phase 1 (timing/reading/scroll) is already merged on this branch. Phase 3 (background AJAX → default-off "aggressive mode") is a later plan.

---

## File Structure

- **Modify** `content_scripts/humanize.js` — add `inActiveHours`, `pickDailyCap`, `shouldEarlyStop`.
- **Modify** `tests/humanize.test.js` — add tests for the three new helpers.
- **Modify** `content_scripts/autoStart.js` — active-hours gate + daily-budget gate/persistence + early-stop (full rewrite).
- **Modify** `defaultSchema.json` — add `activeHours` default.
- **Modify** `options/options.html`, `options/options.js` — active-hours inputs.
- **Modify** `popup/popup.html`, `popup/popup.js` — "entered today X/Y" line.
- **Modify** `_locales/zh_TW/messages.json`, `_locales/en/messages.json` — new labels.

---

### Task 1: `humanize.js` — active-hours, daily cap, early-stop (TDD)

**Files:**
- Modify: `content_scripts/humanize.js`
- Modify: `tests/humanize.test.js`

- [ ] **Step 1: Append the failing tests to `tests/humanize.test.js`**

```js
test('inActiveHours handles a wrap-around window 10:00-02:00', () => {
  const at = (h, m = 0) => new Date(2026, 0, 1, h, m); // local-time components
  assert.strictEqual(Humanize.inActiveHours(at(9, 59), 600, 120), false);
  assert.strictEqual(Humanize.inActiveHours(at(10, 0), 600, 120), true);
  assert.strictEqual(Humanize.inActiveHours(at(23, 0), 600, 120), true);
  assert.strictEqual(Humanize.inActiveHours(at(1, 59), 600, 120), true);
  assert.strictEqual(Humanize.inActiveHours(at(2, 0), 600, 120), false);
  assert.strictEqual(Humanize.inActiveHours(at(5, 0), 600, 120), false);
});

test('inActiveHours handles a same-day window 10:00-22:00', () => {
  const at = (h) => new Date(2026, 0, 1, h, 0);
  assert.strictEqual(Humanize.inActiveHours(at(12), 600, 1320), true);
  assert.strictEqual(Humanize.inActiveHours(at(23), 600, 1320), false);
  assert.strictEqual(Humanize.inActiveHours(at(9), 600, 1320), false);
});

test('pickDailyCap stays within [50,58] and hits both ends', () => {
  for (let i = 0; i < 1000; i++) {
    const c = Humanize.pickDailyCap();
    assert.ok(c >= 50 && c <= 58 && Number.isInteger(c), `bad cap: ${c}`);
  }
  assert.strictEqual(Humanize.pickDailyCap(() => 0), 50);
  assert.strictEqual(Humanize.pickDailyCap(() => 0.999), 58);
});

test('shouldEarlyStop fires below the probability and not above', () => {
  assert.strictEqual(Humanize.shouldEarlyStop(() => 0.05), true);
  assert.strictEqual(Humanize.shouldEarlyStop(() => 0.5), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Humanize.inActiveHours is not a function` (and the other two).

- [ ] **Step 3: Implement the three helpers in `content_scripts/humanize.js`**

In `content_scripts/humanize.js`, find:

```js
  const Humanize = { humanDelayMs, readingDelayMs, maybeBreakMs };
```

Add the three functions immediately **above** that line, and extend the exported object:

```js
  // 是否在活躍時段內（分鐘為單位）；start>end 代表跨午夜
  function inActiveHours(date, startMin, endMin) {
    const mins = date.getHours() * 60 + date.getMinutes();
    if (startMin === endMin) return true; // 全天
    if (startMin < endMin) return mins >= startMin && mins < endMin;
    return mins >= startMin || mins < endMin; // 跨午夜
  }

  // 每日上限（每天重抽，稍微隨機）
  function pickDailyCap(rng = Math.random, min = 50, max = 58) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  // 機率早停：本 session 有機率提早收手
  function shouldEarlyStop(rng = Math.random, p = 0.10) {
    return rng() < p;
  }

  const Humanize = { humanDelayMs, readingDelayMs, maybeBreakMs, inActiveHours, pickDailyCap, shouldEarlyStop };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the 4 new tests pass; total is now 43 (39 + 4).

- [ ] **Step 5: Commit**

```bash
git add content_scripts/humanize.js tests/humanize.test.js
git commit -m "feat: humanize adds inActiveHours, pickDailyCap, shouldEarlyStop"
```

---

### Task 2: `autoStart.js` — active-hours gate, daily budget, early-stop

**Files:**
- Modify: `content_scripts/autoStart.js` (full replacement)

The structural change (an extra `chrome.storage.local.get` wrapping the run, plus budget bookkeeping in the loop) is large, so replace the whole file.

- [ ] **Step 1: Replace the entire contents of `content_scripts/autoStart.js`**

```js
chrome.storage.sync.get(["minScore", "minLevel", "requiredTypes", "pointFloor", "activeHours"], function (cfg) {
  setTimeout(() => {
    if (!document.querySelector('.nav__points')) return; // 未登入則不自動加入

    const human = window.Humanize;

    // 活躍時段檢查：非時段不動作
    const ah = cfg.activeHours || { start: 600, end: 120 };
    if (!human.inActiveHours(new Date(), ah.start, ah.end)) return;

    // 每日預算（storage.local）：跨次/跨頁累計，到頂就停、隔天重置
    chrome.storage.local.get(["autoJoinDate", "autoJoinCount", "autoJoinCap"], function (budget) {
      const today = new Date().toLocaleDateString('en-CA'); // 本地 YYYY-MM-DD
      let autoJoinDate = budget.autoJoinDate;
      let autoJoinCount = budget.autoJoinCount || 0;
      let autoJoinCap = budget.autoJoinCap;
      if (autoJoinDate !== today) {
        autoJoinDate = today;
        autoJoinCount = 0;
        autoJoinCap = human.pickDailyCap();
        chrome.storage.local.set({ autoJoinDate, autoJoinCount, autoJoinCap });
      }
      let remaining = Math.max(0, autoJoinCap - autoJoinCount);
      if (remaining <= 0) return; // 今日額度用完

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
      // 派發基本 hover 事件（客戶端便宜保險）
      function hover(el) {
        ['mouseover', 'mousemove', 'mouseenter'].forEach((type) =>
          el.dispatchEvent(new MouseEvent(type, { bubbles: true })));
      }

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
      const pointsEl = document.querySelector('.nav__points');
      let myPoint = pointsEl ? Number(pointsEl.innerText) : 0;
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
          hover(descBtn);
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

      // 4) 逐一抽取，受每日額度與機率早停限制，每次之間用擬人化間隔
      async function enterAll(list) {
        for (const row of list) {
          if (remaining <= 0) break; // 今日額度用完就停
          try {
            await enterGiveaway(row);
            countEntryGift++;
            autoJoinCount++;
            remaining--;
            chrome.storage.local.set({ autoJoinCount });
            chrome.runtime.sendMessage({ type: "setBadgeText", text: String(countEntryGift) });
            chrome.storage.sync.get(["totalEnterGiveaway"], function (config) {
              const total = ((config.totalEnterGiveaway || 0) * 1) + 1;
              chrome.storage.sync.set({ totalEnterGiveaway: total });
            });
            giftCardUiChange({ cardElement: row, text: CARD_TEXT.Enter, ...CARD_STATE.Success });
          } catch (e) {
            giftCardUiChange({ cardElement: row, text: CARD_TEXT.Fail, ...CARD_STATE.Fail });
          }
          await delay(human.humanDelayMs());
          const breakMs = human.maybeBreakMs();
          if (breakMs) await delay(breakMs);
          if (human.shouldEarlyStop()) break; // 機率早停
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
        chrome.runtime.sendMessage({ type: "autoEnterDone", count: countEntryGift });
      }

      enterAll(readyToEnterGiftElements);
    });
  }, 2000 + Math.floor(Math.random() * 8000)); // 抵達延遲：頁面載入後 2–10 秒才開始
});
```

- [ ] **Step 2: Verify it parses and the suite stays green**

Run: `node --check content_scripts/autoStart.js`
Expected: exit 0.

Run: `npm test`
Expected: `# pass 43 # fail 0` (no tested code changed here).

- [ ] **Step 3: Commit**

```bash
git add content_scripts/autoStart.js
git commit -m "feat: autoStart respects active hours, daily randomized cap, and early-stop"
```

---

### Task 3: `defaultSchema.json` default + options active-hours UI

**Files:**
- Modify: `defaultSchema.json`
- Modify: `options/options.html`
- Modify: `options/options.js`
- Modify: `_locales/zh_TW/messages.json`, `_locales/en/messages.json`

- [ ] **Step 1: Add the default to `defaultSchema.json`**

Find:

```json
  "goLinkTarget": "wishlist",
  "fullAutoWarned": false
}
```

Replace with:

```json
  "goLinkTarget": "wishlist",
  "fullAutoWarned": false,
  "activeHours": { "start": 600, "end": 120 }
}
```

- [ ] **Step 2: Add the i18n label to both locales**

In `_locales/zh_TW/messages.json`, find:

```json
  "optAutomation": { "message": "自動化", "description": "設定頁自動化區塊" },
```

Add after it:

```json
  "optAutomation": { "message": "自動化", "description": "設定頁自動化區塊" },
  "optActiveHours": { "message": "自動加入時段（跨午夜可設定如 10:00–02:00）", "description": "設定頁活躍時段" },
```

In `_locales/en/messages.json`, find:

```json
  "optAutomation": { "message": "Automation", "description": "options automation section" },
```

Add after it:

```json
  "optAutomation": { "message": "Automation", "description": "options automation section" },
  "optActiveHours": { "message": "Auto-join hours (may wrap midnight, e.g. 10:00–02:00)", "description": "options active hours" },
```

(If the en key text differs slightly, keep the existing `optAutomation` line unchanged and only add the new `optActiveHours` line after it.)

- [ ] **Step 3: Add the inputs to `options/options.html`**

Find the Automation section:

```html
  <section>
    <h2>__MSG_optAutomation__</h2>
    <label class="field inline"><input type="checkbox" id="opt-autoScore">__MSG_formAutoScore__</label>
    <label class="field inline"><input type="checkbox" id="opt-autoStart">__MSG_formAutoStart__</label>
  </section>
```

Replace with:

```html
  <section>
    <h2>__MSG_optAutomation__</h2>
    <label class="field inline"><input type="checkbox" id="opt-autoScore">__MSG_formAutoScore__</label>
    <label class="field inline"><input type="checkbox" id="opt-autoStart">__MSG_formAutoStart__</label>
    <div class="field"><label>__MSG_optActiveHours__</label><input type="time" id="activeStart"> – <input type="time" id="activeEnd"></div>
  </section>
```

- [ ] **Step 4: Wire the inputs in `options/options.js`**

In `options/options.js`, add the `activeHours` key to the `load()` get array. Find:

```js
    [...WEIGHT_KEYS, "autoScore", "autoStart", "minScore", "minLevel", "requiredTypes", "pointFloor", "goLinkTarget"],
```

Replace with:

```js
    [...WEIGHT_KEYS, "autoScore", "autoStart", "minScore", "minLevel", "requiredTypes", "pointFloor", "goLinkTarget", "activeHours"],
```

Then, inside `load()`, find:

```js
      document.getElementById("opt-autoScore").checked = !!(cfg.autoScore && cfg.autoScore.trigger);
      document.getElementById("opt-autoStart").checked = !!(cfg.autoStart && cfg.autoStart.trigger);
    }
  );
}
```

Replace with:

```js
      document.getElementById("opt-autoScore").checked = !!(cfg.autoScore && cfg.autoScore.trigger);
      document.getElementById("opt-autoStart").checked = !!(cfg.autoStart && cfg.autoStart.trigger);
      const ah = cfg.activeHours || { start: 600, end: 120 };
      document.getElementById("activeStart").value = minToHHMM(ah.start);
      document.getElementById("activeEnd").value = minToHHMM(ah.end);
    }
  );
}

function minToHHMM(min) {
  const h = String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, "0");
  const m = String(((min % 60) + 60) % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function hhmmToMin(v) {
  const [h, m] = (v || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function saveActiveHours() {
  chrome.storage.sync.set({
    activeHours: {
      start: hhmmToMin(document.getElementById("activeStart").value),
      end: hhmmToMin(document.getElementById("activeEnd").value)
    }
  });
}
```

Then register the change listeners. Find:

```js
document.getElementById("opt-autoStart").addEventListener("change", (e) =>
  chrome.storage.sync.set({ autoStart: { trigger: e.target.checked } }));
```

Add after it:

```js
document.getElementById("opt-autoStart").addEventListener("change", (e) =>
  chrome.storage.sync.set({ autoStart: { trigger: e.target.checked } }));
document.getElementById("activeStart").addEventListener("change", saveActiveHours);
document.getElementById("activeEnd").addEventListener("change", saveActiveHours);
```

- [ ] **Step 5: Verify JSON + parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('defaultSchema.json','utf8')); JSON.parse(require('fs').readFileSync('_locales/zh_TW/messages.json','utf8')); JSON.parse(require('fs').readFileSync('_locales/en/messages.json','utf8')); console.log('json OK')"`
Expected: `json OK`

Run: `node --check options/options.js`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add defaultSchema.json options/options.html options/options.js _locales/zh_TW/messages.json _locales/en/messages.json
git commit -m "feat: options active-hours field + default 10:00-02:00"
```

---

### Task 4: Popup "entered today X / Y"

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.js`
- Modify: `_locales/zh_TW/messages.json`, `_locales/en/messages.json`

- [ ] **Step 1: Add the i18n label to both locales**

In `_locales/zh_TW/messages.json`, find:

```json
  "popRecheckLoginChecking": { "message": "檢查中…", "description": "popup 重新檢查進行中標籤" },
```

Add after it:

```json
  "popRecheckLoginChecking": { "message": "檢查中…", "description": "popup 重新檢查進行中標籤" },
  "popToday": { "message": "今日已加入", "description": "popup 今日已加入計數標籤" },
```

In `_locales/en/messages.json`, find:

```json
  "popRecheckLoginChecking": { "message": "Checking…", "description": "popup re-check in progress label" },
```

Add after it:

```json
  "popRecheckLoginChecking": { "message": "Checking…", "description": "popup re-check in progress label" },
  "popToday": { "message": "Entered today", "description": "popup entered-today count label" },
```

- [ ] **Step 2: Add the readout element to `popup/popup.html`**

Find:

```html
  <div id="loginBanner" class="login-banner" style="display:none;">
    <span>__MSG_popLoginLost__</span>
    <button id="recheckLoginBtn" class="recheck-btn">__MSG_popRecheckLogin__</button>
  </div>
```

Add a today-count line immediately after that block:

```html
  <div id="loginBanner" class="login-banner" style="display:none;">
    <span>__MSG_popLoginLost__</span>
    <button id="recheckLoginBtn" class="recheck-btn">__MSG_popRecheckLogin__</button>
  </div>

  <div class="today-count"><span>__MSG_popToday__</span>: <span id="todayCount">0 / —</span></div>
```

- [ ] **Step 3: Render it in `popup/popup.js`**

In `popup/popup.js`, find the initial local read:

```js
// 開啟 popup 時反映目前的抽取/登入狀態
chrome.storage.local.get(["fullAutoRunning", "loggedIn"], (s) => {
  isRunning = !!s.fullAutoRunning;
  loggedOut = s.loggedIn === false;
  renderFullAutoBtn();
  renderLoginBanner();
});
```

Replace with:

```js
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
```

Then, in the existing `storage.onChanged` listener, find:

```js
  if (changes.loggedIn) {
    loggedOut = changes.loggedIn.newValue === false;
    renderFullAutoBtn();
    renderLoginBanner();
  }
});
```

Replace with:

```js
  if (changes.loggedIn) {
    loggedOut = changes.loggedIn.newValue === false;
    renderFullAutoBtn();
    renderLoginBanner();
  }
  if (changes.autoJoinCount || changes.autoJoinCap) {
    chrome.storage.local.get(["autoJoinCount", "autoJoinCap"], (s) => renderTodayCount(s.autoJoinCount, s.autoJoinCap));
  }
});
```

- [ ] **Step 4: Add a style to `popup/popup.css`**

Append to `popup/popup.css`:

```css
.today-count {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 12px;
}
```

- [ ] **Step 5: Verify**

Run: `node -e "JSON.parse(require('fs').readFileSync('_locales/zh_TW/messages.json','utf8')); JSON.parse(require('fs').readFileSync('_locales/en/messages.json','utf8')); console.log('locales OK')"`
Expected: `locales OK`

Run: `node --check popup/popup.js`
Expected: exit 0.

Run: `npm test`
Expected: `# pass 43 # fail 0`.

- [ ] **Step 6: Commit**

```bash
git add popup/popup.html popup/popup.js popup/popup.css _locales/zh_TW/messages.json _locales/en/messages.json
git commit -m "feat: popup shows entered-today X/Y count"
```

---

### Task 5: End-to-end manual verification

**Files:** none.

- [ ] **Step 1: Verify the gates and counter (live, spends points)**

1. `chrome://extensions` → reload; sign in; enable `autoScore`+`autoStart`.
2. **Active-hours gate:** in the service-worker console run `chrome.storage.sync.set({ activeHours: { start: 0, end: 1 } })` (a window that excludes "now" unless it's 00:00–00:01). Open the wishlist → confirm **nothing is entered** (outside the window). Then set `chrome.storage.sync.set({ activeHours: { start: 600, end: 120 } })` (or a window covering now) and reload the wishlist → entering proceeds.
3. **Daily cap + counter:** open the popup → "今日已加入 X / Y" shows a Y in 50–58. Enter some giveaways; confirm X increments in the popup live and `chrome.storage.local` `autoJoinCount` grows; confirm a run does not exceed `autoJoinCap`.
4. **Daily reset:** in the service-worker console run `chrome.storage.local.set({ autoJoinDate: "2000-01-01" })`, reload the wishlist → confirm `autoJoinCount` resets to 0 and a fresh `autoJoinCap` (50–58) is chosen.
5. **Early-stop:** over a few runs on a wishlist with many eligible giveaways, confirm sessions sometimes stop before the cap/eligible list is exhausted (variable session length).
6. **Options:** open options → the active-hours fields show 10:00 and 02:00; change them, reopen options → values persist.

- [ ] **Step 2: Confirm the unit suite**

Run: `npm test`
Expected: `# fail 0` (43 tests).

---

## Self-Review

**Spec coverage (Phase 2 portion):**
- Active-hours window (10:00–02:00, wrap-aware) → Task 1 (`inActiveHours`) + Task 2 (gate) + Task 3 (default + options UI).
- Daily randomized cap ~50–58, persisted, reset daily → Task 1 (`pickDailyCap`) + Task 2 (budget read/reset/persist).
- Probabilistic early-stop → Task 1 (`shouldEarlyStop`) + Task 2 (loop `break`).
- Both paths share the cap/hours semantics — in-page handled here; background path (Phase 3) is explicitly out of scope.
- Popup "今日 X/Y" → Task 4. High-score-first, no skipping → preserved in Task 2 (sort unchanged; only the cap/early-stop limit volume).

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows complete before/after (or full-file) content; every run step states the exact command and expected output.

**Type/name consistency:** `inActiveHours(date, startMin, endMin)`, `pickDailyCap(rng, min, max)`, `shouldEarlyStop(rng, p)` defined in Task 1 and called in Task 2 (`human.inActiveHours(new Date(), ah.start, ah.end)`, `human.pickDailyCap()`, `human.shouldEarlyStop()`). Storage keys `autoJoinDate`/`autoJoinCount`/`autoJoinCap` are written in Task 2 and read in Task 4 (popup) with matching names, all in `storage.local`. The config key `activeHours` `{start,end}` (minutes) is defaulted in `defaultSchema.json` (Task 3), read by `autoStart.js` (Task 2) and options (Task 3), with `minToHHMM`/`hhmmToMin` converting to the `<input type="time">` `HH:MM` value. i18n keys `optActiveHours` (Task 3) and `popToday` (Task 4) are added before they are referenced.

**Known note (not a placeholder):** `autoStart.js`, options, and popup are chrome/DOM code with no unit harness; they are covered by `node --check` + JSON validation + the Task 5 manual checks. Only the pure `humanize.js` helpers are unit-tested — by design.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-06-humanize-phase2-caps-hours.md`. Continuing on branch `feat/humanize-phase1` per the user's "complete all phases on one branch" instruction; executing via subagent-driven development.
