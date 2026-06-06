# Humanize Phase 3 — Background AJAX → Default-Off "Aggressive Mode" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demote the structurally bot-like background AJAX full-auto to an opt-in "aggressive mode" (default off): when off, the popup full-auto button opens the wishlist tab so the humanized in-page auto-enter handles it; when on, the background path runs but is now humanized (reading delay + heavy-tailed gaps) and bounded by active hours and the daily cap.

**Architecture:** A `aggressiveMode` config (`{trigger:false}`) gates routing in the service worker's `fullAutoWishlist` handler. Off → `openWishlistTab()` (the safe, in-page path from Phases 1–2 runs there). On → the existing offscreen path, but the SW first checks active hours and the daily budget (inlined `inActiveHours`/`pickDailyCap` copies — the SW can't load the `window`-based `humanize.js`), passes `maxEntries`, and adds the entered count to `autoJoinCount`. `offscreen.js` loads `humanize.js` (via `offscreen.html`) and uses `readingDelayMs`/`humanDelayMs`/`maybeBreakMs` + the `maxEntries` cap. The popup shows a warning when aggressive mode is on and routes its click by mode.

**Tech Stack:** Chrome Extension MV3 (service worker, offscreen document, popup/options pages, `chrome.storage.sync`/`local`, `chrome.tabs`, `chrome.i18n`), Node test runner (unchanged 43 tests stay green — no new pure logic).

**Scope note:** Phase 3 of `docs/superpowers/specs/2026-06-06-humanize-anti-detection-design.md`. Phases 1 (timing/reading/scroll) and 2 (caps/active-hours/options/popup) are already on this branch. **User decision:** when aggressive mode is OFF, the popup button **opens/focuses the wishlist tab** (the in-page autoStart handles entering; requires the "autoStart" toggle on) — it does NOT force-inject.

---

## File Structure

- **Modify** `offscreen.js` — load-order: use `window.Humanize`; `runFullAuto(cfg, maxEntries)` stops at `maxEntries`, uses `readingDelayMs` (real description length) + `humanDelayMs` + `maybeBreakMs`.
- **Modify** `offscreen.html` — load `humanize.js` before `offscreen.js`.
- **Modify** `service-worker.js` — inline `inActiveHours`/`pickDailyCap`/`openWishlistTab`; route `fullAutoWishlist` by `aggressiveMode`; bound the aggressive path by active hours + daily budget + `maxEntries`; add `autoJoinCount` in `fullAutoResult`.
- **Modify** `defaultSchema.json` — add `aggressiveMode` default.
- **Modify** `options/options.html`, `options/options.js` — aggressive-mode toggle + warning.
- **Modify** `popup/popup.html`, `popup/popup.js` — aggressive warning + mode-aware click routing.
- **Modify** `_locales/zh_TW/messages.json`, `_locales/en/messages.json` — new labels.

---

### Task 1: Humanize the offscreen background path + cap

**Files:**
- Modify: `offscreen.js` (full replacement)
- Modify: `offscreen.html`

- [ ] **Step 1: Replace the entire contents of `offscreen.js`**

