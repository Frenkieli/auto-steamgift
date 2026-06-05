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
