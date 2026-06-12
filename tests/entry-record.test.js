const test = require('node:test');
const assert = require('node:assert');
const { pushRecentEntry, successRate, pushWonEntry } = require('../content_scripts/entryRecord.js');

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

test('pushWonEntry puts the newest entry first', () => {
  const list = [{ code: 'aaa', name: 'A' }];
  assert.deepStrictEqual(
    pushWonEntry(list, { code: 'bbb', name: 'B' }),
    [{ code: 'bbb', name: 'B' }, { code: 'aaa', name: 'A' }]
  );
});

test('pushWonEntry ignores a duplicate code and returns the list unchanged', () => {
  const list = [{ code: 'aaa', name: 'A' }];
  assert.deepStrictEqual(pushWonEntry(list, { code: 'aaa', name: 'A again' }), [{ code: 'aaa', name: 'A' }]);
});

test('pushWonEntry tolerates a non-array starting value', () => {
  assert.deepStrictEqual(pushWonEntry(undefined, { code: 'xxx' }), [{ code: 'xxx' }]);
});

test('pushWonEntry ignores a second giveaway of the same game (same gameId, different code)', () => {
  const list = [{ gameId: '11023', code: 'aaa', name: 'Game' }];
  assert.deepStrictEqual(
    pushWonEntry(list, { gameId: '11023', code: 'bbb', name: 'Game' }),
    [{ gameId: '11023', code: 'aaa', name: 'Game' }]
  );
});

test('pushWonEntry keeps entries for different games', () => {
  const list = [{ gameId: '111', code: 'aaa', name: 'A' }];
  assert.deepStrictEqual(
    pushWonEntry(list, { gameId: '222', code: 'bbb', name: 'B' }),
    [{ gameId: '222', code: 'bbb', name: 'B' }, { gameId: '111', code: 'aaa', name: 'A' }]
  );
});

test('pushWonEntry still dedups by code when gameId is missing', () => {
  const list = [{ code: 'aaa', name: 'A' }];
  assert.deepStrictEqual(pushWonEntry(list, { gameId: '111', code: 'aaa', name: 'A' }), [{ code: 'aaa', name: 'A' }]);
});