```js
const WISHLIST_URL = "https://www.steamgifts.com/giveaways/search?type=wishlist";
const ENTRY_URL = "https://www.steamgifts.com/ajax.php";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "runFullAuto") return;
  runFullAuto(message.cfg || {}, message.maxEntries || 0)
    .then(({ count, point, loggedIn }) => chrome.runtime.sendMessage({ type: "fullAutoResult", count, point, loggedIn }))
    .catch(() => chrome.runtime.sendMessage({ type: "fullAutoResult", count: 0 }));
});

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
    return await res.json();
  } catch (e) {
    return null;
  }
}

const enterOne = async (code, xsrf) => {
  const data = await postAjax("entry_insert", code, xsrf);
  return !!data && data.type === "success";
};

// 點開描述（giveaway_description）並回傳描述文字長度，供閱讀停留計算
const fetchDescriptionLen = async (code, xsrf) => {
  const data = await postAjax("giveaway_description", code, xsrf);
  return (data && data.html ? String(data.html) : "").length;
};

async function runFullAuto(cfg, maxEntries) {
  const human = window.Humanize;
  const res = await fetch(WISHLIST_URL, { credentials: "include" });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const xsrfEl = doc.querySelector('input[name="xsrf_token"]');
  const xsrf = xsrfEl ? xsrfEl.value : null;
  if (!xsrf) return { count: 0, loggedIn: false };

  const pointsEl = doc.querySelector('.nav__points');
  let myPoint = pointsEl ? Number((pointsEl.textContent || '').replace(/[^0-9]/g, '')) || 0 : 0;

  const core = window.GiveawayCore;
  const rows = [...doc.getElementsByClassName('giveaway__row-inner-wrap')];

  // inject score spans (same shape getScore/countScore expect) so passesMinimum works
  rows.forEach((row) => {
    const total = core.calculateWeight(row, cfg);
    let span = row.querySelector('span.auto_steam-score');
    if (!span) {
      span = doc.createElement('span');
      span.className = 'auto_steam-score';
      const heading = row.querySelector('.giveaway__heading');
      if (heading) heading.appendChild(span);
    }
    span.textContent = `(Score:${total})`;
  });

  const eligible = rows
    .filter((row) => core.isEnterable(row) && core.passesMinimum(row, cfg))
    .sort((a, b) => core.getScore(b) - core.getScore(a));

  const pointFloor = Number(cfg.pointFloor) || 0;
  let count = 0;

  for (const row of eligible) {
    if (count >= maxEntries) break; // 每日額度上限
    const cost = core.parsePointCost(row) || 0;
    if (myPoint - cost < pointFloor) continue;
    const code = core.extractCode(row);
    if (!code) continue;
    if (core.isDescriptionGated(row)) {
      const len = await fetchDescriptionLen(code, xsrf);
      await delay(human.readingDelayMs(len)); // 閱讀停留（伺服器可觀測）
    }
    const ok = await enterOne(code, xsrf);
    if (ok) {
      myPoint -= cost;
      count++;
    }
    await delay(human.humanDelayMs());
    const breakMs = human.maybeBreakMs();
    if (breakMs) await delay(breakMs);
  }
  return { count, point: myPoint, loggedIn: true };
}
```

- [ ] **Step 2: Load `humanize.js` in `offscreen.html`**

Replace the contents of `offscreen.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <script src="content_scripts/giveaway-core.js"></script>
  <script src="content_scripts/humanize.js"></script>
  <script src="offscreen.js"></script>
</body>
</html>
```

- [ ] **Step 3: Verify**

Run: `node --check offscreen.js`
Expected: exit 0.

Run: `npm test`
Expected: `# pass 43 # fail 0`.

- [ ] **Step 4: Commit**

```bash
git add offscreen.js offscreen.html
git commit -m "feat: offscreen background path humanized (reading/heavy-tailed) and capped by maxEntries"
```

---

### Task 2: Service-worker routing by `aggressiveMode` + budget

**Files:**
- Modify: `service-worker.js`
- Modify: `defaultSchema.json`

- [ ] **Step 1: Add `aggressiveMode` to `defaultSchema.json`**

Find:

```json
  "goLinkTarget": "wishlist",
  "fullAutoWarned": false,
  "activeHours": { "start": 600, "end": 120 }
}
```

Replace with:

```json
  "goLinkTarget": "wishlist",
  "fullAutoWarned": false,
  "activeHours": { "start": 600, "end": 120 },
  "aggressiveMode": { "trigger": false }
}
```

- [ ] **Step 2: Add SW constants + inline helpers**

In `service-worker.js`, find:

```js
const HOME_URL = "https://www.steamgifts.com/";
const POINT_TTL_MS = 6 * 60 * 60 * 1000; // 6 小時
```

Replace with:

