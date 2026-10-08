const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CATALOG, SIZES, normalizeStock, publicCatalog } = require('../catalog');

test('every ring gets every size, and only whole positive counts survive', () => {
  const stock = normalizeStock({
    lattice: { '6': 2, '7': true, '8': false, '9': '3', '10': -1, '11': 1, '10.5': 1, '13': 4 },
  });
  assert.deepEqual(Object.keys(stock).sort(), Object.keys(CATALOG).sort());
  for (const ring of Object.values(stock)) assert.deepEqual(Object.keys(ring).sort(), [...SIZES].sort());
  assert.equal(stock.lattice['6'], 2);
  assert.equal(stock.lattice['7'], 0, 'old yes/no format must not read as stock');
  assert.equal(stock.lattice['9'], 0, 'a string is not a count');
  assert.equal(stock.lattice['10'], 0);
  assert.equal(stock.lattice['11'], 1);
  assert.equal(stock.lattice['13'], undefined, 'a size we do not make is dropped');
  assert.equal(stock.lattice['10.5'], undefined, 'half sizes are not made');
  assert.equal(stock.signet['8'], 0, 'a missing ring is an empty shelf');
});

test('the public catalogue says which sizes are in, never how many', () => {
  const rings = publicCatalog(normalizeStock({ lattice: { '6': 3, '8': 1, '11': 2 } }));
  const lattice = rings.lattice;
  assert.deepEqual(lattice.row, ['6', '7', '8', '9', '10', '11'], 'fixed row plus the rare size that is in');
  assert.deepEqual(lattice.ready, ['6', '8', '11']);
  assert.equal(lattice.made.length, SIZES.length - 3);
  assert.ok(!lattice.made.includes('8') && lattice.made.includes('7'));
  assert.ok(!JSON.stringify(rings).includes('"3"') && !/:\s*3[,}]/.test(JSON.stringify(rings)),
    'no stock count appears in what the page receives');
  assert.deepEqual(rings.signet.row, ['6', '7', '8', '9', '10'], 'an empty shelf still shows the fixed row');
  assert.equal(rings.signet.made.length, SIZES.length);
});

test('the prices the page shows are the prices Stripe charges', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', '..', 'script.js'), 'utf8');
  for (const [key, ring] of Object.entries(CATALOG)) {
    const block = script.match(new RegExp(`^\\s+${key}: \\{[\\s\\S]*?price: '\\$(\\d+)'`, 'm'));
    assert.ok(block, `no price for ${key} in script.js`);
    assert.equal(Number(block[1]) * 100, ring.amount, `${key}: page and checkout disagree`);
  }
});
