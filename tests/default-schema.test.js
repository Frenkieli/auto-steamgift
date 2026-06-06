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

test('defaultSchema seeds totalAttempts at 0', () => {
  assert.strictEqual(schema.totalAttempts, 0);
});

test('defaultSchema seeds humanizeConfig with canonical defaults', () => {
  assert.deepStrictEqual(schema.humanizeConfig, {
    delayMedian: 4000, delaySigma: 0.6, delayMin: 2000, delayMax: 30000,
    readWpm: 1000, readBase: 200, readMin: 500, readMax: 1000,
    breakProb: 0.15, breakMin: 60000, breakMax: 300000,
    earlyStopProb: 0.1,
    capMin: 50, capMax: 58,
    readingEnabled: false
  });
});