```js
const HOME_URL = "https://www.steamgifts.com/";
const WISHLIST_URL = "https://www.steamgifts.com/giveaways/search?type=wishlist";
const POINT_TTL_MS = 6 * 60 * 60 * 1000; // 6 小時

// 與 content_scripts/humanize.js 同邏輯的精簡版（SW 無法載入 window 版的 humanize）
function inActiveHours(date, startMin, endMin) {
  const mins = date.getHours() * 60 + date.getMinutes();
  if (startMin === endMin) return true;
  if (startMin < endMin) return mins >= startMin && mins < endMin;
  return mins >= startMin || mins < endMin; // 跨午夜
}
function pickDailyCap(min = 50, max = 58) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
// 安全模式：開或聚焦願望清單分頁（頁內擬人化 autoStart 會處理加入）
function openWishlistTab() {
  chrome.tabs.query({ url: "https://www.steamgifts.com/giveaways/search?type=wishlist*" }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.tabs.reload(tabs[0].id);
    } else {
      chrome.tabs.create({ url: WISHLIST_URL });
    }
  });
}
```

- [ ] **Step 3: Route `fullAutoWishlist` by mode + budget**

Find the entire `case "fullAutoWishlist":` block:

```js
    case "fullAutoWishlist": {
      if (fullAutoRunning) break;
      fullAutoRunning = true;
      chrome.storage.local.set({ fullAutoRunning: true }); // 供 popup 顯示 loading
      // offscreen 文件拿不到 chrome.storage，所以由 SW 讀設定後用訊息帶過去
      chrome.storage.sync.get(FULL_AUTO_CFG_KEYS, (cfg) => {
        ensureOffscreen()
          .then(() => chrome.runtime.sendMessage({ type: "runFullAuto", cfg }))
          .catch(() => { fullAutoRunning = false; chrome.storage.local.set({ fullAutoRunning: false }); });
      });
      break;
    }
```

Replace with:

```js
    case "fullAutoWishlist": {
      chrome.storage.sync.get([...FULL_AUTO_CFG_KEYS, "aggressiveMode", "activeHours"], (cfg) => {
        const aggressive = !!(cfg.aggressiveMode && cfg.aggressiveMode.trigger);
        if (!aggressive) {
          openWishlistTab(); // 安全模式：開願望清單分頁，由頁內擬人化 autoStart 處理
          return;
        }
        // 激進模式：背景 offscreen，受活躍時段與每日預算限制
        const ah = cfg.activeHours || { start: 600, end: 120 };
        if (!inActiveHours(new Date(), ah.start, ah.end)) return; // 非活躍時段不跑
        if (fullAutoRunning) return;
        chrome.storage.local.get(["autoJoinDate", "autoJoinCount", "autoJoinCap"], (b) => {
          const today = new Date().toLocaleDateString('en-CA');
          let count = 0;
          let cap;
          if (b.autoJoinDate === today && b.autoJoinCap != null) {
            count = b.autoJoinCount || 0;
            cap = b.autoJoinCap;
          } else {
            cap = pickDailyCap();
            chrome.storage.local.set({ autoJoinDate: today, autoJoinCount: 0, autoJoinCap: cap });
          }
          const remaining = Math.max(0, cap - count);
          if (remaining <= 0) return; // 今日額度用完
          fullAutoRunning = true;
          chrome.storage.local.set({ fullAutoRunning: true }); // 供 popup 顯示 loading
          ensureOffscreen()
            .then(() => chrome.runtime.sendMessage({ type: "runFullAuto", cfg, maxEntries: remaining }))
            .catch(() => { fullAutoRunning = false; chrome.storage.local.set({ fullAutoRunning: false }); });
        });
      });
      break;
    }
```

- [ ] **Step 4: Add `autoJoinCount` accounting in `fullAutoResult`**

Find:

```js
      if (message.count > 0) {
        chrome.storage.sync.get(["totalEnterGiveaway"], (c) => {
          chrome.storage.sync.set({ totalEnterGiveaway: (c.totalEnterGiveaway || 0) + message.count });
        });
      }
```

