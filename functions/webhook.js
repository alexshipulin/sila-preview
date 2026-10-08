/**
 * What a paid order does to the shelf, and to the owner's phone.
 *
 * Stripe may deliver the same event twice, and two buyers may pay for the
 * last ring within the same second. Both are settled by one Firestore
 * transaction per payment that writes a marker, `processed/{session id}`,
 * next to the stock change: the marker's existence is what makes a redelivery
 * a no-op, and the transaction is what makes two last-ring payments queue up.
 */
const { normalizeStock, STOCK_DOC } = require('./catalog');
const { KIND, paymentDescription } = require('./order');
const { orderMessage } = require('./telegram');

/**
 * Pure: the shelf after this payment, and what happened.
 *   'decremented' — sold from the shelf, one fewer left
 *   'converted'   — sold as ready to ship, but the shelf was already empty:
 *                   someone else took the last one, so this one gets made
 *   'made'        — a made-to-order payment; the shelf is not touched
 */
function applyPaid(stock, meta) {
  if (meta.kind !== KIND.STOCK) return { stock, outcome: 'made' };
  const left = stock[meta.model_key][meta.size_us];
  if (left > 0) {
    const ring = { ...stock[meta.model_key], [meta.size_us]: left - 1 };
    return { stock: { ...stock, [meta.model_key]: ring }, outcome: 'decremented' };
  }
  return { stock, outcome: 'converted' };
}

/**
 * Handles one paid Checkout Session. Throws when something worth retrying
 * failed — Stripe redelivers on a 500, and the marker keeps the shelf from
 * being counted twice.
 *
 * deps: { db, stripe, notify(text) -> true | 'failed', now }
 */
async function handlePaid(session, { db, stripe, notify, now }) {
  const meta = session.metadata;
  const markerRef = db.doc(`processed/${session.id}`);
  const stockRef = db.doc(STOCK_DOC);

  const marker = await db.runTransaction(async (tx) => {
    const seen = await tx.get(markerRef);
    if (seen.exists) return seen.data();

    const snap = await tx.get(stockRef);
    const { stock, outcome } = applyPaid(normalizeStock(snap.data()), meta);
    if (outcome === 'decremented') tx.set(stockRef, stock);

    const fresh = {
      at: now.toISOString(),
      order_id: meta.order_id || '',
      model: meta.model_key || '',
      size: meta.size_us || '',
      outcome,
      relabelled: false,
      notified: false,
    };
    tx.create(markerRef, fresh);
    return fresh;
  });

  // the payment itself now says what it really is, so the made-to-order queue
  // in the admin picks it up
  if (marker.outcome === 'converted' && !marker.relabelled) {
    await stripe.paymentIntents.update(session.payment_intent, {
      metadata: { kind: KIND.MADE, converted: '1' },
      description: `${paymentDescription(meta.order_id, meta.model, meta.size_us, true)} (last piece went to another buyer)`,
    });
    await markerRef.update({ relabelled: true });
  }

  if (marker.notified === false) {
    const result = await notify(orderMessage(meta, marker.outcome, session.amount_total, session.created));
    await markerRef.update({ notified: result });
  }

  return marker.outcome;
}

/** Only these mean money has actually arrived. */
function isPaidEvent(event) {
  const s = event.data && event.data.object;
  if (!s || s.object !== 'checkout.session') return false;
  if (event.type === 'checkout.session.async_payment_succeeded') return true;
  return event.type === 'checkout.session.completed' && s.payment_status === 'paid';
}

module.exports = { applyPaid, handlePaid, isPaidEvent };
