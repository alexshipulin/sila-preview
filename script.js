// Open at the top. Browsers otherwise restore the last scroll position on a
// reload, which drops the visitor mid-page with the header out of sight.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

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

  var SIZES = ['6', '7', '8', '9', '10'];

  var PRODUCTS = {
    signet: {
      title: 'Signet Ring',
      price: '$209',
      priceAlt: '3\u00a0790\u00a0000\u00a0IDR',
      desc: 'A smooth silver signet ring with a warm zircon stone at the center. Its rounded form feels calm and grounded, while the stone adds a quiet point of light. Inside, two small stones symbolize a connection with yourself.',
      specs: [['Material', 'Silver 925'], ['Plating', 'Rhodium Nano'], ['Stone', 'Zircon'], ['Made in', 'Bali']],
      images: ['assets/signet-1.jpg', 'assets/signet-2.jpg', 'assets/signet-3.jpg', 'assets/signet-4.jpg'],
      thumbs: ['assets/signet-1-t.jpg', 'assets/signet-2-t.jpg', 'assets/signet-3-t.jpg', 'assets/signet-4-t.jpg']
    },
    lattice: {
      title: 'Lattice Ring',
      price: '$199',
      priceAlt: '3\u00a0590\u00a0000\u00a0IDR',
      desc: 'A sculptural silver ring built from small rounded elements, creating a soft open structure around the finger. Light-catching, tactile, and bold without feeling heavy. A piece for everyday presence — noticeable, but never loud.',
      specs: [['Material', 'Silver 925'], ['Plating', 'Rhodium Nano'], ['Stone', '—'], ['Made in', 'Bali']],
      images: ['assets/lattice-1.jpg', 'assets/lattice-2.jpg', 'assets/lattice-3.jpg', 'assets/lattice-4.jpg'],
      thumbs: ['assets/lattice-1-t.jpg', 'assets/lattice-2-t.jpg', 'assets/lattice-3-t.jpg', 'assets/lattice-4-t.jpg']
    },
    rhythm: {
      title: 'Rhythm Ring',
      price: '$239',
      priceAlt: '4\u00a0290\u00a0000\u00a0IDR',
      desc: 'A silver ring shaped by repeated vertical forms, creating a clean architectural rhythm. Minimal from afar, detailed up close. Designed to become a daily piece with character — structured, calm, and strong.',
      specs: [['Material', 'Silver 925'], ['Plating', 'Rhodium Nano'], ['Stone', '—'], ['Made in', 'Bali']],
      images: ['assets/rhythm-1.jpg', 'assets/rhythm-2.jpg', 'assets/rhythm-3.jpg', 'assets/rhythm-4.jpg'],
      thumbs: ['assets/rhythm-1-t.jpg', 'assets/rhythm-2-t.jpg', 'assets/rhythm-3-t.jpg', 'assets/rhythm-4-t.jpg']
    }
  };

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var dialog = modal.querySelector('.pd-dialog');
  var closeBtn = modal.querySelector('.pd-close');
  var heroBtn = modal.querySelector('.pd-hero');
  var heroImg = heroBtn.querySelector('img');
  var thumbBtns = Array.prototype.slice.call(modal.querySelectorAll('.pd-thumb'));
  var titleEl = modal.querySelector('.pd-title');
  var priceEl = modal.querySelector('.pd-price');
  var descEl = modal.querySelector('.pd-desc');
  var specsEl = modal.querySelector('.pd-specs');
  var sizeEl = modal.querySelector('.pd-size');
  var form = modal.querySelector('.pd-form');
  var confirmBtn = modal.querySelector('.pd-confirm');
  var thanksEl = modal.querySelector('.pd-thanks');
  var countEl = modal.querySelector('.pd-count');
  var fields = form.querySelectorAll('.pd-field');

  var lbImg = lightbox && lightbox.querySelector('.lb-img');
  var lbClose = lightbox && lightbox.querySelector('.lb-close');
  var lbNext = lightbox && lightbox.querySelector('.lb-next');

  var lastTrigger = null;
  var qty = 1;
  var savedScroll = 0;
  var current = null;      // active product
  var shown = 0;           // index of the image in the hero

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

    sizeEl.textContent = '';
    sizeEl.required = true;
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = 'Select size';
    sizeEl.appendChild(placeholder);
    SIZES.forEach(function (size) {
      var option = document.createElement('option');
      option.value = size;
      option.textContent = size;
      sizeEl.appendChild(option);
    });

    thumbBtns.forEach(function (btn, i) {
      var img = btn.querySelector('img');
      img.src = product.thumbs[i];
      img.alt = '';
    });

    show(0);
  }

  function setQty(value) {
    qty = Math.min(99, Math.max(1, value));
    countEl.textContent = qty;
  }

  function reset() {
    fields.forEach(function (field) {
      field.value = '';
      field.disabled = false;
      field.classList.remove('is-missing');
    });
    confirmBtn.hidden = false;
    thanksEl.hidden = true;
    setQty(1);
  }

  function open(slug, trigger) {
    var product = PRODUCTS[slug];
    if (!product) return;

    lastTrigger = trigger || null;
    fill(product);
    reset();

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

    if (e.target.closest('.pd-hero')) { openLightbox(); return; }

    var thumb = e.target.closest('.pd-thumb');
    if (thumb) { show(thumbBtns.indexOf(thumb)); return; }

    if (e.target.closest('.lb-close')) { closeLightbox(); return; }
    if (e.target.closest('.lb-next')) { show(shown + 1); return; }
    if (lightbox && !lightbox.hidden && e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', function (e) {
    if (lightbox && !lightbox.hidden) {
      if (e.key === 'Escape') { closeLightbox(); return; }
      if (e.key === 'ArrowRight') { show(shown + 1); return; }
      if (e.key === 'ArrowLeft') { show(shown - 1); return; }
      return;
    }
    if (modal.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;

    var focusable = dialog.querySelectorAll('button, select, input');
    var visible = Array.prototype.filter.call(focusable, function (el) {
      return !el.disabled && !el.hidden;
    });
    if (!visible.length) return;
    var first = visible[0];
    var last = visible[visible.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  modal.querySelectorAll('.pd-step').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setQty(qty + Number(btn.getAttribute('data-step')));
    });
  });

  // Visual only — nothing is sent anywhere.
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var missing = false;
    Array.prototype.slice.call(fields, 0, 2).forEach(function (field) {
      var empty = !field.value.trim();
      field.classList.toggle('is-missing', empty);
      if (empty) missing = true;
    });
    if (missing) { form.querySelector('.is-missing').focus(); return; }

    fields.forEach(function (field) { field.disabled = true; });
    confirmBtn.hidden = true;
    thanksEl.hidden = false;
  });
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
