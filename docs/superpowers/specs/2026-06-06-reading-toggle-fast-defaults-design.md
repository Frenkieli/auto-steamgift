# Reading-Time Toggle + Faster Defaults — Design

**Date:** 2026-06-06
**Status:** Approved

## Goal

Make the auto-join flow faster by default and give users one switch to control whether the extension simulates "reading the description" before entering a giveaway.

## Context

Humanize timing is config-driven through a single `DEFAULTS` object in `content_scripts/humanize.js`, mirrored as a seed in `defaultSchema.json`, surfaced in `options/`. Two delay call sites both route through `Humanize.readingDelayMs`:
- `content_scripts/autoStart.js:115` (on-page content script)
- `offscreen.js:87` (full-auto path)

The page-arrival delay (`autoStart.js:172`) and the per-entry micro-pauses (scroll/hover in `autoStart.js:121,124`) are hardcoded, not config-driven.

This builds on the earlier change this session that lowered the timing defaults (reading 0.4–1.5s, gap median 4s, arrival 0.5–2s).

## Decisions

1. **Reading delay becomes a user toggle, default OFF.** By default the extension does not simulate reading; after clicking the description it proceeds immediately. A checkbox lets users turn the reading pause back on.
2. **When the toggle is ON, the reading pause is 0.5–1s** (not the previous 0.4–1.5s).
3. **Page-arrival delay shortened to 0.5–1s** (from 0.5–2s).
4. **Inter-entry interval is unchanged** — it keeps its 2s safety floor (4s median). The numeric `BOUNDS` in `humanize.js` are NOT touched. (User chose to keep the safety floor to limit block risk.)
5. **Micro-pauses (scroll/hover) are unchanged** — already sub-second and internal to a single entry action.

## Changes

### A. `content_scripts/humanize.js`

- Add `readingEnabled: false` to the `DEFAULTS` object.
- Change reading defaults: `readMin` 400 → **500**, `readMax` 1500 → **1000**. (`readBase` 200 and `readWpm` 1000 unchanged. Inter-entry delay values unchanged.)
- `resolveConfig`: handle `readingEnabled` specially. The numeric clamp loop only processes keys present in `BOUNDS`; after the loop set `out.readingEnabled = (raw.readingEnabled === true)` (default `false`). This keeps `resolveConfig({})` deep-equal to `DEFAULTS`.
- `readingDelayMs(textLen, cfg, rng)`: after resolving config, `if (!c.readingEnabled) return 0;` then run the existing formula. This single gate covers both call sites — no changes needed in `autoStart.js` or `offscreen.js`.

### B. `defaultSchema.json`

- Add `"readingEnabled": false` to the `humanizeConfig` seed.
- Set `"readMin": 500` (currently 400) and `"readMax": 1000` (currently 1500). All other seed values unchanged.

### C. Hardcoded arrival delay — `content_scripts/autoStart.js:172`

- `500 + Math.floor(Math.random() * 1500)` → `500 + Math.floor(Math.random() * 500)` (0.5–1s). Update the inline comment.

### D. Options UI

- `options/options.html`: add a checkbox in the Humanize section:
  `<label class="field inline"><input type="checkbox" id="hz-readingEnabled">__MSG_hzReadingEnabled__</label>`
- `options/options.js`: `readingEnabled` is boolean, so it is NOT added to the numeric `HUMANIZE_FIELDS` list. Instead:
  - `loadHumanize(stored)`: set `document.getElementById("hz-readingEnabled").checked = hz.readingEnabled;`
  - `saveHumanize()`: set `obj.readingEnabled = document.getElementById("hz-readingEnabled").checked;`
  - Add a `change` listener on `hz-readingEnabled` that calls `saveHumanize`.
- `_locales/en/messages.json` and `_locales/zh_TW/messages.json`: add `hzReadingEnabled` (en: "Simulate reading the description"; zh_TW: "保留閱讀時間（點開描述後停頓）").

### E. Tests

- `tests/humanize.test.js`:
  - `resolveConfig fills every key ... {}` deep-equals `DEFAULTS` — still passes once `DEFAULTS` includes `readingEnabled:false`.
  - Add a test: `readingDelayMs(500, {})` (default, disabled) `=== 0`.
  - Reading-clamp test: use `{ readingEnabled: true }` and assert `readingDelayMs(0,...) >= 500` and `readingDelayMs(1000000,...) <= 1000`.
  - `readingDelayMs grows with description length`: pass `{ readingEnabled: true }`; choose lengths where the shorter result does not clamp to `readMax=1000` (e.g. 50 vs 10).
  - `slower wpm yields a longer stay`: pass `{ readingEnabled: true }`; use wpm values that both stay under the new 1000 cap (e.g. 800 vs 1000 at 50 chars).
- `tests/default-schema.test.js`: add `readingEnabled: false` and set `readMin: 500, readMax: 1000` in the deep-equal.

## Net default behavior

Page loads → wait **0.5–1s** → enter giveaways with **no reading pause**, **≥2s** between entries. Flipping the new checkbox restores a **0.5–1s** reading pause.

## Out of scope

- Lowering the inter-entry `BOUNDS` floor below 2s.
- Making arrival/scroll/hover pauses user-configurable.
- Existing users keep their stored `humanizeConfig` until they use "Reset to defaults"; only fresh installs and the new boolean pick up automatically. (The `readingEnabled` field is absent from existing stored configs, so `resolveConfig` defaults it to `false` for them too.)

## Risk

Disabling the reading pause by default plus a 0.5–1s arrival makes the flow faster/more bot-like, but the inter-entry 2s floor is retained as the main anti-detection guard, per user direction.
