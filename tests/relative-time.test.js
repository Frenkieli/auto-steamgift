const test = require('node:test');
const assert = require('node:assert');
const { relativeUpdatedText } = require('../content_scripts/relativeTime.js');

// Fake i18n: returns "key" or "key:N" so tests assert on the chosen branch + number.
const t = (key, n) => (n === undefined ? key : `${key}:${n}`);
const NOW = 1_000_000_000_000;

test('returns the "never" string when updatedAt is missing/0', () => {
  assert.strictEqual(relativeUpdatedText(0, NOW, t), 'pointUpdatedNever');
  assert.strictEqual(relativeUpdatedText(undefined, NOW, t), 'pointUpdatedNever');
});

test('under 60 seconds is "just now"', () => {
  assert.strictEqual(relativeUpdatedText(NOW - 30 * 1000, NOW, t), 'pointUpdatedJustNow');
});

test('minutes branch reports whole minutes', () => {
  assert.strictEqual(relativeUpdatedText(NOW - 5 * 60 * 1000, NOW, t), 'pointUpdatedMinutes:5');
});

test('hours branch reports whole hours', () => {
  assert.strictEqual(relativeUpdatedText(NOW - 3 * 60 * 60 * 1000, NOW, t), 'pointUpdatedHours:3');
});

test('days branch reports whole days', () => {
  assert.strictEqual(relativeUpdatedText(NOW - 2 * 24 * 60 * 60 * 1000, NOW, t), 'pointUpdatedDays:2');
});

test('a future-ish/zero diff still reads as just now, not negative', () => {
  assert.strictEqual(relativeUpdatedText(NOW, NOW, t), 'pointUpdatedJustNow');
});
