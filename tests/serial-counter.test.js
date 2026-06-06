const test = require('node:test');
const assert = require('node:assert');
const { createSerialCounter, createSerialList } = require('../lib/serial-counter.js');

// A storage adapter whose get/set are async (setTimeout) so a NON-serialized
// implementation would interleave reads and lose updates.
function slowAdapter() {
  let value = 0;
  return {
    get: () => new Promise((r) => setTimeout(() => r(value), 1)),
    set: (key, v) => new Promise((r) => setTimeout(() => { value = v; r(); }, 1)),
    current: () => value,
  };
}

test('50 concurrent increments do not lose any updates', async () => {
  const adapter = slowAdapter();
  const counter = createSerialCounter(adapter);
  await Promise.all(Array.from({ length: 50 }, () => counter.increment('k', 1)));
  assert.strictEqual(adapter.current(), 50);
});

test('increment respects a custom delta', async () => {
  const adapter = slowAdapter();
  const counter = createSerialCounter(adapter);
  await counter.increment('k', 5);
  await counter.increment('k', 3);
  assert.strictEqual(adapter.current(), 8);
});

test('a failing write does not stall later increments', async () => {
  let value = 0;
  let calls = 0;
  const adapter = {
    get: () => Promise.resolve(value),
    set: (key, v) => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('boom'));
      value = v;
      return Promise.resolve();
    },
  };
  const counter = createSerialCounter(adapter);
  await counter.increment('k', 1).catch(() => {}); // first write rejects
  await counter.increment('k', 1);                 // chain still alive
  assert.strictEqual(value, 1);
});

test('createSerialList serializes pushes and applies the transform/cap', async () => {
  let value;
  const adapter = {
    get: () => new Promise((r) => setTimeout(() => r(value), 1)),
    set: (key, v) => new Promise((r) => setTimeout(() => { value = v; r(); }, 1)),
  };
  // newest-first, cap 3
  const list = createSerialList(adapter, (l, item) => [item, ...l].slice(0, 3));
  await Promise.all([1, 2, 3, 4, 5].map((n) => list.push('k', n)));
  assert.deepStrictEqual(value, [5, 4, 3]);
});
