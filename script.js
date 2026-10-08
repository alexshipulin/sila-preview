// Open at the top. Browsers otherwise restore the last scroll position on a
// reload, which drops the visitor mid-page with the header out of sight.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// The hash is only a scroll target here — there is one page. Left in the URL it
// turns into a sticky bookmark, so the next visit opens at the rings instead of
// at the top. Wipe it once the jump has been made, keeping the position.
(function () {
  function dropHash() {
    if (!location.hash) return;
    history.replaceState(null, '', location.pathname + location.search);
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('a[href^="#"]')) window.setTimeout(dropHash, 1000);
  });

  window.addEventListener('load', function () { window.setTimeout(dropHash, 1000); });
})();

// Reveal-on-scroll: elements with .reveal fade in as they enter the viewport.
(function () {
  var reveals = document.querySelectorAll('.reveal');

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('in'); });
    return;
  }

  // Stagger siblings inside grids (products, duo, trio) for a softer cascade.
  document.querySelectorAll('.cards, .photo-row, .hero-grid').forEach(function (group) {
    var i = 0;
    group.querySelectorAll('.reveal').forEach(function (el) {
      el.style.setProperty('--reveal-delay', (i * 0.12) + 's');
      i++;
    });
  });

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  reveals.forEach(function (el) { observer.observe(el); });
})();

