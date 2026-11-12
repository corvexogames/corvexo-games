const root = document.documentElement;
const stageEls = [...document.querySelectorAll('[data-stage]')];
const panels = [...document.querySelectorAll('[data-panel]')].map((el) => ({ el, host: el.closest('[data-stage]'), p: 0 }));
const rail = document.querySelector('.rail');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);

/* journey rail */
const railLinks = stageEls.map((el, i) => {
  const a = document.createElement('a');
  a.dataset.stop = i;
  a.href = `#${el.id || 'games'}`;
  a.innerHTML = `<span>${el.dataset.label}</span><i></i>`;
  a.setAttribute('aria-label', el.dataset.label);
  rail.append(a);
  return a;
});

/* scroll position -> continuous stage index. stops[i] is the scrollY where stage i is centred */
let stops = [];
let vh = innerHeight;
/* the phone address bar changes innerHeight mid-scroll, which must not move the stops */
const heightProbe = document.createElement('div');
heightProbe.style.cssText = 'position:fixed;top:0;width:0;height:100svh;visibility:hidden;pointer-events:none';
document.body.append(heightProbe);
function measure() {
  vh = heightProbe.offsetHeight || innerHeight;
  const max = root.scrollHeight - innerHeight;
  stops = stageEls.map((el, i) => {
    if (i === 0) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(max, r.top + scrollY + (r.height - vh) / 2);
  });
  stops[stops.length - 1] = max;
  measureSnap();
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

/* one scroll gesture moves one stop. The about block can outgrow a phone screen, so it scrolls freely there */
let snapStops = [];
let gamesStop = 0;
let freeZone = null;
let gliding = false;
let glideId = 0;
let anchorY = 0;
let touching = false;
let userScrolled = false;
let draggingBar = false;

const canSnap = () => !reducedMotion && innerHeight >= 560;
const touchScreen = matchMedia('(pointer:coarse)').matches;

function measureSnap() {
  const head = document.querySelector('.about-head');
  const values = document.querySelector('.values');
  const games = document.querySelector('.games-head');
  const bottom = values.offsetTop + values.offsetHeight;
  freeZone = bottom - head.offsetTop > vh - 110 ? { from: head.offsetTop - 90, to: bottom + 30 - vh } : null;
  gamesStop = games.offsetTop + (games.offsetHeight - vh) / 2;
  const edges = freeZone ? [freeZone.from, freeZone.to] : [];
  snapStops = [...stops.filter((_, i) => !freeZone || i !== 1), gamesStop, ...edges].sort((a, b) => a - b);
}

function nextStop(y, dir) {
  const found = dir > 0 ? snapStops.find((s) => s > y + 3) : [...snapStops].reverse().find((s) => s < y - 3);
  return found ?? y;
}

function scrollsFreely(dir) {
  if (!freeZone) return false;
  const y = scrollY;
  const inside = y >= freeZone.from - 3 && y <= freeZone.to + 3;
  const leaving = dir > 0 ? y >= freeZone.to - 3 : y <= freeZone.from + 3;
  return inside && !leaving;
}

function stopGlide() {
  glideId += 1;
  gliding = false;
  clearTimeout(restTimer);
}

/* per-frame scrollTo shakes the sticky game panels on phones, so there the browser animates the scroll itself */
let restTimer = 0;
function waitForRest() {
  clearTimeout(restTimer);
  restTimer = setTimeout(() => {
    gliding = false;
    anchorY = scrollY;
  }, 180);
}

function glideTo(top) {
  const id = ++glideId;
  const from = scrollY;
  const distance = Math.abs(top - from);
  if (distance < 2) return;
  if (touchScreen) {
    gliding = true;
    scrollTo({ top, behavior: 'smooth' });
    waitForRest();
    return;
  }
  const duration = Math.min(1500, 650 + distance * 0.2);
  const start = performance.now();
  gliding = true;
  const step = (now) => {
    if (id !== glideId) return;
    const x = clamp((now - start) / duration);
    /* linear: the same speed all the way to the stop, no slow-down at the end */
    scrollTo({ top: from + (top - from) * x, behavior: 'instant' });
    if (x < 1) {
      requestAnimationFrame(step);
    } else {
      gliding = false;
      anchorY = scrollY;
    }
  };
  requestAnimationFrame(step);
}

let lastWheel = 0;
let lastDelta = 0;
addEventListener('wheel', (e) => {
  if (e.ctrlKey || !canSnap() || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  const now = performance.now();
  const delta = Math.abs(e.deltaY);
  /* trackpad inertia keeps firing with shrinking deltas; only a pause or a new push is a new gesture */
  const newGesture = now - lastWheel > 140 || delta > lastDelta * 1.6 + 8;
  lastWheel = now;
  lastDelta = delta;
  const dir = Math.sign(e.deltaY);
  if (!dir || scrollsFreely(dir)) return;
  e.preventDefault();
  if (!gliding && newGesture) glideTo(nextStop(scrollY, dir));
}, { passive: false });

const STEP_KEYS = { ArrowDown: 1, PageDown: 1, ' ': 1, ArrowUp: -1, PageUp: -1 };
addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const dir = STEP_KEYS[e.key] * (e.shiftKey ? -1 : 1);
  if (!dir || !canSnap() || scrollsFreely(dir)) return;
  e.preventDefault();
  if (!gliding) glideTo(nextStop(scrollY, dir));
});

