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

// Product detail modal (Frame 14). Opens collapsed; "Buy" unfolds the order block.
(function () {
  var modal = document.getElementById('product-modal');
  if (!modal) return;

  var SPECS_STONE = ['Stone', 'Zircon'];
  var SIZES = ['6', '7', '8', '9', '10'];

  var PRODUCTS = {
    rhythm: {
      title: 'Rhythm Ring',
      price: '2 300 000 IDR',
      desc: 'A silver ring shaped by repeated vertical forms, creating a clean architectural rhythm. Minimal from afar, detailed up close. Designed to become a daily piece with character — structured, calm, and strong.',
      specs: [['Material', 'Silver 925'], ['Stone', '—'], ['Sizes', '6–10 adjustable'], ['Weight', '~6 g'], ['Made in', 'Bali']],
      sizes: SIZES,
      images: ['assets/detail-rhythm-1.jpg', 'assets/detail-rhythm-2.jpg', 'assets/detail-rhythm-3.jpg']
    },
    lattice: {
      title: 'Lattice Ring',
      price: '2 500 000 IDR',
      desc: 'A sculptural silver ring built from small rounded elements, creating a soft open structure around the finger. Light-catching, tactile, and bold without feeling heavy. A piece for everyday presence — noticeable, but never loud.',
      specs: [['Material', 'Silver 925'], SPECS_STONE, ['Sizes', '6–10'], ['Made in', 'Bali']],
      sizes: SIZES,
      images: ['assets/detail-lattice-1.jpg', 'assets/detail-lattice-2.jpg', 'assets/detail-lattice-3.jpg']
    },
    signet: {
      title: 'Signet Ring',
      price: '3 000 000 IDR',
      desc: 'A smooth silver signet ring with a warm zircon stone at the center. Its rounded form feels calm and grounded, while the stone adds a quiet point of light. Inside, two small stones symbolize a connection with yourself.',
      specs: [['Material', 'Silver 925'], SPECS_STONE, ['Sizes', '6–10'], ['Made in', 'Bali']],
      sizes: SIZES,
      images: ['assets/detail-signet-1.jpg', 'assets/detail-signet-2.jpg', 'assets/detail-signet-3.jpg']
    }
  };

  // Cascade order for the unfolding order block: quantity, the three fields,
  // the confirm button, and finally the payment note in the bottom-left.
  var RISE_DELAYS = [0, 0.24, 0.08, 0.14, 0.2, 0.28];

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var dialog = modal.querySelector('.pd-dialog');
  var closeBtn = modal.querySelector('.pd-close');
  var heroImg = modal.querySelector('.pd-hero img');
  var thumbImgs = modal.querySelectorAll('.pd-thumbs img');
  var titleEl = modal.querySelector('.pd-title');
  var priceEl = modal.querySelector('.pd-price');
  var descEl = modal.querySelector('.pd-desc');
  var specsEl = modal.querySelector('.pd-specs');
  var sizeEl = modal.querySelector('.pd-size');
  var buyBtn = modal.querySelector('.pd-buy');
  var orderEl = modal.querySelector('.pd-order');
  var form = modal.querySelector('.pd-order-right');
  var confirmBtn = modal.querySelector('.pd-confirm');
  var thanksEl = modal.querySelector('.pd-thanks');
  var countEl = modal.querySelector('.pd-count');
  var rises = modal.querySelectorAll('.pd-rise');
  var fields = form.querySelectorAll('.pd-field');

  var lastTrigger = null;
  var qty = 1;
  var savedScroll = 0;

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

  function fill(product) {
    titleEl.textContent = product.title;
    priceEl.textContent = product.price;
    descEl.textContent = product.desc;

    specsEl.textContent = '';
    product.specs.forEach(function (pair) {
      var dt = document.createElement('dt');
      var dd = document.createElement('dd');
      dt.textContent = pair[0];
      dd.textContent = pair[1];
      specsEl.appendChild(dt);
      specsEl.appendChild(dd);
    });

    sizeEl.textContent = '';
    sizeEl.required = true;
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = 'Select size';
    sizeEl.appendChild(placeholder);
    product.sizes.forEach(function (size) {
      var option = document.createElement('option');
      option.value = size;
      option.textContent = size;
      sizeEl.appendChild(option);
    });

    heroImg.src = product.images[0];
    heroImg.alt = product.title;
    thumbImgs.forEach(function (img, i) {
      img.src = product.images[i + 1];
      img.alt = '';
    });
  }

  function setQty(value) {
    qty = Math.min(99, Math.max(1, value));
    countEl.textContent = qty;
  }

  function collapse() {
    modal.classList.remove('is-expanded');
    buyBtn.setAttribute('aria-expanded', 'false');
    rises.forEach(function (el) { el.classList.remove('in'); });
    fields.forEach(function (field) {
      field.value = '';
      field.disabled = false;
      field.classList.remove('is-missing');
    });
    confirmBtn.hidden = false;
    thanksEl.hidden = true;
    setQty(1);
  }

  function expand() {
    if (!modal.classList.contains('is-expanded')) {
      modal.classList.add('is-expanded');
      buyBtn.setAttribute('aria-expanded', 'true');
      rises.forEach(function (el, i) {
        el.style.setProperty('--reveal-delay', (RISE_DELAYS[i] !== undefined ? RISE_DELAYS[i] : i * 0.08) + 's');
        el.classList.add('in');
      });
    }
    // the order block is the bottom of the sheet once open — follow it down
    var follow = function () {
      if (modal.scrollTo) modal.scrollTo({ top: modal.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
      else modal.scrollTop = modal.scrollHeight;
    };
    follow();
    if (!reduce) window.setTimeout(follow, 900);
    window.setTimeout(function () {
      fields[0].focus({ preventScroll: true });
    }, reduce ? 0 : 1000);
  }

  function open(slug, trigger) {
    var product = PRODUCTS[slug];
    if (!product) return;

    lastTrigger = trigger || null;
    fill(product);
    collapse();

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

  document.addEventListener('click', function (e) {
    var card = e.target.closest('[data-product]');
    if (card) { open(card.getAttribute('data-product'), card); return; }
    if (e.target.closest('[data-pd-close]')) close();
  });

  document.addEventListener('keydown', function (e) {
    var card = e.target.closest && e.target.closest('[data-product]');
    if (card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open(card.getAttribute('data-product'), card);
      return;
    }
    if (modal.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;

    // keep focus inside the dialog
    var expanded = modal.classList.contains('is-expanded');
    var focusable = dialog.querySelectorAll('button, select, input, [href]');
    var visible = Array.prototype.filter.call(focusable, function (el) {
      if (el.disabled || el.hidden) return false;
      return expanded || !el.closest('.pd-order');
    });
    if (!visible.length) return;
    var first = visible[0];
    var last = visible[visible.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  buyBtn.addEventListener('click', expand);

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