// Product detail modal (Frame 14) + full-screen image viewer.
(function () {
  var modal = document.getElementById('product-modal');
  var lightbox = document.getElementById('lightbox');
  if (!modal) return;

  // the live functions on the site itself; anywhere else — the dev server on
  // this Mac, or a phone on the same Wi-Fi — the local Firebase emulator
  var LIVE = /(^|\.)silabrand\.store$/.test(location.hostname);
  var API = LIVE
    ? 'https://europe-central2-silabrand.cloudfunctions.net'
    : 'http://' + location.hostname + ':5001/silabrand/europe-central2';

  var STOCK = 'in_stock';
  var MADE = 'made_to_order';

  // the order as sent, so a cancelled payment comes back to the same choice
  var SAVED = 'sila-checkout';

  // every size the workshop makes: when the shelf cannot be read, any of them
  // can still be made to order
  var SIZES = ['4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12'];

  // { lattice: { row, ready, made } } once loaded, null while loading,
  // false when it could not be read
  var catalogue = null;
  var cataloguePromise = null;

  function loadCatalogue() {
    if (cataloguePromise) return cataloguePromise;
    cataloguePromise = fetch(API + '/getCatalog')
      .then(function (r) {
        if (!r.ok) throw new Error('catalogue ' + r.status);
        return r.json();
      })
      .then(function (d) { catalogue = d.rings; })
      .catch(function () {
        catalogue = false;
        cataloguePromise = null;     // the next ring opened asks again
      });
    return cataloguePromise;
  }

  // asked for as the page loads, so the sizes are there when a ring is opened
  loadCatalogue();

  /** This ring's lists, or null when the shelf is unknown. */
  function stockFor(key) {
    var ring = catalogue && catalogue[key];
    return ring && Array.isArray(ring.ready) ? ring : null;
  }

  var PRODUCTS = {
    signet: {
      title: 'Signet Ring',
      price: '$209',
      priceAlt: '3 790 000 IDR',
      desc: 'A smooth silver signet ring with a black zircon stone at the center. Its rounded form feels calm and grounded, while the stone adds a quiet point of light. Inside, two small stones symbolize a connection with yourself.',
      specs: [['Material', 'Silver 925'], ['Plating', 'Rhodium Nano'], ['Stone', 'Zircon'], ['Made in', 'Bali']],
      images: ['assets/signet-1.jpg', 'assets/signet-2.jpg', 'assets/signet-3.jpg', 'assets/signet-4.jpg'],
      thumbs: ['assets/signet-1-t.jpg', 'assets/signet-2-t.jpg', 'assets/signet-3-t.jpg', 'assets/signet-4-t.jpg']
    },
    lattice: {
      title: 'Lattice Ring',
      price: '$199',
      priceAlt: '3 590 000 IDR',
      desc: 'A sculptural silver ring built from small rounded elements, creating a soft open structure around the finger. Light-catching, tactile, and bold without feeling heavy. A piece for everyday presence — noticeable, but never loud.',
      specs: [['Material', 'Silver 925'], ['Plating', 'Rhodium Nano'], ['Stone', '—'], ['Made in', 'Bali']],
      images: ['assets/lattice-1.jpg', 'assets/lattice-2.jpg', 'assets/lattice-3.jpg', 'assets/lattice-4.jpg'],
      thumbs: ['assets/lattice-1-t.jpg', 'assets/lattice-2-t.jpg', 'assets/lattice-3-t.jpg', 'assets/lattice-4-t.jpg']
    },
    rhythm: {
      title: 'Rhythm Ring',
      price: '$239',
      priceAlt: '4 290 000 IDR',
      desc: 'A silver ring shaped by repeated vertical forms, creating a clean architectural rhythm. Minimal from afar, detailed up close. Designed to become a daily piece with character — structured, calm, and strong.',
      specs: [['Material', 'Silver 925'], ['Plating', 'Rhodium Nano'], ['Stone', '—'], ['Made in', 'Bali']],
      images: ['assets/rhythm-1.jpg', 'assets/rhythm-2.jpg', 'assets/rhythm-3.jpg', 'assets/rhythm-4.jpg'],
      thumbs: ['assets/rhythm-1-t.jpg', 'assets/rhythm-2-t.jpg', 'assets/rhythm-3-t.jpg', 'assets/rhythm-4-t.jpg']
    }
  };

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var scrollBehaviour = reduce ? 'auto' : 'smooth';

  var dialog = modal.querySelector('.pd-dialog');
  var closeBtn = modal.querySelector('.pd-close');
  var heroBtn = modal.querySelector('.pd-hero');
  var heroImg = heroBtn.querySelector('img');
  var thumbBtns = Array.prototype.slice.call(modal.querySelectorAll('.pd-thumb'));
  var titleEl = modal.querySelector('.pd-title');
  var priceEl = modal.querySelector('.pd-price');
  var descEl = modal.querySelector('.pd-desc');
  var specsEl = modal.querySelector('.pd-specs');

  var form = modal.querySelector('.pd-order');
  var orderHead = form.querySelector('.pd-order-head');
  var sizeError = form.querySelector('[data-size-error]');
  var readyTitle = form.querySelector('[data-ready-title]');
  var readyGrid = form.querySelector('[data-grid="ready"]');
  var stockHint = form.querySelector('.pd-stock-hint');
  var madeBox = form.querySelector('.pd-made');
  var madeToggle = form.querySelector('.pd-made-toggle');
  var madeTitle = form.querySelector('[data-made-title]');
  var madeBody = form.querySelector('.pd-made-body');
  var madeNote = form.querySelector('.pd-made-note');
  var madeGrid = form.querySelector('[data-grid="made"]');
  var fields = form.querySelectorAll('.pd-field');
  var alertBox = form.querySelector('.pd-alert');
  var alertText = alertBox.querySelector('[data-alert-text]');
  var alertAction = alertBox.querySelector('.pd-alert-action');
  var summary = form.querySelector('.pd-summary');
  var confirmBtn = form.querySelector('.pd-confirm');
  var madeTerms = form.querySelector('[data-made-note]');
  var payError = form.querySelector('[data-pay-error]');

  var lbImg = lightbox && lightbox.querySelector('.lb-img');
  var lbClose = lightbox && lightbox.querySelector('.lb-close');
  var lbNext = lightbox && lightbox.querySelector('.lb-next');

  var lastTrigger = null;
  var savedScroll = 0;
  var current = null;      // active product
  var currentKey = null;   // its catalogue key
  var shown = 0;           // index of the image in the hero
  var chosen = { size: '', kind: '' };
  var sending = false;     // between the press of the button and Stripe's page

  function lockPage() {
    savedScroll = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = -savedScroll + 'px';
    document.documentElement.classList.add('pd-lock');
  }

  function unlockPage() {
    document.documentElement.classList.remove('pd-lock');
    document.body.style.top = '';
    try { window.scrollTo({ top: savedScroll, behavior: 'instant' }); }
    catch (e) { window.scrollTo(0, savedScroll); }
  }

  function show(index) {
    if (!current) return;
    shown = (index + current.images.length) % current.images.length;
    heroImg.src = current.images[shown];
    heroImg.alt = current.title;
    thumbBtns.forEach(function (btn, i) { btn.classList.toggle('is-active', i === shown); });
    if (lightbox && !lightbox.hidden) lbImg.src = current.images[shown];
  }


  // ---- order block -----------------------------------------------------------
  // What is on the shelf comes first. A sold-out size stays in that row crossed
  // through and leads into the made-to-order list, which sits folded under it
  // while anything is ready to ship. One size, one button.

  function cell(size, out) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pd-size' + (out ? ' is-out' : '');
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    if (out) {
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('aria-label', size + ', sold out, can be made to order');
    }
    btn.dataset.size = size;
    btn.textContent = size;
    return btn;
  }

  function cells(grid) {
    return Array.prototype.slice.call(grid.querySelectorAll('button.pd-size'));
  }

  function openMade(open) {
    madeToggle.setAttribute('aria-expanded', String(open));
    madeBody.hidden = !open;
  }

  function renderOrder() {
    var loading = catalogue === null;
    var ring = stockFor(currentKey);
    var onShelf = !!(ring && ring.ready.length);

    readyTitle.hidden = !loading && !onShelf;
    readyGrid.hidden = !loading && !onShelf;
    readyGrid.textContent = '';
    if (loading) {
      for (var i = 0; i < 5; i++) {
        var ghost = document.createElement('span');
        ghost.className = 'pd-size is-loading';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.textContent = '0';
        readyGrid.appendChild(ghost);
      }
    } else if (onShelf) {
      ring.row.forEach(function (size) {
        readyGrid.appendChild(cell(size, ring.ready.indexOf(size) === -1));
      });
    }

    var anyOut = onShelf && ring.row.length > ring.ready.length;
    stockHint.hidden = loading || (onShelf && !anyOut);
    stockHint.textContent = !ring
      ? 'We couldn’t check what’s ready to ship — any size can be made to order.'
      : onShelf
        ? 'Crossed-out sizes are sold out — tap one to have it made.'
        : 'Ready-to-ship pieces are sold out right now.';

    // with nothing on the shelf the list is the only way to buy, so it has no fold
    madeBox.hidden = loading;
    madeBox.classList.toggle('is-only', !onShelf);
    madeToggle.hidden = !onShelf;
    madeTitle.hidden = onShelf;
    madeNote.hidden = true;
    madeGrid.textContent = '';
    (ring ? ring.made : SIZES).forEach(function (size) { madeGrid.appendChild(cell(size, false)); });
    openMade(!onShelf);

    choose('', '');
  }

  function choose(size, kind) {
    chosen = { size: size, kind: kind };
    [readyGrid, madeGrid].forEach(function (grid) {
      var mine = grid === (kind === MADE ? madeGrid : readyGrid);
      var list = cells(grid);
      var picked = null;
      list.forEach(function (btn) {
        var on = mine && btn.dataset.size === size;
        btn.setAttribute('aria-checked', String(on));
        if (on) picked = btn;
      });
      // one tab stop per list: its chosen size, or its first
      list.forEach(function (btn, i) { btn.tabIndex = (picked ? btn === picked : i === 0) ? 0 : -1; });
    });

    if (size) sizeError.hidden = true;
    summary.classList.toggle('is-empty', !size);
    summary.textContent = size ? 'Size ' + size + ' ' : 'Choose a size';
    if (size) {
      var tail = document.createElement('span');
      tail.textContent = '· ' + (kind === MADE ? 'Made to order, about 15 days' : 'Ready to ship');
      summary.appendChild(tail);
    }
    madeTerms.hidden = kind !== MADE;
    label();
  }

  function label() {
    if (catalogue === null) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Checking stock…';
      return;
    }
    confirmBtn.disabled = sending;
    if (sending) { confirmBtn.textContent = 'Opening payment…'; return; }

    // before a size is chosen, the button speaks for what the page mostly offers
    var ring = stockFor(currentKey);
    var kind = chosen.kind || (ring && ring.ready.length ? STOCK : MADE);
    confirmBtn.textContent = (kind === MADE ? 'Order — ' : 'Buy now — ') + current.price;
  }

  function pick(btn) {
    alertBox.hidden = true;
    payError.hidden = true;
    if (btn.classList.contains('is-out')) { orderMade(btn.dataset.size); return; }
    madeNote.hidden = true;
    choose(btn.dataset.size, btn.parentNode === madeGrid ? MADE : STOCK);
  }

  // a size that is not on the shelf: open the made-to-order list on it
  function orderMade(size) {
    var twin = madeGrid.querySelector('[data-size="' + size + '"]');
    if (!twin) return;
    alertBox.hidden = true;
    openMade(true);
    madeNote.textContent = 'Size ' + size + ' is sold out — we’ll make it for you.';
    madeNote.hidden = false;
    choose(size, MADE);
    twin.focus({ preventScroll: true });
    twin.scrollIntoView({ block: 'nearest', behavior: scrollBehaviour });
  }

  function moveSize(step) {
    var here = document.activeElement;
    var list = cells(here.parentNode);
    var next = list[(list.indexOf(here) + step + list.length) % list.length];
    next.focus();
    // a radio is chosen as the arrow reaches it — except a sold-out one, which
    // would whisk the visitor off to the other list
    if (!next.classList.contains('is-out')) pick(next);
  }

  function showError(text) {
    payError.textContent = text;
    payError.hidden = false;
    label();
  }

  function checkout() {
    var order = {
      model: currentKey,
      size: chosen.size,
      expect: chosen.kind,
      name: fields[0].value,
      whatsapp: fields[1].value,
      comment: fields[2].value
    };
    sending = true;
    label();

    fetch(API + '/createCheckout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    })
      .then(function (r) {
        return r.json().then(function (body) { return { status: r.status, body: body }; });
      })
      .then(function (res) {
        if (res.status === 200 && res.body.url) {
          // a full Safari private tab can refuse storage; the payment still opens,
          // only a cancelled one comes back to an empty form
          try { sessionStorage.setItem(SAVED, JSON.stringify(order)); } catch (err) { /* see above */ }
          location.assign(res.body.url);
          return;
        }
        sending = false;
        refused(res.status, res.body, order);
      })
      .catch(function () {
        sending = false;
        showError('The payment page didn’t open. Nothing was charged — please try again.');
      });
  }

  function refused(status, body, order) {
    // the size went while the visitor was deciding: the fresh lists come with
    // the answer, and the size moves over to the made-to-order list
    if (status === 409) {
      catalogue = body.rings;
      renderOrder();
      alertText.textContent = 'Size ' + order.size + ' has just sold out. We can make it for you in about 15 days.';
      alertAction.textContent = 'Order size ' + order.size;
      alertAction.dataset.size = order.size;
      alertBox.hidden = false;
      alertBox.scrollIntoView({ block: 'nearest', behavior: scrollBehaviour });
      return;
    }

    // the shelf could not be read at checkout: offer what does not depend on it
    if (status === 503) {
      catalogue = false;
      cataloguePromise = null;
      renderOrder();
      showError('We couldn’t check what’s ready to ship just now. Choose a size above to have it made, or try again in a minute.');
      return;
    }

    var field = body.field;
    if (status === 400 && (field === 'name' || field === 'whatsapp')) {
      var input = form.querySelector('[name="' + field + '"]');
      input.classList.add('is-missing');
      input.focus();
      showError(body.error);
      return;
    }

    showError('The payment page didn’t open. Nothing was charged — please try again.');
  }

  /** Back from a cancelled payment: the same ring, size and details. */
  function restoreChoice(saved) {
    var ring = stockFor(currentKey);
    if (ring && ring.ready.indexOf(saved.size) !== -1) { choose(saved.size, STOCK); return; }
    if (!madeGrid.querySelector('[data-size="' + saved.size + '"]')) return;
    if (saved.expect === STOCK) { orderMade(saved.size); return; }
    openMade(true);
    choose(saved.size, MADE);
  }

  function fill(product) {
    current = product;
    titleEl.textContent = product.title;
    priceEl.textContent = product.price;
    var alt = document.createElement('span');
    alt.className = 'price-alt';
    alt.textContent = product.priceAlt;
    priceEl.appendChild(alt);
    descEl.textContent = product.desc;

    specsEl.textContent = '';
    product.specs.forEach(function (pair) {
      var row = document.createElement('div');
      var dt = document.createElement('dt');
      var dd = document.createElement('dd');
      dt.textContent = pair[0];
      dd.textContent = pair[1];
      row.appendChild(dt);
      row.appendChild(dd);
      specsEl.appendChild(row);
    });

    thumbBtns.forEach(function (btn, i) {
      var img = btn.querySelector('img');
      img.src = product.thumbs[i];
      img.alt = '';
    });

    show(0);
  }

  function reset() {
    fields.forEach(function (field) {
      field.value = '';
      field.classList.remove('is-missing');
    });
    sending = false;
    sizeError.hidden = true;
    alertBox.hidden = true;
    payError.hidden = true;
  }

  function open(slug, trigger) {
    if (!Object.prototype.hasOwnProperty.call(PRODUCTS, slug)) return;

    lastTrigger = trigger || null;
    currentKey = slug;
    fill(PRODUCTS[slug]);
    reset();

    if (catalogue === false) catalogue = null;     // unread last time: ask again
    renderOrder();
    if (catalogue === null) {
      loadCatalogue().then(function () {
        if (!modal.hidden && currentKey === slug) renderOrder();
      });
    }

    modal.hidden = false;
    modal.scrollTop = 0;
    lockPage();

    if (reduce) {
      modal.classList.add('is-open');
    } else {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { modal.classList.add('is-open'); });
      });
    }

    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    if (modal.hidden) return;
    closeLightbox();
    modal.classList.remove('is-open');

    var settled = false;
    var finish = function () {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('transitionend', onEnd);
      modal.hidden = true;
      unlockPage();
      if (lastTrigger) lastTrigger.focus({ preventScroll: true });
    };
    var onEnd = function (e) {
      if (e.target === dialog && e.propertyName === 'opacity') finish();
    };

    if (reduce) {
      finish();
    } else {
      dialog.addEventListener('transitionend', onEnd);
      window.setTimeout(finish, 800);
    }
  }

  // on a phone the gallery is already the width of the screen, so a zoom view
  // would only repeat what is on it — the mobile layout kicks in at 900px
  function canZoom() { return window.matchMedia('(min-width: 901px)').matches; }

  function openLightbox() {
    if (!lightbox || !current || !canZoom()) return;
    lbImg.src = current.images[shown];
    lbImg.alt = current.title;
    lightbox.hidden = false;
    if (reduce) {
      lightbox.classList.add('is-open');
    } else {
      requestAnimationFrame(function () { lightbox.classList.add('is-open'); });
    }
    lbClose.focus({ preventScroll: true });
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) return;
    lightbox.classList.remove('is-open');
    window.setTimeout(function () { lightbox.hidden = true; }, reduce ? 0 : 400);
    heroBtn.focus({ preventScroll: true });
  }

  // ---- events ----

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-pd-close]')) { close(); return; }

    var card = e.target.closest('[data-product]');
    if (card && modal.hidden) {
      open(card.getAttribute('data-product'), e.target.closest('.card-explore') || card);
      return;
    }

    var sizeBtn = e.target.closest('.pd-order button.pd-size');
    if (sizeBtn) { pick(sizeBtn); return; }

    if (e.target.closest('.pd-made-toggle')) {
      openMade(madeToggle.getAttribute('aria-expanded') !== 'true');
      return;
    }

    if (e.target.closest('.pd-alert-action')) { orderMade(alertAction.dataset.size); return; }

    if (e.target.closest('.pd-hero')) { openLightbox(); return; }

    var thumb = e.target.closest('.pd-thumb');
    if (thumb) { show(thumbBtns.indexOf(thumb)); return; }

    if (e.target.closest('.lb-close')) { closeLightbox(); return; }
    if (e.target.closest('.lb-next')) { show(shown + 1); return; }
    if (lightbox && !lightbox.hidden && e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', function (e) {
    // the size guide opens on top of this sheet and owns the keyboard then
    if (document.documentElement.classList.contains('sz-open')) return;

    if (document.activeElement && document.activeElement.classList.contains('pd-size')) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveSize(1); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveSize(-1); return; }
    }
    if (lightbox && !lightbox.hidden) {
      if (e.key === 'Escape') { closeLightbox(); return; }
      if (e.key === 'ArrowRight') { show(shown + 1); return; }
      if (e.key === 'ArrowLeft') { show(shown - 1); return; }
      return;
    }
    if (modal.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;

    // whole parts of the order block hide and show, so ask what is on screen
    var focusable = dialog.querySelectorAll('button, input, a[href]');
    var visible = Array.prototype.filter.call(focusable, function (el) {
      return !el.disabled && el.getClientRects().length > 0;
    });
    if (!visible.length) return;
    var first = visible[0];
    var last = visible[visible.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending || catalogue === null) return;
    payError.hidden = true;

    if (!chosen.size) {
      sizeError.hidden = false;
      orderHead.scrollIntoView({ block: 'center', behavior: scrollBehaviour });
      return;
    }

    var firstBad = null;
    Array.prototype.slice.call(fields, 0, 2).forEach(function (field) {
      var empty = !field.value.trim();
      field.classList.toggle('is-missing', empty);
      if (empty && !firstBad) firstBad = field;
    });
    if (firstBad) { firstBad.focus(); return; }

    checkout();
  });

  // Back from Stripe with the browser's Back button: the page comes out of the
  // back-forward cache exactly as it was left, button still saying it is busy
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted || !sending) return;
    sending = false;
    label();
  });

  // Stripe's "back" link on a payment that was not finished
  (function () {
    var params = new URLSearchParams(location.search);
    if (params.get('checkout') !== 'cancelled') return;
    var key = params.get('ring');
    history.replaceState(null, '', location.pathname);
    if (!Object.prototype.hasOwnProperty.call(PRODUCTS, key)) return;

    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SAVED)); } catch (err) { /* nothing to restore */ }
    open(key, null);
    if (!saved || saved.model !== key) return;

    fields[0].value = saved.name || '';
    fields[1].value = saved.whatsapp || '';
    fields[2].value = saved.comment || '';
    loadCatalogue().then(function () {
      if (!modal.hidden && currentKey === key && !chosen.size) restoreChoice(saved);
    });
  })();
})();

