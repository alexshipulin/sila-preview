/**
 * Turns an order from the site into a Stripe Checkout Session.
 *
 * Kept free of Firebase and of the network so it can be unit-tested and run
 * against the sandbox without deploying anything: the only things it touches
 * are the catalogue and the Stripe client it is handed.
 */
const { CATALOG } = require('./catalog');

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

class OrderError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
    this.status = 400;
  }
}

/**
 * Validates the order and returns exactly what Stripe should be told.
 *
 * `stock` comes from Firestore and is checked here rather than trusted from
 * the page, so a stale tab or a crafted request cannot buy a size that has
 * run out between the page loading and the button being pressed.
 */
function buildSession(input, origin, stock = {}) {
  const product = CATALOG[input.model];
  if (!product) throw new OrderError('Unknown ring', 'model');

  const size = clean(input.size, 8);
  if (!product.sizes.includes(size)) {
    throw new OrderError('We do not make that size', 'size');
  }
  if ((stock[input.model] || {})[size] === false) {
    throw new OrderError('That size has just sold out', 'size');
  }

  const name = clean(input.name, LIMITS.name);
  if (!name) throw new OrderError('Please tell us your name', 'name');

  const whatsapp = clean(input.whatsapp, LIMITS.whatsapp);
  if (whatsapp.replace(/\D/g, '').length < 8) {
    throw new OrderError('Please leave a WhatsApp number we can reach', 'whatsapp');
  }

  const comment = clean(input.comment, LIMITS.comment);
  const id = input.orderId || orderId();

  // Everything the order consists of rides on the payment itself, so Stripe is
  // the record: searchable by id, exportable, and impossible to get out of step
  // with the money the way a separate store would be.
  const metadata = {
    order_id: id,
    model: product.name,
    model_key: input.model,
    size_us: size,
    name,
    whatsapp,
  };
  if (comment) metadata.comment = comment;

  return {
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: product.currency,
        unit_amount: product.amount,
        product_data: {
          name: `${product.name} — US ${size}`,
          description: 'Handmade in Bali · sterling silver 925',
        },
      },
    }],
    // the buyer only fills in what the card actually needs
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: false },
    client_reference_id: id,
    metadata,
    payment_intent_data: { metadata },
    success_url: `${origin}/thank-you.html?order=${id}`,
    cancel_url: `${origin}/?checkout=cancelled`,
  };
}

module.exports = { buildSession, orderId, clean, OrderError, LIMITS };