Replace with:

```js
      if (message.count > 0) {
        chrome.storage.sync.get(["totalEnterGiveaway"], (c) => {
          chrome.storage.sync.set({ totalEnterGiveaway: (c.totalEnterGiveaway || 0) + message.count });
        });
        chrome.storage.local.get(["autoJoinCount"], (s) => {
          chrome.storage.local.set({ autoJoinCount: (s.autoJoinCount || 0) + message.count });
        });
      }
```

- [ ] **Step 5: Verify**

Run: `node --check service-worker.js`
Expected: exit 0.

Run: `node -e "JSON.parse(require('fs').readFileSync('defaultSchema.json','utf8')); console.log('schema OK')"`
Expected: `schema OK`

Run: `npm test`
Expected: `# pass 43 # fail 0`.

- [ ] **Step 6: Commit**

```bash
git add service-worker.js defaultSchema.json
git commit -m "feat: full-auto routes by aggressiveMode (off=open wishlist tab, on=capped background)"
```

---

### Task 3: Options — aggressive-mode toggle + warning

**Files:**
- Modify: `options/options.html`
- Modify: `options/options.js`
- Modify: `_locales/zh_TW/messages.json`, `_locales/en/messages.json`

- [ ] **Step 1: Add i18n labels to both locales**

In `_locales/zh_TW/messages.json`, find:

```json
  "optActiveHours": { "message": "自動加入時段（跨午夜可設定如 10:00–02:00）", "description": "設定頁活躍時段" },
```

Add after it:

```json
  "optAggressive": { "message": "激進模式：背景全自動（風險較高）", "description": "設定頁激進模式開關" },
  "optAggressiveWarn": { "message": "背景直接連續送出加入請求、無頁面瀏覽，結構上較易被偵測。預設關閉；一般請用安全模式（開願望清單分頁、頁內擬人化加入）。", "description": "設定頁激進模式警告" },
```

In `_locales/en/messages.json`, find:

```json
  "optActiveHours": { "message": "Auto-join hours (may wrap midnight, e.g. 10:00–02:00)", "description": "options active hours" },
```

Add after it:

```json
  "optAggressive": { "message": "Aggressive mode: background full-auto (higher risk)", "description": "options aggressive mode toggle" },
  "optAggressiveWarn": { "message": "The background path fires entries directly with no page views, which is structurally easier to detect. Off by default; normally use safe mode (open the wishlist tab, humanized in-page entering).", "description": "options aggressive mode warning" },
```

- [ ] **Step 2: Add the toggle to `options/options.html`**

Find the Automation section (now including the active-hours field):

```html
    <label class="field inline"><input type="checkbox" id="opt-autoStart">__MSG_formAutoStart__</label>
    <div class="field"><label>__MSG_optActiveHours__</label><input type="time" id="activeStart"> – <input type="time" id="activeEnd"></div>
  </section>
```

Replace with:

```html
    <label class="field inline"><input type="checkbox" id="opt-autoStart">__MSG_formAutoStart__</label>
    <div class="field"><label>__MSG_optActiveHours__</label><input type="time" id="activeStart"> – <input type="time" id="activeEnd"></div>
    <label class="field inline"><input type="checkbox" id="opt-aggressive">__MSG_optAggressive__</label>
    <p class="warn">__MSG_optAggressiveWarn__</p>
  </section>
```

- [ ] **Step 3: Wire it in `options/options.js`**

Add `aggressiveMode` to the `load()` get array. Find:

```js
    [...WEIGHT_KEYS, "autoScore", "autoStart", "minScore", "minLevel", "requiredTypes", "pointFloor", "goLinkTarget", "activeHours"],
```

Replace with:

```js
    [...WEIGHT_KEYS, "autoScore", "autoStart", "minScore", "minLevel", "requiredTypes", "pointFloor", "goLinkTarget", "activeHours", "aggressiveMode"],
```

