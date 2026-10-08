/**
 * Turns an order from the site into a Stripe Checkout Session.
 *
 * Kept free of Firebase and of the network so it can be unit-tested: it is
 * handed the shelf and returns exactly what Stripe should be told.
 */
const { CATALOG, SIZES, isRing } = require('./catalog');

const KIND = { STOCK: 'in_stock', MADE: 'made_to_order' };
const LEAD_DAYS = 15;
const MADE_TERMS = `Made to order in about ${LEAD_DAYS} days, then delivered anywhere in Bali. Full prepayment.`;
const LIMITS = { name: 80, whatsapp: 32, comment: 400 };

/** Stripe metadata values are strings and capped at 500 characters. */
function clean(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * SILA-20260903-K7F3Q2 — short enough to read out over WhatsApp, unique enough
 * that two orders in the same second do not collide.
 */
function orderId(now = new Date(), rand = Math.random) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1
  let tail = '';
  for (let i = 0; i < 6; i++) tail += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return `SILA-${day}-${tail}`;
}

/** When a made-to-order ring is due, in seconds, counted from payment. */
function dueAt(createdSeconds) {
  return createdSeconds + LEAD_DAYS * 86400;
}

/** How the payment reads in the Stripe dashboard, where the owner looks orders up. */
function paymentDescription(id, ringName, size, made) {
  return `${id} · ${ringName} US ${size}${made ? ' · MADE TO ORDER' : ''}`;
}

class OrderError extends Error {
  constructor(message, field, status = 400) {
    super(message);
    this.field = field;
    this.status = status;
  }
}

/**
 * Which kind of order this becomes. The server decides from the shelf; the
 * page only says which list the size was picked from (`expect`).
 *
 *   on the shelf                     → ready to ship, even if it was picked
 *                                      from the made-to-order list
 *   gone, but picked as ready        → 409: the shopper agrees to wait 15 days
 *                                      knowingly, never by surprise
 *   gone, picked as made to order    → made to order
 *   shelf unknown (stock === null)   → made to order is fine, ready to ship is
 *                                      a 503: nothing can be promised from it
 */
function decideKind(stock, model, size, expect) {
  if (stock === null) {
    if (expect === KIND.STOCK) {
      throw new OrderError('We could not check stock just now. Please try again in a minute.', 'size', 503);
    }
    return KIND.MADE;
  }
  if (stock[model][size] > 0) return KIND.STOCK;
  if (expect === KIND.STOCK) throw new OrderError(`Size ${size} has just sold out`, 'size', 409);
  return KIND.MADE;
}

function buildSession(input, origin, stock, now = new Date()) {
  if (!isRing(input.model)) throw new OrderError('Unknown ring', 'model');
  const product = CATALOG[input.model];

  const size = clean(input.size, 8);
  if (!SIZES.includes(size)) throw new OrderError('We do not make that size', 'size');

  const expect = input.expect === KIND.MADE ? KIND.MADE : KIND.STOCK;
  const kind = decideKind(stock, input.model, size, expect);
  const made = kind === KIND.MADE;

  const name = clean(input.name, LIMITS.name);
  if (!name) throw new OrderError('Please tell us your name', 'name');

  const whatsapp = clean(input.whatsapp, LIMITS.whatsapp);
  if (whatsapp.replace(/\D/g, '').length < 8) {
    throw new OrderError('Please leave a WhatsApp number we can reach', 'whatsapp');
  }

  const comment = clean(input.comment, LIMITS.comment);
  const id = orderId(now);

  // Everything the order consists of rides on the payment itself, so Stripe is
  // the record: searchable by id, exportable, and impossible to get out of step
  // with the money the way a separate store would be.
  const metadata = {
    order_id: id,
    model: product.name,
    model_key: input.model,
    size_us: size,
    kind,
    name,
    whatsapp,
  };
  if (comment) metadata.comment = comment;

  const session = {
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: product.currency,
        unit_amount: product.amount,
        product_data: {
          name: `${product.name} — US ${size}${made ? ' · Made to order' : ''}`,
          description: made ? MADE_TERMS : 'Ready to ship · handmade in Bali, sterling silver 925',
        },
      },
    }],
    // the buyer only fills in what the card actually needs
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: false },
    client_reference_id: id,
    metadata,
    payment_intent_data: {
      metadata,
      description: paymentDescription(id, product.name, size, made),
    },
    // the shortest Stripe allows: an abandoned tab must not pay tomorrow for a
    // ring sold tonight. 31, not 30 — Stripe measures from its own clock.
    expires_at: Math.floor(now.getTime() / 1000) + 31 * 60,
    success_url: `${origin}/thank-you.html?order=${id}&kind=${kind}`
      + `&ring=${input.model}&size=${encodeURIComponent(size)}`,
    cancel_url: `${origin}/?ring=${input.model}&checkout=cancelled`,
  };
  if (made) session.custom_text = { submit: { message: MADE_TERMS } };
  return session;
}

module.exports = { buildSession, OrderError, KIND, LEAD_DAYS, MADE_TERMS, dueAt, paymentDescription };