/* touch: the page follows the finger, and on release it goes straight on to the next stop.
   Letting the browser's momentum run first makes it slow down short of the stop, pause, then start again */
let touchY = 0;
let drag = null;
let ownTouch = false;
addEventListener('touchstart', (e) => {
  stopGlide();
  touching = true;
  userScrolled = true;
  anchorY = scrollY;
  touchY = e.touches[0].clientY;
  drag = null;
  ownTouch = e.touches.length === 1 && !e.target.closest?.('.rail');
}, { passive: true });
addEventListener('touchmove', (e) => {
  if (!ownTouch || !canSnap() || e.touches.length > 1) return;
  const dy = touchY - e.touches[0].clientY;
  if (!drag) {
    const dir = Math.sign(dy);
    if (!dir) return;
    if (scrollsFreely(dir)) { ownTouch = false; return; }
    drag = { from: scrollY, base: dy, min: nextStop(scrollY, -1), max: nextStop(scrollY, 1) };
  }
  if (e.cancelable) e.preventDefault();
  scrollTo({ top: clamp(drag.from + dy - drag.base, drag.min, drag.max), behavior: 'instant' });
}, { passive: false });
function endTouch() {
  touching = false;
  if (drag) {
    const { from } = drag;
    const moved = scrollY - from;
    const nearest = snapStops.reduce((a, b) => (Math.abs(b - scrollY) < Math.abs(a - scrollY) ? b : a));
    drag = null;
    userScrolled = false;
    glideTo(Math.abs(moved) < 24 ? nearest : nextStop(from, Math.sign(moved)));
    return;
  }
  queueSettle();
}
addEventListener('touchend', endTouch, { passive: true });
addEventListener('touchcancel', endTouch, { passive: true });

/* leave a drag on the scrollbar alone */
addEventListener('mousedown', (e) => {
  if (e.clientX >= root.clientWidth) draggingBar = true;
});
addEventListener('pointermove', (e) => {
  if (e.buttons === 0) draggingBar = false;
}, { passive: true });

/* touch ends on its own momentum, so finish the move once the page comes to rest */
let settleTimer = 0;
function queueSettle() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, 130);
}
function settle() {
  if (!canSnap() || gliding || touching || draggingBar || !userScrolled) return;
  const y = scrollY;
  const moved = y - anchorY;
  if (snapStops.some((s) => Math.abs(s - y) < 4) || scrollsFreely(Math.sign(moved) || 1)) {
    anchorY = y;
    return;
  }
  userScrolled = false;
  const nearest = snapStops.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
  glideTo(Math.abs(moved) < 24 ? nearest : nextStop(y, Math.sign(moved)));
}
addEventListener('scroll', () => {
  if (!gliding) queueSettle();
  else if (touchScreen) waitForRest();
}, { passive: true });

/* in-page links land on the same stops as scrolling */
document.addEventListener('click', (e) => {
  const link = e.target.closest?.('a[href^="#"]');
  if (!link || !canSnap()) return;
  const targets = { '#top': 0, '#about': freeZone ? freeZone.from : stops[1], '#games': gamesStop, '#contact': stops[stops.length - 1] };
  const top = link.dataset.stop ? stops[link.dataset.stop] : targets[link.getAttribute('href')];
  if (top === undefined) return;
  e.preventDefault();
  glideTo(top);
});

/* rail scrubbing: press a dot, slide up or down to see where you'll land, release to go there */
const railTip = document.createElement('b');
railTip.className = 'rail-tip';
railTip.setAttribute('aria-hidden', 'true');
rail.append(railTip);
let scrubbing = false;
let picked = -1;
function pickAt(y) {
  const i = railLinks.reduce((best, a, j) => {
    const r = a.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - y);
    return d < best.d ? { j, d } : best;
  }, { j: 0, d: Infinity }).j;
  if (i === picked) return;
  picked = i;
  railLinks.forEach((a, j) => a.classList.toggle('pick', j === i));
  const a = railLinks[i];
  railTip.textContent = stageEls[i].dataset.label;
  railTip.style.top = `${a.offsetTop + a.offsetHeight / 2}px`;
}
function endScrub(go) {
  if (!scrubbing) return;
  scrubbing = false;
  rail.classList.remove('scrubbing');
  railLinks.forEach((a) => a.classList.remove('pick'));
  if (go && picked >= 0) {
    const top = stops[picked];
    if (canSnap()) glideTo(top);
    else scrollTo({ top, behavior: 'instant' });
  }
  picked = -1;
}
rail.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  scrubbing = true;
  picked = -1;
  pickAt(e.clientY);
  rail.classList.add('scrubbing');
  try { rail.setPointerCapture(e.pointerId); } catch {}
});
rail.addEventListener('pointermove', (e) => { if (scrubbing) pickAt(e.clientY); });
rail.addEventListener('pointerup', () => endScrub(true));
rail.addEventListener('pointercancel', () => endScrub(false));
/* the pointer handlers navigate; let only keyboard clicks (detail 0) through to the link handler */
rail.addEventListener('click', (e) => {
  if (e.detail === 0) return;
  e.preventDefault();
  e.stopPropagation();
});

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
