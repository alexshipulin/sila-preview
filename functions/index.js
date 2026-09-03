/**
 * The one server-side piece the shop needs.
 *
 * The site cannot create a Checkout Session itself — that takes the Stripe
 * secret key, which must never reach a browser. So the page posts the order
 * here, this validates it against the catalogue, and Stripe is handed both the
 * charge and the whole order in metadata. The buyer then only fills in what
 * the card actually requires.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const Stripe = require('stripe');

const { buildSession, OrderError } = require('./order');

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');

const ALLOWED_ORIGINS = new Set([
  'https://silabrand.store',
  'https://www.silabrand.store',
  'http://localhost:8080',      // the local dev server
]);

exports.createCheckout = onRequest(
  { secrets: [STRIPE_SECRET_KEY], region: 'europe-central2', cors: false, maxInstances: 5 },
  async (req, res) => {
    const origin = req.get('origin');
    if (ALLOWED_ORIGINS.has(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    }

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }
    if (!ALLOWED_ORIGINS.has(origin)) { res.status(403).json({ error: 'Forbidden' }); return; }

    // the return URLs follow the site the order came from, so a local test
    // comes back to localhost rather than to production
    const site = origin === 'http://localhost:8080' ? origin : 'https://silabrand.store';

    try {
      const params = buildSession(req.body || {}, site);
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