Then, inside `load()`, find:

```js
      const ah = cfg.activeHours || { start: 600, end: 120 };
      document.getElementById("activeStart").value = minToHHMM(ah.start);
      document.getElementById("activeEnd").value = minToHHMM(ah.end);
    }
```

Replace with:

```js
      const ah = cfg.activeHours || { start: 600, end: 120 };
      document.getElementById("activeStart").value = minToHHMM(ah.start);
      document.getElementById("activeEnd").value = minToHHMM(ah.end);
      document.getElementById("opt-aggressive").checked = !!(cfg.aggressiveMode && cfg.aggressiveMode.trigger);
    }
```

Then register the change listener. Find:

```js
document.getElementById("activeStart").addEventListener("change", saveActiveHours);
document.getElementById("activeEnd").addEventListener("change", saveActiveHours);
```

Add after it:

```js
document.getElementById("activeStart").addEventListener("change", saveActiveHours);
document.getElementById("activeEnd").addEventListener("change", saveActiveHours);
document.getElementById("opt-aggressive").addEventListener("change", (e) =>
  chrome.storage.sync.set({ aggressiveMode: { trigger: e.target.checked } }));
```

- [ ] **Step 4: Verify JSON + parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('_locales/zh_TW/messages.json','utf8')); JSON.parse(require('fs').readFileSync('_locales/en/messages.json','utf8')); console.log('locales OK')"`
Expected: `locales OK`

Run: `node --check options/options.js`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add options/options.html options/options.js _locales/zh_TW/messages.json _locales/en/messages.json
git commit -m "feat: options aggressive-mode toggle with warning"
```

---

### Task 4: Popup — aggressive warning + mode-aware button routing

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.js`
- Modify: `_locales/zh_TW/messages.json`, `_locales/en/messages.json`

- [ ] **Step 1: Add the i18n label to both locales**

In `_locales/zh_TW/messages.json`, find:

```json
  "popToday": { "message": "今日已加入", "description": "popup 今日已加入計數標籤" },
```

Add after it:

```json
  "popAggressiveWarn": { "message": "⚠ 激進模式開啟中（背景全自動，風險較高）", "description": "popup 激進模式警告" },
```

In `_locales/en/messages.json`, find:

```json
  "popToday": { "message": "Entered today", "description": "popup entered-today count label" },
```

Add after it:

```json
  "popAggressiveWarn": { "message": "⚠ Aggressive mode is on (background full-auto, higher risk)", "description": "popup aggressive mode warning" },
```

- [ ] **Step 2: Add the warning element to `popup/popup.html`**

Find:

```html
  <div class="today-count"><span>__MSG_popToday__</span>: <span id="todayCount">0 / —</span></div>
```

Replace with:

```html
  <div class="today-count"><span>__MSG_popToday__</span>: <span id="todayCount">0 / —</span></div>

  <div id="aggressiveWarn" class="warn" style="display:none;">__MSG_popAggressiveWarn__</div>
```

- [ ] **Step 3: Read the mode + render the warning in `popup/popup.js`**

Find:

```js
const fullAutoBtn = document.getElementById("fullAutoBtn");
const loginBanner = document.getElementById("loginBanner");
const recheckLoginBtn = document.getElementById("recheckLoginBtn");
let fullAutoArmed = false;
let isRunning = false;
let loggedOut = false;
```

Replace with:

```js
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
```

- [ ] **Step 4: Route the full-auto click by mode**

Find the full-auto click handler:

