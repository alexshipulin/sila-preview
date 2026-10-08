const test = require('node:test');
const assert = require('node:assert/strict');

const { applyPaid, handlePaid, isPaidEvent } = require('../webhook');
const { normalizeStock, STOCK_DOC } = require('../catalog');
const { KIND } = require('../order');
const { fakeDb } = require('./fake-db');

const NOW = new Date('2026-10-08T12:00:00Z');

function session(id, kind, size = '8') {
  return {
    id,
    object: 'checkout.session',
    payment_intent: `pi_${id}`,
    amount_total: 19900,
    created: NOW.getTime() / 1000,
    metadata: {
      order_id: `SILA-20261008-${id.toUpperCase()}`,
      model: 'Lattice Ring', model_key: 'lattice', size_us: size, kind,
      name: 'Anna', whatsapp: '+48 572 387 611',
    },
  };
}

function deps(db, overrides = {}) {
  const sent = [];
  const updates = [];
  return {
    sent,
    updates,
    db,
    stripe: { paymentIntents: { update: async (id, body) => { updates.push([id, body]); } } },
    notify: async (text) => { sent.push(text); return true; },
    now: NOW,
    ...overrides,
  };
}

test('applyPaid: one off the shelf, a converted last-piece, or untouched for made to order', () => {
  const stock = normalizeStock({ lattice: { '8': 2 } });
  const meta = { model_key: 'lattice', size_us: '8', kind: KIND.STOCK };
  const a = applyPaid(stock, meta);
  assert.equal(a.outcome, 'decremented');
  assert.equal(a.stock.lattice['8'], 1);
  assert.equal(stock.lattice['8'], 2, 'the input is not mutated');
  assert.equal(applyPaid(normalizeStock({}), meta).outcome, 'converted');
  assert.equal(applyPaid(stock, { ...meta, kind: KIND.MADE }).outcome, 'made');
});

test('a redelivered event takes nothing more off the shelf and sends no second message', async () => {
  const db = fakeDb({ [STOCK_DOC]: { lattice: { '8': 2 } } });
  const d = deps(db);
  const s = session('a1', KIND.STOCK);
  assert.equal(await handlePaid(s, d), 'decremented');
  assert.equal(await handlePaid(s, d), 'decremented');
  assert.equal(db.docs.get(STOCK_DOC).lattice['8'], 1);
  assert.equal(d.sent.length, 1);
});

test('two buyers of the last ring: the second becomes made to order and the owner is warned', async () => {
  const db = fakeDb({ [STOCK_DOC]: { lattice: { '8': 1 } } });
  const d = deps(db);
  assert.equal(await handlePaid(session('b1', KIND.STOCK), d), 'decremented');
  assert.equal(await handlePaid(session('b2', KIND.STOCK), d), 'converted');
  assert.equal(db.docs.get(STOCK_DOC).lattice['8'], 0, 'never below zero');
  assert.equal(d.updates.length, 1);
  assert.equal(d.updates[0][0], 'pi_b2');
  assert.equal(d.updates[0][1].metadata.kind, KIND.MADE);
  assert.match(d.sent[1], /⚠️/);
  assert.equal(db.docs.get('processed/b2').relabelled, true);
});

test('made to order leaves the shelf alone', async () => {
  const db = fakeDb({ [STOCK_DOC]: { lattice: { '8': 1 } } });
  const d = deps(db);
  assert.equal(await handlePaid(session('c1', KIND.MADE, '10.5'), d), 'made');
  assert.equal(db.docs.get(STOCK_DOC).lattice['8'], 1);
  assert.match(d.sent[0], /Под заказ/);
});

test('a Telegram outage fails the call for a retry, and the retry does not count the sale again', async () => {
  const db = fakeDb({ [STOCK_DOC]: { lattice: { '8': 3 } } });
  const down = deps(db, { notify: async () => { throw new Error('Telegram answered 502'); } });
  await assert.rejects(handlePaid(session('d1', KIND.STOCK), down), /502/);
  assert.equal(db.docs.get(STOCK_DOC).lattice['8'], 2);
  assert.equal(db.docs.get('processed/d1').notified, false);

  const up = deps(db);
  await handlePaid(session('d1', KIND.STOCK), up);
  assert.equal(db.docs.get(STOCK_DOC).lattice['8'], 2, 'still only one taken off');
  assert.equal(up.sent.length, 1);
  assert.equal(db.docs.get('processed/d1').notified, true);
});

test('Telegram refusing for good is recorded and not retried', async () => {
  const db = fakeDb({ [STOCK_DOC]: { lattice: { '8': 1 } } });
  const refused = deps(db, { notify: async () => 'failed' });
  await handlePaid(session('e1', KIND.STOCK), refused);
  const again = deps(db);
  await handlePaid(session('e1', KIND.STOCK), again);
  assert.equal(db.docs.get('processed/e1').notified, 'failed');
  assert.equal(again.sent.length, 0);
});

test('only events that mean money arrived are acted on', () => {
  const paid = { object: 'checkout.session', payment_status: 'paid' };
  assert.equal(isPaidEvent({ type: 'checkout.session.completed', data: { object: paid } }), true);
  assert.equal(isPaidEvent({ type: 'checkout.session.completed',
    data: { object: { ...paid, payment_status: 'unpaid' } } }), false);
  assert.equal(isPaidEvent({ type: 'checkout.session.async_payment_succeeded', data: { object: paid } }), true);
  assert.equal(isPaidEvent({ type: 'checkout.session.expired', data: { object: paid } }), false);
  assert.equal(isPaidEvent({ type: 'payment_intent.succeeded', data: { object: { object: 'payment_intent' } } }), false);
});
