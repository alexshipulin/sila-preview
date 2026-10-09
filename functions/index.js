/**
 * The shop's server side.
 *
 *   getCatalog     which sizes are on the shelf, for the product sheet
 *   createCheckout turns an order into a Stripe Checkout Session
 *   stripeWebhook  a paid order: one off the shelf, a message to the owner
 *   admin*         the owner's page: the shelf and the made-to-order queue
 *
 * The site cannot create a session itself — that takes the Stripe secret key,
 * which must never reach a browser. The whole order rides on the payment as
 * metadata, so Stripe is the order record; Firestore holds only the shelf and
 * the markers that stop a redelivered webhook from counting a sale twice.
 */
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const Stripe = require('stripe');

const { buildSession, OrderError } = require('./order');
const { CATALOG, SIZES, loadStock, publicCatalog } = require('./catalog');
const { handlePaid, isPaidEvent } = require('./webhook');
const { sendTelegram } = require('./telegram');
const { isOwner, isAdjustment, adjustStock, listQueue, markDone } = require('./admin');

initializeApp();
const db = getFirestore();

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = defineString('TELEGRAM_CHAT_ID');
const OWNER_EMAIL = defineString('OWNER_EMAIL');

const REGION = 'europe-central2';
const EMULATED = process.env.FUNCTIONS_EMULATOR === 'true';

const ALLOWED_ORIGINS = new Set([
  'https://silabrand.store',
  'https://www.silabrand.store',
  'http://localhost:8080',      // the local dev server
]);

// in the emulator a phone on the same Wi-Fi tests against the dev server too
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}):8080$/;

function allowedOrigin(origin) {
  return ALLOWED_ORIGINS.has(origin) || (EMULATED && LOCAL_ORIGIN.test(origin || ''));
}

/** Returns the origin to echo back, or null if we do not serve this caller. */
function cors(req, res) {
  const origin = req.get('origin');
  if (!allowedOrigin(origin)) return null;
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return origin;
}

function stripeClient() {
  // .trim(): a key pasted or piped in almost always carries a newline, and
  // Stripe rejects the Authorization header outright if it does
  return Stripe(STRIPE_SECRET_KEY.value().trim(), { apiVersion: '2024-06-20' });
}

/**
 * The size lists, with what is on the shelf right now — never the counts.
 * A Firestore failure is a 502: the page then offers made to order only,
 * which cannot sell a ring that is not there.
 */
exports.getCatalog = onRequest(
  { region: REGION, cors: false, maxInstances: 5 },
  async (req, res) => {
    const origin = cors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (!origin) { res.status(403).json({ error: 'Forbidden' }); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Use GET' }); return; }

    try {
      const stock = await loadStock(db);
      // never kept: what the owner saves in the admin shows on the next ring opened
      res.set('Cache-Control', 'no-store');
      res.json({ rings: publicCatalog(stock) });
    } catch (err) {
      logger.error('catalog failed', err);
      res.status(502).json({ error: 'Could not load stock' });
    }
  }
);

exports.createCheckout = onRequest(
  { secrets: [STRIPE_SECRET_KEY], region: REGION, cors: false, maxInstances: 5 },
  async (req, res) => {
    const origin = cors(req, res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (!origin) { res.status(403).json({ error: 'Forbidden' }); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    // null when Firestore could not be read: buildSession then sells made to
    // order only, and refuses ready-to-ship with a 503
    let stock = null;
    try {
      stock = await loadStock(db);
    } catch (err) {
      logger.error('stock unreadable at checkout', err);
    }

    try {
      const params = buildSession(req.body || {}, origin, stock);
      const session = await stripeClient().checkout.sessions.create(params);

      logger.info('checkout created', {
        order_id: params.client_reference_id,
        model: params.metadata.model_key,
        size: params.metadata.size_us,
        kind: params.metadata.kind,
      });
      res.json({ url: session.url, orderId: params.client_reference_id, kind: params.metadata.kind });
    } catch (err) {
      if (err instanceof OrderError) {
        const body = { error: err.message, field: err.field };
        // the page redraws from this, so the size moves to the made list at once
        if (err.status === 409) body.rings = publicCatalog(stock);
        res.status(err.status).json(body);
        return;
      }
      // never echo Stripe's internals back to the page
      logger.error('checkout failed', err);
      res.status(502).json({ error: 'Could not start the payment. Please try again.' });
    }
  }
);

/**
 * Stripe calls this, not a browser: no Origin header, no CORS. What proves the
 * call is genuine is the signature over the raw body.
 */
exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN], region: REGION, maxInstances: 5 },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('Use POST'); return; }

    const stripe = stripeClient();
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody, req.get('stripe-signature'), STRIPE_WEBHOOK_SECRET.value().trim());
    } catch (err) {
      logger.warn('webhook signature rejected', { message: err.message });
      res.status(400).send('Bad signature');
      return;
    }

    if (!isPaidEvent(event)) { res.json({ ignored: event.type }); return; }

    try {
      const outcome = await handlePaid(event.data.object, {
        db,
        stripe,
        notify: (text) => sendTelegram(TELEGRAM_BOT_TOKEN.value().trim(), TELEGRAM_CHAT_ID.value(), text),
        now: new Date(),
      });
      logger.info('payment applied', { session: event.data.object.id, outcome });
      res.json({ outcome });
    } catch (err) {
      // a 500 makes Stripe redeliver; the marker keeps the shelf from double counting
      logger.error('webhook failed', err);
      res.status(500).send('Retry later');
    }
  }
);

// ---- the owner's page ---------------------------------------------------------

const ADMIN = {
  region: REGION,
  maxInstances: 2,
  cors: EMULATED ? true : [...ALLOWED_ORIGINS],
};

function requireOwner(request) {
  if (!isOwner(request.auth, OWNER_EMAIL.value())) {
    throw new HttpsError('permission-denied', 'This page is for the shop owner only.');
  }
}

const RING_NAMES = Object.fromEntries(Object.entries(CATALOG).map(([key, ring]) => [key, ring.name]));

exports.adminStock = onCall(ADMIN, async (request) => {
  requireOwner(request);
  return { rings: RING_NAMES, sizes: SIZES, stock: await loadStock(db) };
});

exports.adminAdjust = onCall(ADMIN, async (request) => {
  requireOwner(request);
  const changes = request.data && request.data.changes;
  if (!isAdjustment(changes)) throw new HttpsError('invalid-argument', 'Unknown ring, size or step.');
  return { stock: await adjustStock(db, changes) };
});

exports.adminQueue = onCall({ ...ADMIN, secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  requireOwner(request);
  return { rows: await listQueue(stripeClient(), Math.floor(Date.now() / 1000)) };
});

exports.adminDone = onCall({ ...ADMIN, secrets: [STRIPE_SECRET_KEY] }, async (request) => {
  requireOwner(request);
  const { id, done } = request.data || {};
  if (typeof id !== 'string' || !/^pi_[A-Za-z0-9]+$/.test(id) || typeof done !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Unknown payment.');
  }
  if (!(await markDone(stripeClient(), id, done, new Date()))) {
    throw new HttpsError('failed-precondition', 'That payment is not a made-to-order ring.');
  }
  return { id, done };
});
