/* =========================================================================
   BRICK RUSH — loader.js
   A REAL loading screen: progress tracks actual readiness (fonts, images,
   3D hero, full window load) and resolves the instant everything's ready.
   ========================================================================= */
(function () {
  const loader = document.querySelector('.loader');
  if (!loader) return;

  const bar = loader.querySelector('.loader__bar i');
  const pct = loader.querySelector('.loader__status b');
  const skip = loader.querySelector('.loader__skip');
  const startT = performance.now();
  const MIN_VISIBLE = 450;   // avoid a jarring flash on fast loads
  const SAFETY = 9000;       // never hang

  document.body.classList.add('loading');

  /* assembling bricks that snap toward the logo */
  const field = loader.querySelector('.loader__bricks');
  if (field && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (let i = 0; i < 14; i++) {
      const b = document.createElement('span');
      b.className = 'loader__brick';
      const ang = Math.random() * Math.PI * 2, dist = 120 + Math.random() * 220;
      b.style.left = '50%'; b.style.top = '50%';
      b.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      b.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      b.style.animation = `brickSnap 1.1s ${0.1 + Math.random() * 0.6}s var(--ease) infinite`;
      field.appendChild(b);
    }
  }

  /* ---- Readiness signals ---- */
  let fontsDone = false, windowLoaded = (document.readyState === 'complete');
  const imgs = Array.from(document.images);
  const imgTotal = imgs.length;
  let imgLoaded = 0;
  const heroNeeded = Boolean(document.getElementById('hero-canvas'));
  let heroReady = !heroNeeded;

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fontsDone = true; }).catch(() => { fontsDone = true; });
  else fontsDone = true;

  imgs.forEach(img => {
    if (img.complete) { imgLoaded++; return; }
    const mark = () => { imgLoaded++; };
    img.addEventListener('load', mark, { once: true });
    img.addEventListener('error', mark, { once: true });
  });

  // after the page loads, give the 3D hero a short grace, then stop waiting on it
  const heroGrace = () => setTimeout(() => { heroReady = true; }, 2500);
  if (!windowLoaded) window.addEventListener('load', () => { windowLoaded = true; heroGrace(); });
  else heroGrace();
  window.addEventListener('brickrush:hero-ready', () => { heroReady = true; });

  function computeTarget() {
    const units = 3 + (heroNeeded ? 1 : 0);  // fonts, images, window, (hero)
    let done = 0;
    if (fontsDone) done++;
    done += imgTotal ? imgLoaded / imgTotal : 1;
    if (windowLoaded) done++;
    if (heroNeeded && heroReady) done++;
    return Math.min(1, done / units);
  }

  /* screenshot/QA escape */
  const force = /[?&]nointro\b/.test(location.search);

  let progress = 0, done = force;
  let finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    loader.classList.add('done');
    document.body.classList.remove('loading');
    if (window.Sound && !window.Sound.muted) window.Sound.play('powerOn');
    window.dispatchEvent(new Event('brickrush:ready'));
    setTimeout(() => loader.remove(), 800);
  }

  function tick() {
    const target = done ? 1 : computeTarget();
    if (target >= 1 && !done && performance.now() - startT >= MIN_VISIBLE) done = true;
    progress += ((done ? 1 : target) - progress) * (done ? 0.25 : 0.12);
    const shown = Math.min(100, Math.round(progress * 100));
    if (bar) bar.style.width = shown + '%';
    if (pct) pct.textContent = shown + '%';
    if (done && shown >= 99) { finish(); return; }
    requestAnimationFrame(tick);
  }

  if (skip) skip.addEventListener('click', () => { done = true; });
  setTimeout(() => { done = true; }, SAFETY);
  if (force) { finish(); return; }   // QA/screenshot escape — skip instantly
  requestAnimationFrame(tick);
})();
