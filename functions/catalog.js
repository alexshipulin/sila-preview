/**
 * The catalogue, and where stock comes from.
 *
 *   - names, prices and the sizes the workshop makes live here, in code: a
 *     typo in a price charges the wrong amount, so that goes through a deploy.
 *   - how many of each size are on the shelf lives in Firestore, `shop/stock`,
 *     as a whole number per ring and size. The owner changes it from /admin and
 *     every paid order takes one off, so it moves daily without a deploy.
 */

/** Every size the workshop makes to order, US scale, in display order. */
const SIZES = ['4', '5', '6', '7', '8', '9', '10', '11', '12'];

/** The ready-to-ship row always shows these, crossed out when there are none. */
const ROW = ['6', '7', '8', '9', '10'];

const CATALOG = {
  signet: { name: 'Signet Ring', amount: 20900, currency: 'usd' },    // $209.00
  lattice: { name: 'Lattice Ring', amount: 19900, currency: 'usd' },  // $199.00
  rhythm: { name: 'Rhythm Ring', amount: 23900, currency: 'usd' },    // $239.00
};

const STOCK_DOC = 'shop/stock';

function isRing(key) {
  return typeof key === 'string' && Object.hasOwn(CATALOG, key);
}

/**
 * Whole positive counts only. Anything else — the true/false of the old yes/no
 * format, a string, a negative — reads as an empty shelf: an unknown count must
 * never let the site sell a ring that may not be there.
 */
function count(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** Every ring and every size, with a count, whatever shape the document is in. */
function normalizeStock(stored) {
  const out = {};
  for (const key of Object.keys(CATALOG)) {
    const ring = (stored && stored[key]) || {};
    out[key] = Object.fromEntries(SIZES.map((s) => [s, count(ring[s])]));
  }
  return out;
}

/**
 * Reads the shelf. A Firestore failure propagates: every caller has to decide
 * what an outage means for it, and "assume it is all there" is never the answer.
 */
async function loadStock(db) {
  const snap = await db.doc(STOCK_DOC).get();
  return normalizeStock(snap.data());
}

/**
 * What the page renders from. Counts never leave the server — only which sizes
 * are on the shelf. `row` is the ready-to-ship row (the fixed sizes plus any
 * rare one that is in), `made` is everything that is not on the shelf.
 */
function publicCatalog(stock) {
  const out = {};
  for (const [key, ring] of Object.entries(CATALOG)) {
    const ready = SIZES.filter((s) => stock[key][s] > 0);
    out[key] = {
      name: ring.name,
      amount: ring.amount,
      currency: ring.currency,
      row: SIZES.filter((s) => ROW.includes(s) || ready.includes(s)),
      ready,
      made: SIZES.filter((s) => !ready.includes(s)),
    };
  }
  return out;
}

module.exports = { CATALOG, SIZES, STOCK_DOC, isRing, normalizeStock, loadStock, publicCatalog };
