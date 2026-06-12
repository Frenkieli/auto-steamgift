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

const CONFIG = {
  restricted: { trigger: true, value: 100 },
  whitelist: { trigger: false, value: 50 },
  group: { trigger: false, value: 50 },
  level: { trigger: true, value: 20 },
  cost: { trigger: true, value: 1 },
};

test('calculateWeight: region-restricted + copies row (Row D)', () => {
  const r = rows(loadFixture());
  // region-restricted present -> 100; no level column -> 0; cost 2 -> 2*0.1*1 = 0.2
  assert.strictEqual(GiveawayCore.calculateWeight(r[3], CONFIG), 100.2);
});

test('calculateWeight: level + cost row, no region (Row A)', () => {
  const r = rows(loadFixture());
  // no region -> 0; level "Level 1+" -> 1*20 = 20; cost 5 -> 5*0.1*1 = 0.5
  assert.strictEqual(GiveawayCore.calculateWeight(r[0], CONFIG), 20.5);
});

test('calculateWeight: a disabled trigger contributes nothing', () => {
  const r = rows(loadFixture());
  const cfg = { ...CONFIG, restricted: { trigger: false, value: 100 } };
  // Row D with restricted disabled -> only cost 0.2
  assert.strictEqual(GiveawayCore.calculateWeight(r[3], cfg), 0.2);
});

test('getContributorLevel reads the contributor level number', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.getContributorLevel(r[0]), 1);  // Row A "Level 1+"
});

test('getContributorLevel returns 0 when no level column exists', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.getContributorLevel(r[3]), 0);  // Row D has no level column
});

test('getContributorLevel handles multi-digit levels', () => {
  const dom = new (require('jsdom').JSDOM)(
    '<div class="giveaway__row-inner-wrap"><div class="giveaway__column--contributor-level">Level 10+</div></div>'
  );
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(GiveawayCore.getContributorLevel(row), 10);
});

test('passesMinimum passes when no constraints are set', () => {
  const r = rows(loadFixture());
  assert.strictEqual(
    GiveawayCore.passesMinimum(r[0], { minScore: 0, minLevel: 0, requiredTypes: {} }),
    true
  );
});

test('passesMinimum fails when score is below minScore', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.passesMinimum(r[0], { minScore: 150 }), false);  // Row A score 120
});

test('passesMinimum fails when level is below minLevel', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.passesMinimum(r[0], { minLevel: 2 }), false);  // Row A level 1
});

test('passesMinimum (mode any) matches a region-restricted row', () => {
  const r = rows(loadFixture());
  assert.strictEqual(
    GiveawayCore.passesMinimum(r[3], { requiredTypes: { restricted: true, mode: 'any' } }),
    true   // Row D is region-restricted
  );
  assert.strictEqual(
    GiveawayCore.passesMinimum(r[0], { requiredTypes: { restricted: true, mode: 'any' } }),
    false  // Row A is not region-restricted
  );
});

test('passesMinimum (mode all) requires every checked type', () => {
  const dom = new (require('jsdom').JSDOM)(
    '<div class="giveaway__row-inner-wrap">' +
    '<div class="giveaway__column--region-restricted"></div>' +
    '<div class="giveaway__column--whitelist"></div></div>'
  );
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(
    GiveawayCore.passesMinimum(row, { requiredTypes: { restricted: true, whitelist: true, mode: 'all' } }),
    true
  );
  assert.strictEqual(
    GiveawayCore.passesMinimum(row, { requiredTypes: { restricted: true, whitelist: true, group: true, mode: 'all' } }),
    false  // no group column
  );
});

test('isDescriptionGated is true for a locked row that has a description button', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isDescriptionGated(r[4]), true);   // Row E
});

test('isDescriptionGated is false for an unlocked row', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isDescriptionGated(r[0]), false);  // Row A (not locked)
});

test('isDescriptionGated is false for a locked row with no description button', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isDescriptionGated(r[1]), false);  // Row B (locked, no description)
});

test('isEnterable is true for a description-gated locked row', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.isEnterable(r[4]), true);          // Row E
});

test('getQuickEntryError returns the error text when the error div is present', () => {
  const dom = new (require('jsdom').JSDOM)(
    '<div class="giveaway__row-inner-wrap"><div class="giveaway__quick-entry-wrap">' +
    '<div class="giveaway__quick-entry-error"><i class="fa fa-exclamation-circle"></i><span>Previously Won</span></div>' +
    '</div></div>'
  );
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(GiveawayCore.getQuickEntryError(row), 'Previously Won');
});

test('getQuickEntryError returns null when no error div exists', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.getQuickEntryError(r[0]), null); // Row A: normal enterable row
});

test('getGameId reads data-game-id from the outer row wrap', () => {
  const r = rows(loadFixture());
  assert.strictEqual(GiveawayCore.getGameId(r[0]), '111');  // Row A
  assert.strictEqual(GiveawayCore.getGameId(r[3]), '444');  // Row D
});

test('getGameId returns null when there is no outer wrap', () => {
  const dom = new (require('jsdom').JSDOM)('<div class="giveaway__row-inner-wrap"></div>');
  const row = dom.window.document.querySelector('.giveaway__row-inner-wrap');
  assert.strictEqual(GiveawayCore.getGameId(row), null);
});
