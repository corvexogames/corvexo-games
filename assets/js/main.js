const root = document.documentElement;
const stageEls = [...document.querySelectorAll('[data-stage]')];
const panels = [...document.querySelectorAll('[data-panel]')].map((el) => ({ el, host: el.closest('[data-stage]'), p: 0 }));
const rail = document.querySelector('.rail');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);

/* journey rail */
const railLinks = stageEls.map((el) => {
  const a = document.createElement('a');
  a.href = `#${el.id || 'games'}`;
  a.innerHTML = `<span>${el.dataset.label}</span><i></i>`;
  a.setAttribute('aria-label', el.dataset.label);
  rail.append(a);
  return a;
});

/* scroll position -> continuous stage index. stops[i] is the scrollY where stage i is centred */
let stops = [];
let vh = innerHeight;
function measure() {
  vh = innerHeight;
  const max = root.scrollHeight - vh;
  stops = stageEls.map((el, i) => {
    if (i === 0) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(max, r.top + scrollY + (r.height - vh) / 2);
  });
  stops[stops.length - 1] = max;
}
function stageAt(y) {
  for (let i = 0; i < stops.length - 1; i++) {
    if (y < stops[i + 1]) {
      const f = clamp((y - stops[i]) / Math.max(1, stops[i + 1] - stops[i]));
      return i + smoother(clamp((f - 0.16) / 0.68));
    }
  }
  return stops.length - 1;
}

/* panels turn in and out of depth around their hold position */
function updatePanels(dt) {
  if (reducedMotion) return;
  const k = 1 - Math.exp(-dt * 9);
  for (const panel of panels) {
    const i = stageEls.indexOf(panel.host);
    const raw = (scrollY - stops[i]) / (vh * 0.8);
    const target = Math.abs(raw) < 0.3 ? 0 : clamp(raw - Math.sign(raw) * 0.3, -1, 1);
    panel.p += (target - panel.p) * k;
    panel.el.style.setProperty('--p', panel.p.toFixed(4));
    panel.el.style.setProperty('--o', (1 - clamp(Math.abs(panel.p) * 1.5)).toFixed(3));
    panel.el.style.pointerEvents = Math.abs(panel.p) > 0.5 ? 'none' : '';
  }
}

/* reveal on scroll */
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: 0.2 });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

/* card tilt */
if (matchMedia('(hover:hover)').matches && !reducedMotion) {
  document.querySelectorAll('.tilt').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--ry', `${(x - 0.5) * 16}deg`);
      el.style.setProperty('--rx', `${(0.5 - y) * 16}deg`);
      el.style.setProperty('--mx', `${x * 100}%`);
      el.style.setProperty('--my', `${y * 100}%`);
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
  });
}

const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
addEventListener('pointermove', (e) => {
  pointer.tx = (e.clientX / innerWidth) * 2 - 1;
  pointer.ty = 1 - (e.clientY / innerHeight) * 2;
}, { passive: true });

/* WebGL is an enhancement: without it the page stays on the CSS sky */
function canRunScene() {
  if (reducedMotion || navigator.connection?.saveData) return false;
  const test = document.createElement('canvas').getContext('webgl2');
  return !!test;
}

let scene = null;
async function bootScene() {
  if (!canRunScene()) return;
  try {
    const { createScene } = await import('./scene.js');
    const canvas = document.getElementById('world');
    scene = await createScene(canvas, stageEls.map((el) => el.dataset.stage));
    root.classList.add('gl');
    new ResizeObserver(() => scene?.resize()).observe(canvas);
    canvas.addEventListener('webglcontextlost', () => {
      scene = null;
      root.classList.remove('gl');
    });
  } catch (err) {
    console.warn('3D scene disabled:', err);
    scene = null;
    root.classList.remove('gl');
  }
}

let stage = 0;
let shownStage = -1;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) { last = now; return; }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const target = stageAt(scrollY);
  stage += (target - stage) * (1 - Math.exp(-dt * 4.5));
  const k = 1 - Math.exp(-dt * 4);
  pointer.x += (pointer.tx - pointer.x) * k;
  pointer.y += (pointer.ty - pointer.y) * k;

  const nearest = Math.round(target);
  if (nearest !== shownStage) {
    shownStage = nearest;
    root.dataset.stage = stageEls[nearest].dataset.stage;
    railLinks.forEach((a, i) => a.classList.toggle('on', i === nearest));
  }
  root.classList.toggle('scrolled', scrollY > 40);
  updatePanels(dt);
  scene?.frame(dt, stage, pointer);
}

measure();
addEventListener('resize', measure);
addEventListener('load', measure);
new ResizeObserver(measure).observe(document.body);
stage = stageAt(scrollY);
requestAnimationFrame(frame);
bootScene();
