/**
 * The owner's side: the shelf and the made-to-order queue.
 *
 * Every write goes through the server, which checks the caller's Google
 * account itself; the page's own checks are only convenience. Stock changes
 * are sent as +1 / −1, never as a final number: a screen opened a minute ago
 * would otherwise overwrite a sale that happened in that minute.
 */
const { SIZES, STOCK_DOC, isRing, normalizeStock } = require('./catalog');
const { KIND, LEAD_DAYS } = require('./order');

const DAY = 86400;
const QUEUE_DAYS = 180;

function isOwner(auth, ownerEmail) {
  const token = auth && auth.token;
  return !!token
    && token.email_verified === true
    && typeof token.email === 'string'
    && token.email.toLowerCase() === ownerEmail.trim().toLowerCase();
}

function isAdjustment(input) {
  return !!input && isRing(input.model) && SIZES.includes(input.size) && (input.delta === 1 || input.delta === -1);
}

/** Applies ±1 inside a transaction, so it queues behind a sale rather than racing it. */
async function adjustStock(db, { model, size, delta }) {
  const ref = db.doc(STOCK_DOC);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stock = normalizeStock(snap.exists ? snap.data() : {});
    stock[model] = { ...stock[model], [size]: Math.max(0, stock[model][size] + delta) };
    tx.set(ref, stock);
    return stock;
  });
}

function queueRow(pi) {
  const m = pi.metadata || {};
  const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  return {
    id: pi.id,
    orderId: m.order_id || '',
    model: m.model || '',
    size: m.size_us || '',
    name: m.name || '',
    whatsapp: m.whatsapp || '',
    comment: m.comment || '',
    paidAt: pi.created,
    dueAt: pi.created + LEAD_DAYS * DAY,
    converted: m.converted === '1',
    doneAt: m.done_at || '',
    refunded: !!(charge && charge.refunded),
  };
}

/** Paid made-to-order payments from the last half year, soonest due first. */
async function listQueue(stripe, nowSeconds) {
  const rows = [];
  const pages = stripe.paymentIntents.list({
    created: { gte: nowSeconds - QUEUE_DAYS * DAY },
    limit: 100,
    expand: ['data.latest_charge'],
  });
  for await (const pi of pages) {
    if (pi.status === 'succeeded' && (pi.metadata || {}).kind === KIND.MADE) rows.push(queueRow(pi));
  }
  return rows.sort((a, b) => a.dueAt - b.dueAt);
}

/** Ticks a made-to-order payment as made and sent, or un-ticks it. */
async function markDone(stripe, id, done, now) {
  const pi = await stripe.paymentIntents.retrieve(id);
  if ((pi.metadata || {}).kind !== KIND.MADE) return false;
  // an empty string is how Stripe removes a metadata key
  await stripe.paymentIntents.update(id, { metadata: { done_at: done ? now.toISOString() : '' } });
  return true;
}

module.exports = { isOwner, isAdjustment, adjustStock, queueRow, listQueue, markDone };
