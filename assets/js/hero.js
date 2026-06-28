/* =========================================================================
   BRICK RUSH — hero.js  (ES module)
   The signature: a slowly rotating planet built from glowing Roblox-style
   studs, ringed by drifting bricks, reacting to the cursor. Falls back to a
   CSS gradient if WebGL is unavailable. Pauses when tab/section is hidden.
   ========================================================================= */
import * as THREE from 'three';

const canvas = document.getElementById('hero-canvas');
const liteMode = (() => { try { return localStorage.getItem('brickrush_lite') === '1'; } catch (e) { return false; } })();
if (canvas && liteMode) { canvas.classList.add('hidden'); document.querySelector('.hero')?.classList.add('hero--lite'); }
else if (canvas) init();

function init() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    canvas.classList.add('hidden');
    document.querySelector('.hero')?.classList.add('hero--nogl');
    window.dispatchEvent(new Event('brickrush:hero-ready'));
    return;
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 13);

  const MAGENTA = new THREE.Color('#ff2e6e');
  const VIOLET = new THREE.Color('#7c5cff');
  const CYAN = new THREE.Color('#2bd2ff');

  /* ---- The planet: studs placed on a sphere ---- */
  const group = new THREE.Group();
  scene.add(group);

  const studGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.09, 12);
  const baseGeo = new THREE.BoxGeometry(0.2, 0.12, 0.2);
  const R = 4.2;
  const COUNT = window.innerWidth < 700 ? 360 : 620;

  const studMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.15, emissive: 0x20243a, emissiveIntensity: 0.6 });
  const studs = new THREE.InstancedMesh(studGeo, studMat, COUNT);
  const bases = new THREE.InstancedMesh(baseGeo, new THREE.MeshStandardMaterial({ color: 0x171a28, roughness: 0.7 }), COUNT);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < COUNT; i++) {
    // even sphere distribution (fibonacci)
    const y = 1 - (i / (COUNT - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    const pos = new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r).multiplyScalar(R);
    dummy.position.copy(pos);
    dummy.lookAt(pos.clone().multiplyScalar(2)); // point studs outward
    dummy.rotateX(Math.PI / 2);
    dummy.updateMatrix();
    studs.setMatrixAt(i, dummy.matrix);
    bases.setMatrixAt(i, dummy.matrix);
    // brand-color sprinkle, mostly white
    const t = Math.random();
    if (t > 0.86) color.copy(MAGENTA);
    else if (t > 0.78) color.copy(VIOLET);
    else if (t > 0.72) color.copy(CYAN);
    else color.set(0xeef1f8);
    studs.setColorAt(i, color);
  }
  studs.instanceColor.needsUpdate = true;
  group.add(bases, studs);

  // inner dark sphere so gaps read as a solid planet
  group.add(new THREE.Mesh(new THREE.SphereGeometry(R - 0.12, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0x0b0c16, roughness: 1 })));

  /* ---- Drifting bricks around the planet ---- */
  const bricks = new THREE.Group();
  scene.add(bricks);
  const brickGeo = new THREE.BoxGeometry(0.5, 0.28, 0.32);
  const brickColors = [MAGENTA, VIOLET, CYAN];
  const floaters = [];
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(brickGeo, new THREE.MeshStandardMaterial({
      color: brickColors[i % 3], roughness: 0.3, metalness: 0.2,
      emissive: brickColors[i % 3], emissiveIntensity: 0.25,
    }));
    const a = Math.random() * Math.PI * 2, rad = 6 + Math.random() * 4, yy = (Math.random() - 0.5) * 8;
    m.position.set(Math.cos(a) * rad, yy, Math.sin(a) * rad);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    floaters.push({ m, a, rad, yy, spin: 0.002 + Math.random() * 0.006, sp: 0.0008 + Math.random() * 0.0016 });
    bricks.add(m);
  }

  /* ---- Lights ---- */
  scene.add(new THREE.AmbientLight(0x4a536e, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(5, 6, 8); scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcc6ff, 0.6); fill.position.set(0, 0, 12); scene.add(fill);
  const rim = new THREE.PointLight(MAGENTA, 2.2, 40); rim.position.set(-7, -3, 4); scene.add(rim);
  const rim2 = new THREE.PointLight(VIOLET, 1.8, 40); rim2.position.set(7, 4, -3); scene.add(rim2);

  /* ---- Resize ---- */
  function resize() {
    const w = canvas.clientWidth || canvas.offsetWidth, h = canvas.clientHeight || canvas.offsetHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    // push the planet into the right side so it fills space and clears the headline
    const off = w > 1100 ? 2.7 : w > 760 ? 1.3 : 0;
    group.position.x = off; bricks.position.x = off;
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  /* ---- Pointer parallax ---- */
  let tx = 0, ty = 0, cx = 0, cy = 0;
  window.addEventListener('pointermove', (e) => {
    tx = (e.clientX / innerWidth - 0.5);
    ty = (e.clientY / innerHeight - 0.5);
  });

  /* ---- Render loop (paused when off-screen) ---- */
  let visible = true;
  const heroEl = document.querySelector('.hero');
  if (heroEl && 'IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; }, { threshold: 0.02 }).observe(heroEl);
  }
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

  let t = 0;
  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;
    t += 1;
    cx += (tx - cx) * 0.05; cy += (ty - cy) * 0.05;
    if (!reduce) {
      group.rotation.y += 0.0016;
      group.rotation.x = cy * 0.5;
      group.rotation.z = cx * 0.18;
      bricks.rotation.y -= 0.0009;
      floaters.forEach(f => {
        f.a += f.sp; f.m.position.x = Math.cos(f.a) * f.rad; f.m.position.z = Math.sin(f.a) * f.rad;
        f.m.position.y = f.yy + Math.sin(t * 0.01 + f.rad) * 0.4;
        f.m.rotation.x += f.spin; f.m.rotation.y += f.spin;
      });
    }
    camera.position.x = cx * 2.4; camera.position.y = -cy * 2.0; camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }
  frame();
  // signal the loader that the 3D hero has rendered its first frame
  requestAnimationFrame(() => window.dispatchEvent(new Event('brickrush:hero-ready')));
}
