/* =========================================================================
   BRICK RUSH — sound.js
   Synthesized UI sound effects via Web Audio (no files needed) +
   an optional ambient music slot. Respects autoplay rules & user mute.
   ========================================================================= */
(function () {
  const STORE_KEY = 'brickrush_sound';
  let ctx = null;
  let masterMuted = localStorage.getItem(STORE_KEY) === 'muted';
  let ambient = null;       // optional <audio> element for background music
  let ambientWanted = false;

  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* A warm synth blip: oscillator → lowpass (for a soft, premium tone) → gain. */
  function blip({ freq = 440, dur = 0.08, type = 'sine', gain = 0.06, slideTo = null, cutoff = 2600, attack = 0.008 }) {
    if (masterMuted) return;
    const c = ac(); if (!c) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.6;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(gain, c.currentTime + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    osc.connect(lp).connect(g).connect(c.destination);
    osc.start(); osc.stop(c.currentTime + dur + 0.02);
  }

  function chord(freqs, opts = {}) { freqs.forEach((f, i) => setTimeout(() => blip({ ...opts, freq: f }), i * 48)); }

  /* Clean & premium, with a light game touch. */
  const SFX = {
    hover()  { blip({ freq: 1100, dur: 0.05, type: 'sine', gain: 0.016, cutoff: 4200 }); },
    tick()   { blip({ freq: 900, dur: 0.04, type: 'triangle', gain: 0.022, cutoff: 3600 }); },
    click()  { blip({ freq: 440, dur: 0.07, type: 'triangle', gain: 0.05, slideTo: 700, cutoff: 3200, attack: 0.004 });
               blip({ freq: 1500, dur: 0.035, type: 'sine', gain: 0.016, cutoff: 5200 }); },
    select() { chord([523, 784], { dur: 0.12, type: 'sine', gain: 0.05, cutoff: 3800 }); },
    step()   { chord([587, 880], { dur: 0.13, type: 'sine', gain: 0.045, cutoff: 3200 }); },
    success(){ chord([523, 659, 784, 1046], { dur: 0.26, type: 'sine', gain: 0.05, cutoff: 4400 }); },
    error()  { blip({ freq: 240, dur: 0.24, type: 'sawtooth', gain: 0.04, slideTo: 120, cutoff: 1300 }); },
    accept() { chord([659, 880, 1318, 1760], { dur: 0.22, type: 'sine', gain: 0.05, cutoff: 4800 }); },
    reject() { blip({ freq: 220, dur: 0.3, type: 'sawtooth', gain: 0.04, slideTo: 98, cutoff: 1100 }); },
    powerOn(){ blip({ freq: 130, dur: 0.55, type: 'sine', gain: 0.06, slideTo: 680, cutoff: 2600 });
               blip({ freq: 392, dur: 0.45, type: 'triangle', gain: 0.025, slideTo: 1046, cutoff: 3200 }); },
  };

  /* Ambient music: drop a file at assets/audio/ambient.mp3 to enable.
     Stays muted until the user opts in via the sound toggle. */
  function initAmbient() {
    ambient = new Audio('assets/audio/ambient.mp3');
    ambient.loop = true; ambient.volume = 0.0;
    ambient.addEventListener('error', () => { ambient = null; }, { once: true });
  }
  function fadeAmbient(to) {
    if (!ambient) return;
    if (to > 0 && ambient.paused) ambient.play().catch(() => {});
    const step = () => {
      if (!ambient) return;
      const diff = to - ambient.volume;
      if (Math.abs(diff) < 0.01) { ambient.volume = to; if (to === 0) ambient.pause(); return; }
      ambient.volume = Math.max(0, Math.min(0.35, ambient.volume + diff * 0.08));
      requestAnimationFrame(step);
    };
    step();
  }

  const Sound = {
    sfx: SFX,
    play(name) { (SFX[name] || function () {})(); },
    get muted() { return masterMuted; },
    toggle() {
      masterMuted = !masterMuted;
      localStorage.setItem(STORE_KEY, masterMuted ? 'muted' : 'on');
      if (masterMuted) { ambientWanted = false; fadeAmbient(0); }
      else { ac(); ambientWanted = true; if (!ambient) initAmbient(); fadeAmbient(0.22); SFX.tick(); }
      return masterMuted;
    },
    /* Wire SFX onto interactive elements — hover fires ONCE per element,
       not on every child the pointer crosses. */
    bind() {
      const HOVER_SEL = '.btn,.role-opt,.nav__links a,.card,.pill-opt,.filter-tabs button,.sound-toggle,.role-card';
      let lastHover = null;
      document.addEventListener('pointerover', (e) => {
        const t = e.target.closest ? e.target.closest(HOVER_SEL) : null;
        if (t !== lastHover) { lastHover = t; if (t) SFX.hover(); }
      });
      document.addEventListener('click', (e) => {
        const t = e.target.closest ? e.target.closest('.btn,.role-opt,.pill-opt,.demand-seg button,.filter-tabs button') : null;
        if (t && !t.dataset.noSound) SFX.click();
      }, true);
    },
  };

  window.Sound = Sound;
})();
