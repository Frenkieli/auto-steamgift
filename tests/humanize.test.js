const test = require('node:test');
const assert = require('node:assert');
const Humanize = require('../content_scripts/humanize.js');

// rng that returns a fixed sequence (cycles), for deterministic assertions
const seqRng = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

// ---- resolveConfig: clamping + defaults ----

test('resolveConfig fills every key with its default when given {}', () => {
  const c = Humanize.resolveConfig({});
  assert.deepStrictEqual(c, Humanize.DEFAULTS);
});

test('resolveConfig clamps below-range values up to the lower bound', () => {
  assert.strictEqual(Humanize.resolveConfig({ delayMin: 0 }).delayMin, 2000);
  assert.strictEqual(Humanize.resolveConfig({ earlyStopProb: -1 }).earlyStopProb, 0);
});

test('resolveConfig clamps above-range values down to the upper bound', () => {
  assert.strictEqual(Humanize.resolveConfig({ breakProb: 5 }).breakProb, 1);
  assert.strictEqual(Humanize.resolveConfig({ readWpm: 99999 }).readWpm, 1000);
});

test('resolveConfig falls back to default for non-numeric/missing values', () => {
  assert.strictEqual(Humanize.resolveConfig({ readWpm: 'abc' }).readWpm, 300);
  assert.strictEqual(Humanize.resolveConfig({ delayMedian: null }).delayMedian, 13000);
});

test('resolveConfig normalizes inverted min/max pairs (max >= min)', () => {
  assert.strictEqual(Humanize.resolveConfig({ capMin: 60, capMax: 50 }).capMax, 60);
  assert.strictEqual(Humanize.resolveConfig({ delayMin: 50000, delayMax: 10000 }).delayMax, 50000);
});

// ---- humanDelayMs ----

test('humanDelayMs hits the median when the gaussian is 0 (default cfg)', () => {
  // Box-Muller with u1=0.5, u2=0.25 -> 0 -> exp(ln(median)) = median
  assert.strictEqual(Humanize.humanDelayMs({}, seqRng([0.5, 0.25])), 13000);
});

test('humanDelayMs respects a custom median', () => {
  assert.strictEqual(Humanize.humanDelayMs({ delayMedian: 30000 }, seqRng([0.5, 0.25])), 30000);
});

test('humanDelayMs always stays within default [6000, 240000]', () => {
  for (let i = 0; i < 2000; i++) {
    const d = Humanize.humanDelayMs();
    assert.ok(d >= 6000 && d <= 240000, `out of range: ${d}`);
  }
});

// ---- readingDelayMs ----

test('readingDelayMs grows with description length', () => {
  const r = () => 0.5;
  assert.ok(Humanize.readingDelayMs(1000, {}, r) > Humanize.readingDelayMs(100, {}, r));
});

test('readingDelayMs is clamped to default [1500, 15000]', () => {
  assert.ok(Humanize.readingDelayMs(0, {}, () => 0.5) >= 1500);
  assert.ok(Humanize.readingDelayMs(1000000, {}, () => 0.5) <= 15000);
});

test('readingDelayMs slower wpm yields a longer stay', () => {
  // Use a short description so neither result clamps to readMax (15000):
  // 150 chars = 30 words -> 150wpm ~13200ms, 600wpm ~4200ms.
  const r = () => 0.5;
  assert.ok(Humanize.readingDelayMs(150, { readWpm: 150 }, r) > Humanize.readingDelayMs(150, { readWpm: 600 }, r));
});

// ---- maybeBreakMs ----

test('maybeBreakMs returns 0 when the draw is above the break probability', () => {
  assert.strictEqual(Humanize.maybeBreakMs({}, () => 0.9), 0);
});

test('maybeBreakMs returns a bounded long break when triggered (default)', () => {
  const b = Humanize.maybeBreakMs({}, seqRng([0.1, 0.5]));
  assert.ok(b >= 60000 && b <= 300000, `out of range: ${b}`);
});

test('maybeBreakMs with breakProb 0 never breaks', () => {
  assert.strictEqual(Humanize.maybeBreakMs({ breakProb: 0 }, () => 0), 0);
});

test('maybeBreakMs honors custom break bounds', () => {
  const b = Humanize.maybeBreakMs({ breakProb: 1, breakMin: 1000, breakMax: 1000 }, seqRng([0.0, 0.5]));
  assert.strictEqual(b, 1000);
});

// ---- inActiveHours (unchanged) ----

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

// ---- pickDailyCap ----

test('pickDailyCap stays within default [50,58] and hits both ends', () => {
  for (let i = 0; i < 1000; i++) {
    const c = Humanize.pickDailyCap();
    assert.ok(c >= 50 && c <= 58 && Number.isInteger(c), `bad cap: ${c}`);
  }
  assert.strictEqual(Humanize.pickDailyCap({}, () => 0), 50);
  assert.strictEqual(Humanize.pickDailyCap({}, () => 0.999), 58);
});

test('pickDailyCap honors a custom range', () => {
  assert.strictEqual(Humanize.pickDailyCap({ capMin: 10, capMax: 10 }, () => 0), 10);
  assert.strictEqual(Humanize.pickDailyCap({ capMin: 20, capMax: 30 }, () => 0.999), 30);
});

// ---- shouldEarlyStop ----

test('shouldEarlyStop fires below the probability and not above (default 0.10)', () => {
  assert.strictEqual(Humanize.shouldEarlyStop({}, () => 0.05), true);
  assert.strictEqual(Humanize.shouldEarlyStop({}, () => 0.5), false);
});

test('shouldEarlyStop honors a custom probability', () => {
  assert.strictEqual(Humanize.shouldEarlyStop({ earlyStopProb: 0 }, () => 0), false);
  assert.strictEqual(Humanize.shouldEarlyStop({ earlyStopProb: 1 }, () => 0.99), true);
});
