/**
 * The catalogue, and where stock comes from.
 *
 * Two different things live in two different places on purpose:
 *
 *   - names, prices and the full range of sizes we make stay here, in code.
 *     A typo in a price charges the wrong amount, so it goes through review
 *     and a deploy like any other change.
 *
 *   - what is actually in stock lives in Firestore, document `shop/stock`,
 *     because it changes with every parcel that goes out. Editing it in the
 *     Firebase console takes effect immediately, with no deploy.
 */

const CATALOG = {
  signet: {
    name: 'Signet Ring',
    amount: 20900,          // $209.00
    currency: 'usd',
    sizes: ['6', '7', '8', '9', '10'],
  },
  lattice: {
    name: 'Lattice Ring',
    amount: 19900,          // $199.00
    currency: 'usd',
    sizes: ['6', '7', '8', '9', '10'],
  },
  rhythm: {
    name: 'Rhythm Ring',
    amount: 23900,          // $239.00
    currency: 'usd',
    sizes: ['6', '7', '8', '9', '10'],
  },
};

const STOCK_DOC = 'shop/stock';

/** What the document looks like when nothing has been set yet: everything on. */
function defaultStock() {
  const out = {};
  for (const [key, ring] of Object.entries(CATALOG)) {
    out[key] = Object.fromEntries(ring.sizes.map((s) => [s, true]));
  }
  return out;
}

/**
 * Reads availability from Firestore.
 *
 * A missing document or a missing ring means "all sizes available" rather than
 * "nothing for sale": an empty database should not silently close the shop.
 * A missing *size* inside a ring that is present means the same — only an
 * explicit `false` takes a size off the list.
 */
async function loadStock(db) {
  let stored = {};
  try {
    const snap = await db.doc(STOCK_DOC).get();
    if (snap.exists) stored = snap.data() || {};
  } catch (err) {
    // a Firestore outage must not stop the shop; fall back to the code
    stored = {};
  }

  const out = {};
  for (const [key, ring] of Object.entries(CATALOG)) {
    const ringStock = stored[key] || {};
    out[key] = Object.fromEntries(
      ring.sizes.map((s) => [s, ringStock[s] !== false])
    );
  }
  return out;
}

/** The shape the site renders from: every size we make, and whether it is in. */
function publicCatalog(stock) {
  const out = {};
  for (const [key, ring] of Object.entries(CATALOG)) {
    out[key] = {
      name: ring.name,
      amount: ring.amount,
      currency: ring.currency,
      sizes: ring.sizes.map((size) => ({ size, inStock: !!(stock[key] || {})[size] })),
    };
  }
  return out;
}

module.exports = { CATALOG, STOCK_DOC, defaultStock, loadStock, publicCatalog };
