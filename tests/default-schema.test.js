const test = require('node:test');
const assert = require('node:assert');
const schema = require('../defaultSchema.json');

test('defaultSchema has new minimum/behaviour keys with correct defaults', () => {
  assert.strictEqual(schema.minScore, 0);
  assert.strictEqual(schema.minLevel, 0);
  assert.deepStrictEqual(schema.requiredTypes, {
    restricted: false, whitelist: false, group: false, mode: 'any'
  });
  assert.strictEqual(schema.pointFloor, 0);
  assert.strictEqual(schema.goLinkTarget, 'wishlist');
  assert.strictEqual(schema.fullAutoWarned, false);
});
