const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const GiveawayCore = require('../content_scripts/giveaway-core.js');

function loadFixture() {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'list-page.html'), 'utf8');
  const dom = new JSDOM(html);
  return dom.window.document;
}

// Helper: return the row inner-wrap elements in fixture order [A, B, C, D]
function rows(doc) {
  return [...doc.querySelectorAll('.giveaway__row-inner-wrap')];
}

test('parsePointCost reads a simple cost', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.parsePointCost(r[0]), 5);  // Row A "(5P)"
});

test('parsePointCost ignores a "(NN Copies)" span and reads the point span', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.parsePointCost(r[3]), 2);  // Row D "(100 Copies)(2P)"
});

test('parsePointCost returns null when no point span exists', () => {
  const dom = new (require('jsdom').JSDOM)('<div class="giveaway__row-inner-wrap"><h2 class="giveaway__heading"></h2></div>');
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(GiveawayCore.parsePointCost(row), null);
});

test('extractCode reads the code from the quick-entry form input', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.extractCode(r[0]), 'aaaaa');
});

test('extractCode falls back to the heading href when no form input exists', () => {
  const dom = new (require('jsdom').JSDOM)(
    '<div class="giveaway__row-inner-wrap"><a class="giveaway__heading__name" href="https://www.steamgifts.com/giveaway/zzzzz/game-z">Z</a></div>'
  );
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(GiveawayCore.extractCode(row), 'zzzzz');
});

test('isEnterable is true for a fresh, unlocked row', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isEnterable(r[0]), true);   // Row A
});

test('isEnterable is false when the insert button is locked', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isEnterable(r[1]), false);  // Row B is-locked
});

test('isEnterable is false when the row is already faded (entered)', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isEnterable(r[2]), false);  // Row C is-faded
});

test('isEnterable is false when there is no insert button', () => {
  const dom = new (require('jsdom').JSDOM)('<div class="giveaway__row-inner-wrap"></div>');
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(GiveawayCore.isEnterable(row), false);
});

test('getScore reads the injected auto_steam-score value', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.getScore(r[0]), 120);  // Row A
  assert.strictEqual(GiveawayCore.getScore(r[3]), 50);   // Row D
});

test('getScore returns 0 when no score span is present', () => {
  const dom = new (require('jsdom').JSDOM)('<div class="giveaway__row-inner-wrap"></div>');
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(GiveawayCore.getScore(row), 0);
});
