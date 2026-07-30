/* FahCel — motion system: GSAP ScrollTrigger + Lenis
   Progressive enhancement: if libs fail, content is forced visible. */
(function () {
  'use strict';

  var hasGSAP = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';

  // ---- Fallback: ensure pinned/hidden content is visible if GSAP is missing ----
  function forceVisible() {
    document.querySelectorAll('.fstep,.feature-stage .layer,.reveal').forEach(function (el) {
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.visibility = 'visible';
    });
    var f = document.getElementById('feature');
    if (f) f.classList.add('stacked');
    var hs = document.getElementById('hscroll');
    if (hs) hs.classList.add('native');
  }

  if (!hasGSAP) { forceVisible(); return; }

  var gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- Lenis
  var lenis = null;
  if (typeof window.Lenis !== 'undefined' && !reduce) {
    lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }

  // nav scrolled state + progress bar
  var nav = document.getElementById('nav');
  var progress = document.getElementById('progress');
  function onScroll(y) {
    if (nav) nav.classList.toggle('scrolled', y > 60);
  }
  if (lenis) lenis.on('scroll', function (e) { onScroll(e.scroll); });
  else window.addEventListener('scroll', function () { onScroll(window.scrollY); });

  gsap.to(progress, {
    scaleX: 1, ease: 'none',
    scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 0.3 }
  });

  // anchor links through Lenis
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (id.length < 2) return;
      var t = document.querySelector(id);
      if (!t) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(t, { offset: -70 });
      else t.scrollIntoView();
    });
  });

  // ---------------------------------------------------------------- HERO
  if (!reduce) {
    var tlHero = gsap.timeline({ delay: 0.15 });
    tlHero.from('#heroTitle .word', { yPercent: 120, opacity: 0, duration: 1, ease: 'power3.out', stagger: 0.08 })
          .from('.h-eyebrow', { y: 20, opacity: 0, duration: 0.7, ease: 'power2.out' }, 0.2)
          .from('#heroContent .lede', { y: 22, opacity: 0, duration: 0.7, ease: 'power2.out' }, '-=0.5')
          .from('#heroContent .row', { y: 22, opacity: 0, duration: 0.7, ease: 'power2.out' }, '-=0.45');
  }
  gsap.to('#heroBg', {
    yPercent: 16, ease: 'none',
    scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true }
  });
  gsap.to('#heroContent', {
    opacity: 0, scale: 0.94, y: -40, ease: 'none',
    scrollTrigger: { trigger: '#hero', start: 'top top', end: '72% top', scrub: true }
  });

  // ---------------------------------------------------------------- REVEALS
  gsap.utils.toArray('.reveal').forEach(function (el) {
    gsap.set(el, { y: 28, opacity: 0 });
  });
  ScrollTrigger.batch('.reveal', {
    start: 'top 88%',
    onEnter: function (els) {
      gsap.to(els, { y: 0, opacity: 1, duration: 0.8, ease: 'power2.out', stagger: 0.08, overwrite: true });
    }
  });

  // ---------------------------------------------------------------- STAT COUNTERS
  function fmt(v, dec) {
    var n = dec ? v.toFixed(dec) : Math.round(v).toString();
    var parts = n.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  gsap.utils.toArray('.count').forEach(function (el) {
    var to = parseFloat(el.dataset.to), dec = parseInt(el.dataset.dec || '0', 10);
    ScrollTrigger.create({
      trigger: el, start: 'top 86%', once: true,
      onEnter: function () {
        var obj = { v: 0 };
        gsap.to(obj, {
          v: to, duration: 1.6, ease: 'power2.out',
          onUpdate: function () { el.textContent = fmt(obj.v, dec); }
        });
      }
    });
  });

  // ---------------------------------------------------------------- PARALLAX BAND
  gsap.to('#bandImg', {
    yPercent: -12, ease: 'none',
    scrollTrigger: { trigger: '#band', start: 'top bottom', end: 'bottom top', scrub: true }
  });

  // ---------------------------------------------------------------- RESPONSIVE
  var mm = gsap.matchMedia();
  var feature = document.getElementById('feature');
  var hscroll = document.getElementById('hscroll');
  var htrack = document.getElementById('htrack');
  var htip = document.getElementById('htip');
  var chipText = document.getElementById('chipText');
  var CHIP = ['logger paired · sealing on', 'seal travels with pallet', 'excursion alert · sealed', 'audit pack · signed'];

  // ===== DESKTOP =====
  mm.add('(min-width: 881px)', function () {
    if (feature) feature.classList.remove('stacked');
    if (hscroll) hscroll.classList.remove('native');

    // ----- Signature pinned feature scroll -----
    var steps = gsap.utils.toArray('#featureSteps .fstep');
    var layers = gsap.utils.toArray('#featureStage .layer');
    var fps = gsap.utils.toArray('#featureProg .fp');
    var bars = fps.map(function (f) { return f.querySelector('.bar i'); });
    var N = steps.length;

    gsap.set(steps, { autoAlpha: 0, y: 40 });
    gsap.set(layers, { autoAlpha: 0, scale: 1.06 });
    gsap.set(bars, { scaleX: 0 });
    gsap.set(steps[0], { autoAlpha: 1, y: 0 });
    gsap.set(layers[0], { autoAlpha: 1, scale: 1 });

    function setActive(idx) {
      if (chipText) chipText.textContent = CHIP[idx] || CHIP[0];
      fps.forEach(function (f, i) { f.classList.toggle('on', i <= idx); });
    }
    setActive(0);

    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: '#feature',
        start: 'top top',
        end: '+=' + (N * 78) + '%',
        pin: '#featurePin',
        scrub: 1,
        invalidateOnRefresh: true,
        onUpdate: function (self) {
          var idx = Math.min(N - 1, Math.floor(self.progress * N + 0.0001));
          setActive(idx);
        }
      }
    });

    steps.forEach(function (step, i) {
      var pos = i;
      if (i > 0) {
        tl.fromTo(layers[i], { autoAlpha: 0, scale: 1.06 }, { autoAlpha: 1, scale: 1, duration: 0.3 }, pos);
        tl.fromTo(step, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.3 }, pos);
      }
      tl.fromTo(bars[i], { scaleX: 0 }, { scaleX: 1, duration: 0.85, ease: 'none' }, pos);
      if (i < N - 1) {
        tl.to(layers[i], { autoAlpha: 0, scale: 1.06, duration: 0.3 }, pos + 0.85);
        tl.to(step, { autoAlpha: 0, y: -40, duration: 0.3 }, pos + 0.85);
      }
    });
    // extend the timeline to exactly N units so floor(progress*N) maps 1:1 to steps
    tl.to({}, { duration: 0.01 }, N);

    // ----- Horizontal pinned solutions -----
    var hTween = null;
    if (htrack && hscroll) {
      if (htip) htip.textContent = 'scroll →';
      var amount = function () { return Math.max(0, htrack.scrollWidth - hscroll.clientWidth); };
      hTween = gsap.to(htrack, {
        x: function () { return -amount(); },
        ease: 'none',
        scrollTrigger: {
          trigger: hscroll,
          start: 'center center',
          end: function () { return '+=' + amount(); },
          pin: true,
          scrub: 1,
          invalidateOnRefresh: true,
          anticipatePin: 1
        }
      });
      // subtle parallax on panel images while sliding
      gsap.utils.toArray('.panel .ph img').forEach(function (img) {
        gsap.fromTo(img, { xPercent: -6 }, {
          xPercent: 6, ease: 'none',
          scrollTrigger: {
            trigger: hscroll, start: 'center center',
            end: function () { return '+=' + amount(); }, scrub: 1, containerAnimation: hTween
          }
        });
      });
    }

    return function () {
      // cleanup handled by matchMedia, clear inline transforms
      gsap.set(steps.concat(layers), { clearProps: 'all' });
      if (htrack) gsap.set(htrack, { clearProps: 'transform' });
    };
  });

  // ===== MOBILE =====
  mm.add('(max-width: 880px)', function () {
    if (feature) feature.classList.add('stacked');
    if (hscroll) hscroll.classList.add('native');
    if (htip) htip.textContent = 'swipe →';
    // make sure stacked steps are visible (they have their own CSS, but clear any inline)
    gsap.utils.toArray('#featureSteps .fstep').forEach(function (s) {
      gsap.set(s, { clearProps: 'all' });
    });
  });

  // ---------------------------------------------------------------- refresh
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
  }
})();
