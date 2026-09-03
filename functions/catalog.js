/**
 * The catalogue and what is in stock.
 *
 * This is the one place stock is edited. Remove a size from `sizes` and the
 * site stops offering it and the function stops accepting it — the check runs
 * on the server, so a stale page or a crafted request cannot buy a size that
 * is not there.
 *
 * Prices are in cents, in the currency the site shows.
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

module.exports = { CATALOG };
