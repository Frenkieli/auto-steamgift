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
