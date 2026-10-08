const test = require('node:test');
const assert = require('node:assert/strict');

const { orderMessage, sendTelegram, dueDate, money } = require('../telegram');
const { isOwner, isAdjustment, adjustStock, queueRow, listQueue, markDone } = require('../admin');
const { STOCK_DOC } = require('../catalog');
const { KIND } = require('../order');
const { fakeDb } = require('./fake-db');

const META = {
  order_id: 'SILA-20261008-K7F3Q2', model: 'Lattice Ring', size_us: '7',
  name: 'Anna_Maria <3', whatsapp: '+48 572 387 611', comment: 'gift *wrap*',
};

test('the message carries the order verbatim, special characters included', () => {
  const text = orderMessage(META, 'decremented', 19900, 1791460800);
  assert.match(text, /SILA-20261008-K7F3Q2/);
  assert.match(text, /Lattice Ring · US 7/);
  assert.match(text, /Из наличия/);
  assert.ok(text.includes('Anna_Maria <3') && text.includes('gift *wrap*'));
  assert.match(text, /\$199$/);
  assert.match(orderMessage(META, 'converted', 19900, 1791460800), /⚠️/);
});

test('the due date is counted on Bali time', () => {
  // 16:30 UTC on 8 Oct is already 00:30 on 9 Oct in Bali; plus 15 days is 24 Oct
  assert.equal(dueDate(Date.UTC(2026, 9, 8, 16, 30) / 1000), '24 окт.');
  assert.equal(dueDate(Date.UTC(2026, 9, 8, 10, 0) / 1000), '23 окт.');
  assert.equal(money(19900), '$199');
  assert.equal(money(19950), '$199.50');
});

test('Telegram: delivered, refused for good, or worth a retry', async () => {
  const answer = (status) => async () => ({ ok: status === 200, status });
  assert.equal(await sendTelegram('t', 'c', 'x', answer(200)), true);
  assert.equal(await sendTelegram('t', 'c', 'x', answer(400)), 'failed');
  assert.equal(await sendTelegram('t', 'c', 'x', answer(403)), 'failed');
  await assert.rejects(sendTelegram('t', 'c', 'x', answer(429)), /429/);
  await assert.rejects(sendTelegram('t', 'c', 'x', answer(502)), /502/);
  await assert.rejects(sendTelegram('t', 'c', 'x', async () => { throw new TypeError('fetch failed'); }), /fetch failed/);

  let body;
  await sendTelegram('t', '42', 'a_b *c*', async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200 }; });
  assert.equal(body.parse_mode, undefined, 'plain text: markup in a comment cannot break delivery');
  assert.equal(body.text, 'a_b *c*');
});

test('only the owner’s verified Google account gets in', () => {
  const as = (email, verified = true) => ({ token: { email, email_verified: verified } });
  assert.equal(isOwner(as('Owner@Example.com'), 'owner@example.com '), true);
  assert.equal(isOwner(as('owner@example.com', false), 'owner@example.com'), false);
  assert.equal(isOwner(as('someone@example.com'), 'owner@example.com'), false);
  assert.equal(isOwner(null, 'owner@example.com'), false);
  assert.equal(isOwner({}, 'owner@example.com'), false);
});

test('stock steps are ±1 on a real ring and size, and never go below zero', async () => {
  assert.equal(isAdjustment({ model: 'lattice', size: '10.5', delta: 1 }), true);
  for (const bad of [{ model: 'x', size: '8', delta: 1 }, { model: 'lattice', size: '13', delta: 1 },
    { model: 'lattice', size: '8', delta: 2 }, { model: 'lattice', size: '8', delta: '1' }, null]) {
    assert.equal(isAdjustment(bad), false, JSON.stringify(bad));
  }
  const db = fakeDb({ [STOCK_DOC]: { lattice: { '8': 1 } } });
  await adjustStock(db, { model: 'lattice', size: '8', delta: -1 });
  await adjustStock(db, { model: 'lattice', size: '8', delta: -1 });
  assert.equal(db.docs.get(STOCK_DOC).lattice['8'], 0);
  await adjustStock(db, { model: 'lattice', size: '11.5', delta: 1 });
  assert.equal(db.docs.get(STOCK_DOC).lattice['11.5'], 1);
});

test('the queue lists paid made-to-order rings, soonest due first, refunds marked', async () => {
  const pi = (id, created, kind, status = 'succeeded', refunded = false) => ({
    id, created, status, latest_charge: { refunded },
    metadata: { kind, order_id: id, model: 'Signet Ring', size_us: '9', name: 'K', whatsapp: '1' },
  });
  const all = [pi('pi_late', 2000, KIND.MADE), pi('pi_stock', 1000, KIND.STOCK),
    pi('pi_soon', 1000, KIND.MADE, 'succeeded', true), pi('pi_unpaid', 500, KIND.MADE, 'requires_payment_method')];
  const stripe = { paymentIntents: { list: () => ({ async *[Symbol.asyncIterator]() { yield* all; } }) } };
  const rows = await listQueue(stripe, 3000);
  assert.deepEqual(rows.map((r) => r.id), ['pi_soon', 'pi_late']);
  assert.equal(rows[0].refunded, true);
  assert.equal(rows[0].dueAt, 1000 + 15 * 86400);
  assert.equal(queueRow(pi('pi_x', 1, KIND.MADE)).doneAt, '');
});

test('marking done touches made-to-order payments only', async () => {
  const updates = [];
  const stripe = (kind) => ({ paymentIntents: {
    retrieve: async () => ({ metadata: { kind } }),
    update: async (id, body) => { updates.push(body); },
  } });
  const now = new Date('2026-10-20T08:00:00Z');
  assert.equal(await markDone(stripe(KIND.STOCK), 'pi_1', true, now), false);
  assert.equal(await markDone(stripe(KIND.MADE), 'pi_2', true, now), true);
  assert.equal(await markDone(stripe(KIND.MADE), 'pi_2', false, now), true);
  assert.deepEqual(updates, [{ metadata: { done_at: now.toISOString() } }, { metadata: { done_at: '' } }]);
});
