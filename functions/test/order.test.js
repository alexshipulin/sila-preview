const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSession, OrderError, KIND, MADE_TERMS } = require('../order');
const { normalizeStock } = require('../catalog');

const ORIGIN = 'https://silabrand.store';
const NOW = new Date('2026-10-08T12:00:00Z');
const STOCK = normalizeStock({ lattice: { '8': 1 } });
const BUYER = { name: 'Anna Kowalska', whatsapp: '+48 572 387 611' };

function order(extra, stock = STOCK) {
  return buildSession({ model: 'lattice', ...BUYER, ...extra }, ORIGIN, stock, NOW);
}

function rejects(fn, status, field) {
  assert.throws(fn, (err) => err instanceof OrderError && err.status === status && err.field === field);
}

test('unknown ring, including a prototype key, is refused', () => {
  rejects(() => order({ model: 'nope', size: '8' }), 400, 'model');
  rejects(() => order({ model: '__proto__', size: '8' }), 400, 'model');
  rejects(() => order({ model: 'constructor', size: '8' }), 400, 'model');
});

test('a size the workshop does not make is refused', () => {
  rejects(() => order({ size: '13' }), 400, 'size');
  rejects(() => order({ size: '' }), 400, 'size');
});

test('on the shelf and picked as ready: sold ready to ship', () => {
  const s = order({ size: '8', expect: KIND.STOCK });
  assert.equal(s.metadata.kind, KIND.STOCK);
  assert.equal(s.line_items[0].price_data.product_data.name, 'Lattice Ring — US 8');
  assert.equal(s.custom_text, undefined);
});

test('on the shelf but picked from the made list: still ships now', () => {
  assert.equal(order({ size: '8', expect: KIND.MADE }).metadata.kind, KIND.STOCK);
});

test('gone but picked as ready: 409, never a silent switch to made to order', () => {
  rejects(() => order({ size: '7', expect: KIND.STOCK }), 409, 'size');
  rejects(() => order({ size: '7' }), 409, 'size');   // no expect means ready
});

test('gone and picked as made to order: made to order, with the terms on Stripe', () => {
  const s = order({ size: '10.5', expect: KIND.MADE });
  assert.equal(s.metadata.kind, KIND.MADE);
  assert.equal(s.line_items[0].price_data.product_data.name, 'Lattice Ring — US 10.5 · Made to order');
  assert.equal(s.custom_text.submit.message, MADE_TERMS);
  assert.match(s.payment_intent_data.description, /MADE TO ORDER/);
});

test('shelf unknown: made to order still sells, ready to ship is a 503', () => {
  rejects(() => order({ size: '8', expect: KIND.STOCK }, null), 503, 'size');
  assert.equal(order({ size: '8', expect: KIND.MADE }, null).metadata.kind, KIND.MADE);
});

test('the order number comes from the server, not the page', () => {
  const s = order({ size: '8', orderId: 'SILA-FAKE' });
  assert.notEqual(s.client_reference_id, 'SILA-FAKE');
  assert.match(s.client_reference_id, /^SILA-20261008-[A-Z2-9]{6}$/);
  assert.equal(s.metadata.order_id, s.client_reference_id);
});

test('the payment page closes after 31 minutes', () => {
  assert.equal(order({ size: '8' }).expires_at, NOW.getTime() / 1000 + 31 * 60);
});

test('return addresses carry what the thank-you page needs and nothing personal', () => {
  const s = order({ size: '10.5', expect: KIND.MADE });
  const url = new URL(s.success_url);
  assert.equal(url.searchParams.get('kind'), KIND.MADE);
  assert.equal(url.searchParams.get('ring'), 'lattice');
  assert.equal(url.searchParams.get('size'), '10.5');
  assert.ok(!s.success_url.includes('Anna') && !s.success_url.includes('572'));
  assert.equal(s.cancel_url, `${ORIGIN}/?ring=lattice&checkout=cancelled`);
});

test('name and WhatsApp are required; the + of a phone survives', () => {
  rejects(() => order({ size: '8', name: '   ' }), 400, 'name');
  rejects(() => order({ size: '8', whatsapp: '12345' }), 400, 'whatsapp');
  const s = order({ size: '8', name: '  Anna   Kowalska ', comment: '  gift  wrap ' });
  assert.equal(s.metadata.name, 'Anna Kowalska');
  assert.equal(s.metadata.whatsapp, '+48 572 387 611');
  assert.equal(s.metadata.comment, 'gift wrap');
});
