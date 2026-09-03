/**
 * The two server-side pieces the shop needs.
 *
 *   getCatalog     what the site renders the size list from
 *   createCheckout turns an order into a Stripe Checkout Session
 *
 * The site cannot create a session itself — that takes the Stripe secret key,
 * which must never reach a browser. So the page posts the order here, this
 * validates it against the catalogue and current stock, and Stripe is handed
 * both the charge and the whole order in metadata. The buyer then only fills
 * in what the card actually requires.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const Stripe = require('stripe');

const { buildSession, OrderError } = require('./order');
const { loadStock, publicCatalog } = require('./catalog');

initializeApp();
const db = getFirestore();

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');

const ALLOWED_ORIGINS = new Set([
  'https://silabrand.store',
  'https://www.silabrand.store',
  'http://localhost:8080',      // the local dev server
]);

/** Returns the origin to echo back, or null if we do not serve this caller. */
function cors(req, res) {
  const origin = req.get('origin');
  if (!ALLOWED_ORIGINS.has(origin)) return null;
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return origin;
}

/**
 * The size list, with what is in stock right now.
 *
 * Cached for a minute at the edge: the page asks for it every time the product
 * sheet opens, and stock does not change by the second. Taking a size off sale
 * therefore reaches shoppers within a minute — and the checkout below re-reads
 * stock on every order, so nothing can be bought in that window anyway.
 */
exports.getCatalog = onRequest(
  { region: 'europe-central2', cors: false, maxInstances: 5 },
  async (req, res) => {
    const origin = cors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (!origin) { res.status(403).json({ error: 'Forbidden' }); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Use GET' }); return; }

    try {
      const stock = await loadStock(db);
      res.set('Cache-Control', 'public, max-age=60');
      res.json({ rings: publicCatalog(stock) });
    } catch (err) {
      logger.error('catalog failed', err);
      res.status(502).json({ error: 'Could not load the catalogue' });
    }
  }
);

exports.createCheckout = onRequest(
  { secrets: [STRIPE_SECRET_KEY], region: 'europe-central2', cors: false, maxInstances: 5 },
  async (req, res) => {
    const origin = cors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (!origin) { res.status(403).json({ error: 'Forbidden' }); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    // the return URLs follow the site the order came from, so a local test
    // comes back to localhost rather than to production
    const site = origin === 'http://localhost:8080' ? origin : 'https://silabrand.store';

    try {
      const stock = await loadStock(db);
      const params = buildSession(req.body || {}, site, stock);

      // .trim(): a key pasted or piped in almost always carries a newline, and
      // Stripe rejects the Authorization header outright if it does
      const stripe = Stripe(STRIPE_SECRET_KEY.value().trim(), { apiVersion: '2024-06-20' });
      const session = await stripe.checkout.sessions.create(params);

      logger.info('checkout created', {
        order_id: params.client_reference_id,
        model: params.metadata.model_key,
        size: params.metadata.size_us,
      });

      res.json({ url: session.url, orderId: params.client_reference_id });
    } catch (err) {
      if (err instanceof OrderError) {
        res.status(err.status).json({ error: err.message, field: err.field });
        return;
      }
      // never echo Stripe's internals back to the page
      logger.error('checkout failed', err);
      res.status(502).json({ error: 'Could not start the payment. Please try again.' });
    }
  }
);
