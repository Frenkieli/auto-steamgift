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

test('harness loads fixture and core module', () => {
  const doc = loadFixture();
  assert.strictEqual(rows(doc).length, 4);
  // Sanity placeholder that will pass once parsePointCost is implemented (Task 2)
  assert.strictEqual(GiveawayCore.parsePointCost(rows(doc)[0]), 5);
});