// Contact sheet (Pen: "Contact — Sila"). Same shell as the product modal.
(function () {
  var sheet = document.getElementById('contact-modal');
  if (!sheet) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dialog = sheet.querySelector('.pd-dialog');
  var closeBtn = sheet.querySelector('.pd-close');
  var trigger = null;
  var savedScroll = 0;

  function open(from) {
    trigger = from || null;
    savedScroll = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = -savedScroll + 'px';
    document.documentElement.classList.add('pd-lock');

    sheet.hidden = false;
    sheet.scrollTop = 0;

    if (reduce) {
      sheet.classList.add('is-open');
    } else {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { sheet.classList.add('is-open'); });
      });
    }
    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    if (sheet.hidden) return;
    sheet.classList.remove('is-open');

    var settled = false;
    var finish = function () {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('transitionend', onEnd);
      sheet.hidden = true;
      document.documentElement.classList.remove('pd-lock');
      document.body.style.top = '';
      try { window.scrollTo({ top: savedScroll, behavior: 'instant' }); }
      catch (e) { window.scrollTo(0, savedScroll); }
      if (trigger) trigger.focus({ preventScroll: true });
    };
    var onEnd = function (e) {
      if (e.target === dialog && e.propertyName === 'opacity') finish();
    };

    if (reduce) {
      finish();
    } else {
      dialog.addEventListener('transitionend', onEnd);
      window.setTimeout(finish, 800);
    }
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-ct-close]')) { close(); return; }
    var btn = e.target.closest('.nav-contact');
    if (btn) { open(btn); }
  });

  document.addEventListener('keydown', function (e) {
    if (sheet.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;

    var focusable = dialog.querySelectorAll('button, a[href]');
    var visible = Array.prototype.filter.call(focusable, function (el) { return !el.hidden; });
    if (!visible.length) return;
    var first = visible[0];
    var last = visible[visible.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
})();


// Ring size guide. Opens over the product sheet, which already holds the page
// lock, so this one only takes the lock if nobody else has it.
(function () {
  var sheet = document.getElementById('size-modal');
  if (!sheet) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dialog = sheet.querySelector('.pd-dialog');
  var closeBtn = sheet.querySelector('.pd-close');
  var trigger = null;
  var savedScroll = 0;
  var tookLock = false;

  function open(from) {
    trigger = from || null;

    if (!document.documentElement.classList.contains('pd-lock')) {
      savedScroll = window.scrollY || document.documentElement.scrollTop || 0;
      document.body.style.top = -savedScroll + 'px';
      document.documentElement.classList.add('pd-lock');
      tookLock = true;
    }
    document.documentElement.classList.add('sz-open');

    sheet.hidden = false;
    sheet.scrollTop = 0;

    if (reduce) {
      sheet.classList.add('is-open');
    } else {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { sheet.classList.add('is-open'); });
      });
    }
    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    if (sheet.hidden) return;
    sheet.classList.remove('is-open');

    var settled = false;
    var finish = function () {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('transitionend', onEnd);
      sheet.hidden = true;
      document.documentElement.classList.remove('sz-open');

      if (tookLock) {
        tookLock = false;
        document.documentElement.classList.remove('pd-lock');
        document.body.style.top = '';
        try { window.scrollTo({ top: savedScroll, behavior: 'instant' }); }
        catch (err) { window.scrollTo(0, savedScroll); }
      }
      if (trigger) trigger.focus({ preventScroll: true });
    };
    var onEnd = function (e) {
      if (e.target === dialog && e.propertyName === 'opacity') finish();
    };

    if (reduce) {
      finish();
    } else {
      dialog.addEventListener('transitionend', onEnd);
      window.setTimeout(finish, 800);
    }
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-sz-close]')) { close(); return; }
    var btn = e.target.closest('.pd-sizeguide');
    if (btn) { open(btn); }
  });

  document.addEventListener('keydown', function (e) {
    if (sheet.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;

    var focusable = dialog.querySelectorAll('button, a[href]');
    var visible = Array.prototype.filter.call(focusable, function (el) { return !el.hidden; });
    if (!visible.length) return;
    var first = visible[0];
    var last = visible[visible.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
})();
