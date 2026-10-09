/**
 * The owner's side: the shelf and the made-to-order queue.
 *
 * Every write goes through the server, which checks the caller's Google
 * account itself; the page's own checks are only convenience. Stock changes
 * are sent as differences, never as final numbers: a screen opened a minute ago
 * would otherwise overwrite a sale that happened in that minute.
 */
const { CATALOG, SIZES, STOCK_DOC, isRing, normalizeStock } = require('./catalog');
const { KIND, dueAt } = require('./order');

const DAY = 86400;
const QUEUE_DAYS = 180;
const MAX_STEP = 100;

function isOwner(auth, ownerEmail) {
  const token = auth && auth.token;
  return !!token
    && token.email_verified === true
    && typeof token.email === 'string'
    && token.email.toLowerCase() === ownerEmail.trim().toLowerCase();
}

/** The owner's saved edits: [{ model, size, delta }], one per ring and size. */
function isAdjustment(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return false;
  if (changes.length > Object.keys(CATALOG).length * SIZES.length) return false;
  const seen = new Set();
  return changes.every((c) => !!c && isRing(c.model) && SIZES.includes(c.size)
    && Number.isInteger(c.delta) && c.delta !== 0 && Math.abs(c.delta) <= MAX_STEP
    && !seen.has(`${c.model}/${c.size}`) && !!seen.add(`${c.model}/${c.size}`));
}

/**
 * Applies all the edits in one transaction, so a save queues behind a sale
 * rather than racing it. A count never goes below zero.
 */
async function adjustStock(db, changes) {
  const ref = db.doc(STOCK_DOC);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stock = normalizeStock(snap.data());
    for (const { model, size, delta } of changes) {
      stock[model] = { ...stock[model], [size]: Math.max(0, stock[model][size] + delta) };
    }
    tx.set(ref, stock);
    return stock;
  });
}

function queueRow(pi) {
  const m = pi.metadata;
  return {
    id: pi.id,
    orderId: m.order_id || '',
    model: m.model || '',
    size: m.size_us || '',
    name: m.name || '',
    whatsapp: m.whatsapp || '',
    comment: m.comment || '',
    paidAt: pi.created,
    dueAt: dueAt(pi.created),
    converted: m.converted === '1',
    doneAt: m.done_at || '',
    refunded: !!(pi.latest_charge && pi.latest_charge.refunded),
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
    if (pi.status === 'succeeded' && pi.metadata.kind === KIND.MADE) rows.push(queueRow(pi));
  }
  return rows.sort((a, b) => a.dueAt - b.dueAt);
}

/** Ticks a made-to-order payment as made and sent, or un-ticks it. */
async function markDone(stripe, id, done, now) {
  const pi = await stripe.paymentIntents.retrieve(id);
  if (pi.metadata.kind !== KIND.MADE) return false;
  // an empty string is how Stripe removes a metadata key
  await stripe.paymentIntents.update(id, { metadata: { done_at: done ? now.toISOString() : '' } });
  return true;
}

module.exports = { isOwner, isAdjustment, adjustStock, queueRow, listQueue, markDone };