```js
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

Replace with:

```js
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
    isRunning = true;
    renderFullAutoBtn(); // 立即回饋；保持 popup 開著
  });
});
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
git add popup/popup.html popup/popup.js _locales/zh_TW/messages.json _locales/en/messages.json
git commit -m "feat: popup aggressive-mode warning + mode-aware full-auto routing"
```

---

### Task 5: End-to-end manual verification

**Files:** none.

- [ ] **Step 1: Safe mode (default) — opens the wishlist tab**

1. `chrome://extensions` → reload; sign in; enable `autoScore`+`autoStart`; confirm aggressive mode is **off** in options.
2. Open the popup → no aggressive warning; click full-auto → a wishlist tab opens/focuses and the popup closes. In that tab the humanized in-page auto-enter runs (arrival delay, irregular gaps). No background offscreen run occurs (service-worker console shows no `runFullAuto`).

- [ ] **Step 2: Aggressive mode — capped background run**

3. In options, enable "激進模式"; reopen the popup → the aggressive warning shows.
4. Click full-auto (confirm twice the first time) → the button shows "抽取中…", the **background** path runs (service-worker console shows `runFullAuto` with a `maxEntries`); entries come with **multi-second irregular gaps** (not the old uniform 0.8–2s) and gated giveaways pause for a reading delay; the run stops at the daily remaining; the done notification fires and "今日已加入 X/Y" reflects the new count.
5. **Active-hours gate (aggressive):** set `chrome.storage.sync.set({ activeHours: { start: 0, end: 1 } })`, click full-auto → nothing runs (outside window). Restore `{600,120}`.
6. **Cap (aggressive):** with `autoJoinCount` near `autoJoinCap`, a run enters at most the remaining and does not exceed the cap.

- [ ] **Step 2.5: Options round-trip**

7. Toggle aggressive mode off/on in options, reopen options → the checkbox persists; the warning text is visible under it.

- [ ] **Step 3: Confirm the unit suite**

Run: `npm test`
Expected: `# fail 0` (43 tests).

---

## Self-Review

**Spec coverage (Phase 3 portion):**
- Background AJAX → default-off aggressive mode → Task 2 (routing) + Task 3 (toggle) + `defaultSchema` default `{trigger:false}`.
- Safe-mode button opens the wishlist tab (user's chosen behavior) → Task 2 (`openWishlistTab`) + Task 4 (popup routes by mode, no stuck loading because safe mode closes the popup).
- Aggressive path humanized (reading delay on real description length, heavy-tailed gaps, breaks) + bounded by active hours + daily cap + `maxEntries` → Task 1 (offscreen) + Task 2 (SW gate/budget) + `fullAutoResult` `autoJoinCount` accounting.
- Warnings surfaced (options + popup) → Tasks 3, 4.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows complete before/after (or full-file) content; every run step states the exact command and expected output.

**Type/name consistency:** `aggressiveMode` is the `{trigger}`-shaped sync key — defaulted in `defaultSchema.json` (Task 2), read in the SW (Task 2 `cfg.aggressiveMode.trigger`), options (Task 3), and popup (Task 4), all consistently. `runFullAuto(cfg, maxEntries)` (Task 1 offscreen) is called by the SW message `{type:"runFullAuto", cfg, maxEntries}` (Task 2) with the matching second arg via `message.maxEntries`. `autoJoinDate`/`autoJoinCount`/`autoJoinCap` keys and the local-date `toLocaleDateString('en-CA')` reset match Phase 2's `autoStart.js` exactly, so both paths share one budget. The SW's inlined `inActiveHours`/`pickDailyCap` mirror the tested `humanize.js` versions (50–58 cap, wrap-aware window). `WISHLIST_URL` is defined in both the SW (new) and offscreen (pre-existing, separate file scope) — no clash.

**Known note (not a placeholder):** the SW's `inActiveHours`/`pickDailyCap` are intentional small copies (the service worker cannot load the `window`-based `humanize.js`); their logic is identical to the unit-tested originals. All Phase-3 paths are chrome/DOM/SW code with no unit harness — verified by `node --check`, JSON validation, and the Task 5 manual checks; the 43 pure-logic tests stay green.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-06-humanize-phase3-aggressive-mode.md`. Continuing on branch `feat/humanize-phase1` per the user's "complete all phases on one branch" instruction; executing via subagent-driven development.
