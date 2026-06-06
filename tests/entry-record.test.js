const test = require('node:test');
const assert = require('node:assert');
const { pushRecentEntry, successRate } = require('../content_scripts/entryRecord.js');

test('pushRecentEntry puts the newest entry first', () => {
  const list = [{ name: 'A' }];
  assert.deepStrictEqual(pushRecentEntry(list, { name: 'B' }), [{ name: 'B' }, { name: 'A' }]);
});

test('pushRecentEntry caps the list at max (default 20)', () => {
  let list = [];
  for (let i = 0; i < 25; i++) list = pushRecentEntry(list, { name: String(i) });
  assert.strictEqual(list.length, 20);
  assert.strictEqual(list[0].name, '24'); // newest
  assert.strictEqual(list[19].name, '5'); // oldest kept
});

test('pushRecentEntry tolerates a non-array starting value', () => {
  assert.deepStrictEqual(pushRecentEntry(undefined, { name: 'X' }), [{ name: 'X' }]);
});

test('successRate returns an integer percent', () => {
  assert.strictEqual(successRate(9, 10), 90);
  assert.strictEqual(successRate(1, 3), 33);
});

test('successRate returns null when there are no attempts', () => {
  assert.strictEqual(successRate(0, 0), null);
  assert.strictEqual(successRate(5, undefined), null);
});
