/* =========================================================================
   BRICK RUSH — interactions.js
   Momentum smooth-scroll (Lenis) + eased nav glides + scroll parallax +
   magnetic buttons + subtle 3D card tilt. All disabled for reduced-motion.
   ========================================================================= */
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let lenis = null;

  /* ---------- Momentum smooth scroll ---------- */
  function initScroll() {
    if (reduce || !window.Lenis) return;
    lenis = new window.Lenis({
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.4,
    });
    function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
    lenis.on('scroll', onScroll);
    window.__lenis = lenis;
  }

  /* eased anchor-link glides */
  function initAnchors() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(target, { offset: -70, duration: 1.1 });
      else target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  /* ---------- Scroll parallax ---------- */
  const parallaxEls = [];
  function initParallax() {
    if (reduce) return;
    document.querySelectorAll('[data-parallax]').forEach(el => {
      parallaxEls.push({ el, speed: parseFloat(el.dataset.parallax) || 0.15 });
    });
    onScroll({ scroll: window.scrollY });
  }
  function onScroll(e) {
    const y = (e && typeof e.scroll === 'number') ? e.scroll : window.scrollY;
    for (const p of parallaxEls) {
      // only translate while roughly in view (cheap check via offsetTop)
      p.el.style.transform = `translate3d(0, ${y * p.speed}px, 0)`;
    }
  }
  if (!lenis) window.addEventListener('scroll', () => onScroll({ scroll: window.scrollY }), { passive: true });

  /* ---------- Magnetic buttons (subtle) ---------- */
  function initMagnetic() {
    if (reduce || !fine) return;
    const STRENGTH = 0.22, MAX = 9;
    document.querySelectorAll('.btn--primary, .btn--lg, [data-magnetic]').forEach(btn => {
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        let x = (e.clientX - r.left - r.width / 2) * STRENGTH;
        let y = (e.clientY - r.top - r.height / 2) * STRENGTH;
        x = Math.max(-MAX, Math.min(MAX, x)); y = Math.max(-MAX, Math.min(MAX, y));
        btn.style.transform = `translate(${x}px, ${y}px)`;
      });
      btn.addEventListener('pointerleave', () => {
        btn.style.transform = '';
      });
    });
  }

  /* ---------- Subtle 3D card tilt ---------- */
  function initTilt() {
    if (reduce || !fine) return;
    const MAX = 5;
    document.querySelectorAll('.feature, .role-card, .role-opt').forEach(card => {
      card.style.transformStyle = 'preserve-3d';
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transition = 'transform 0.08s linear';
        card.style.transform = `perspective(800px) rotateX(${-py * MAX}deg) rotateY(${px * MAX}deg) translateY(-5px)`;
      });
      card.addEventListener('pointerleave', () => {
        card.style.transition = 'transform 0.5s var(--ease)';
        card.style.transform = '';
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initScroll(); initAnchors(); initParallax(); initMagnetic(); initTilt();
  });
})();
