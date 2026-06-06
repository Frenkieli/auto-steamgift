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
