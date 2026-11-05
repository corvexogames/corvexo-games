import * as THREE from '../vendor/three.bundle.min.js';

const { EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass } = THREE;

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (x) => x * x * (3 - 2 * x);
const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

const VIOLET = 0x8b5cf6;
const EMBER = 0xfb923c;

/* where each world sits in the system, and which side of the screen it takes */
const WORLDS = {
  nebula: { r: 32, a: -30, side: 1, color: 0xa78bfa, far: 21 },
  orbit: { r: 44, a: 50, side: -1, color: 0xf2a06b, far: 21 },
  siege: { r: 56, a: 130, side: 1, color: 0xff7a3c, far: 25 },
  parketo: { r: 68, a: 210, side: -1, color: 0xb9cf95, far: 27 },
  next: { r: 80, a: 285, side: 0, color: 0x8ea2ff, far: 19 },
};

const MOODS = {
  hero: { base: 0x06040f, a: 0x5b2bd6, b: 0xd9641f },
  about: { base: 0x05040f, a: 0x3f27b8, b: 0x8b3fd1 },
  nebula: { base: 0x06041a, a: 0x6d3af0, b: 0x2a54e8 },
  orbit: { base: 0x0d0610, a: 0xb4541c, b: 0x5a2a9a },
  siege: { base: 0x0e0508, a: 0xc8501a, b: 0x7a1f1f },
  parketo: { base: 0x120a08, a: 0xb9652f, b: 0x5c7a4a },
  next: { base: 0x04051a, a: 0x2e3fd0, b: 0x6b2fd6 },
  contact: { base: 0x06040f, a: 0x5b2bd6, b: 0xd9641f },
};

const NOISE = /* glsl */ `
  float hash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
  float noise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
  float fbm(vec3 p,int o){float v=0.,a=.5;for(int i=0;i<o;i++){v+=a*noise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return v;}
`;

function canvasTexture(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const glowMap = canvasTexture(128, 128, (g, w) => {
  const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,.42)');
  grad.addColorStop(0.6, 'rgba(255,255,255,.08)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
});

function glow(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowMap, color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(size);
  return s;
}

function ring(radius, tube, color, opacity = 1) {
  return new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 8, 180),
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: opacity >= 1 }),
  );
}

/* a circle of short dashes in the XY plane */
function dashRing(radius, count, length, thick, material) {
  const geo = new THREE.CapsuleGeometry(thick, length, 3, 8);
  const mesh = new THREE.InstancedMesh(geo, material, count);
  const m = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    m.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    m.rotation.z = a;
    m.updateMatrix();
    mesh.setMatrixAt(i, m.matrix);
  }
  return mesh;
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/* fresnel halo around a sphere */
function halo(radius, color, power = 3, strength = 1.4) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 32),
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: power }, uStrength: { value: strength } },
      vertexShader: 'varying vec3 vN;varying vec3 vV;void main(){vec4 p=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
      fragmentShader: 'uniform vec3 uColor;uniform float uPower;uniform float uStrength;varying vec3 vN;varying vec3 vV;void main(){float f=pow(clamp(dot(vN,vV),0.,1.),uPower);gl_FragColor=vec4(uColor*uStrength,f);}',
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
}

/* tiny auto-battle shared by Little Orbit and Orbital Siege: a gun shoots whatever is closest */
function makeBattle(parent, { enemies, shotMaterial, shotSize = 0.045, rMin, rMax, cooldown, shotSpeed = 13, flashColor }) {
  const foes = enemies.map((mesh) => ({ mesh, a: rand(0, TAU), r: rand(rMin + 1, rMax), spin: rand(1, 2.4) }));
  foes.forEach((f) => parent.add(f.mesh));
  const shots = Array.from({ length: 16 }, () => ({ life: 0, x: 0, y: 0, vx: 0, vy: 0 }));
  const bolts = new THREE.InstancedMesh(new THREE.CapsuleGeometry(shotSize, shotSize * 6, 3, 6), shotMaterial, shots.length);
  bolts.frustumCulled = false;
  parent.add(bolts);
  const flash = glow(flashColor, 0, 0);
  parent.add(flash);
  let flashLife = 0;
  let cool = 0.4;
  const m = new THREE.Object3D();

  return function update(dt, gx, gy, muzzle = 0) {
    let target = foes[0];
    let best = Infinity;
    for (const f of foes) {
      f.a += dt * 0.22;
      f.r -= dt * 0.55;
      if (f.r < rMin) { f.r = rMax; f.a = rand(0, TAU); }
      const x = Math.cos(f.a) * f.r;
      const y = Math.sin(f.a) * f.r;
      f.mesh.position.set(x, y, 0);
      const d = Math.hypot(x - gx, y - gy);
      if (d < best) { best = d; target = f; }
    }
    const aim = Math.atan2(target.mesh.position.y - gy, target.mesh.position.x - gx);

    let fired = false;
    cool -= dt;
    if (cool <= 0) {
      const s = shots.find((o) => o.life <= 0);
      if (s) {
        cool = cooldown;
        fired = true;
        s.life = 1.2;
        s.x = gx + Math.cos(aim) * muzzle;
        s.y = gy + Math.sin(aim) * muzzle;
        s.vx = Math.cos(aim) * shotSpeed;
        s.vy = Math.sin(aim) * shotSpeed;
      }
    }
    shots.forEach((s, i) => {
      if (s.life > 0) {
        s.life -= dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        for (const f of foes) {
          if (Math.hypot(f.mesh.position.x - s.x, f.mesh.position.y - s.y) < 0.5) {
            flash.position.set(s.x, s.y, 0.1);
            flashLife = 1;
            f.r = rMax + rand(0, 2);
            f.a = rand(0, TAU);
            s.life = 0;
            break;
          }
        }
      }
      m.position.set(s.x, s.y, 0);
      m.rotation.z = Math.atan2(s.vy, s.vx) - Math.PI / 2;
      m.scale.setScalar(s.life > 0 ? 1 : 0);
      m.updateMatrix();
      bolts.setMatrixAt(i, m.matrix);
    });
    bolts.instanceMatrix.needsUpdate = true;

    flashLife = Math.max(0, flashLife - dt * 3);
    flash.material.opacity = flashLife;
    flash.scale.setScalar((1 - flashLife) * 2.6 + 0.4);
    return { aim, fired };
  };
}

/* ------- the Corvexo logo as a physical object ------- */
function buildCore() {
  const g = new THREE.Group();
  const violetMetal = new THREE.MeshPhysicalMaterial({ color: VIOLET, metalness: 0.85, roughness: 0.26, emissive: 0x7c3aed, emissiveIntensity: 0.65, clearcoat: 1 });
  const emberMat = new THREE.MeshStandardMaterial({ color: EMBER, emissive: EMBER, emissiveIntensity: 1.15, roughness: 0.35 });
  const hotMat = new THREE.MeshBasicMaterial({ color: hdr(0xffe4cc, 3) });

  g.add(new THREE.Mesh(new THREE.TorusGeometry(2, 0.09, 24, 200), violetMetal));

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(1.06, 64, 48),
    new THREE.MeshPhysicalMaterial({ color: 0x1a0e2e, roughness: 0.2, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.15 }),
  );
  g.add(ball);
  g.add(new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.05, 16, 120), violetMetal));

  const dash = dashRing(1.55, 36, 0.055, 0.016, new THREE.MeshBasicMaterial({ color: hdr(0xa35ef0, 1.6) }));
  g.add(dash);

  const tri = new THREE.Shape();
  tri.moveTo(-0.375, -0.575);
  tri.lineTo(0.725, 0);
  tri.lineTo(-0.375, 0.575);
  tri.closePath();
  const playGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4 });
  const play = new THREE.Mesh(playGeo, emberMat);
  play.position.z = 0.86;
  g.add(play);
  const playGlow = glow(EMBER, 3, 0.22);
  playGlow.position.z = 1.2;
  g.add(playGlow);

  const nodes = [
    [0, 2, 0.11, EMBER],
    [2, 0, 0.2, EMBER],
    [-2, 0, 0.13, 0x7c3aed],
  ];
  for (const [x, y, r, c] of nodes) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.6 }));
    n.position.set(x, y, 0);
    g.add(n);
    if (c === EMBER) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(r * 0.46, 16, 12), hotMat);
      h.position.set(x, y, r * 0.75);
      g.add(h);
    }
    const halo2 = glow(c, r * 9, 0.42);
    halo2.position.set(x, y, 0);
    g.add(halo2);
  }

  /* the tilted orbit that threads through the wordmark */
  const orbit = new THREE.Group();
  orbit.rotation.x = Math.PI / 2 - 0.26;
  const spin = dashRing(2.68, 54, 0.14, 0.022, new THREE.MeshBasicMaterial({ color: hdr(EMBER, 2) }));
  orbit.add(spin);
  const rider = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), hotMat);
  rider.position.x = 2.68;
  const riderGlow = glow(EMBER, 1.4, 0.8);
  riderGlow.position.x = 2.68;
  const riderPivot = new THREE.Group();
  riderPivot.add(rider, riderGlow);
  orbit.add(riderPivot);
  g.add(orbit);

  const rimLight = glow(0x7c3aed, 12, 0.2);
  rimLight.position.z = -1.4;
  g.add(rimLight);

  return {
    group: g,
    update(dt, t, pointer) {
      g.rotation.y = Math.sin(t * 0.35) * 0.3 + pointer.x * 0.35;
      g.rotation.x = Math.cos(t * 0.27) * 0.08 - pointer.y * 0.22;
      spin.rotation.z = t * 0.25;
      riderPivot.rotation.z = -t * 0.8;
      dash.rotation.z = -t * 0.12;
      play.rotation.z = Math.sin(t * 0.6) * 0.04;
    },
  };
}

/* ------- the wordmark, in the scene so the orbit can pass in front of it ------- */
function buildTitle() {
  const W = 2048;
  const H = 640;
  const tex = canvasTexture(W, H, (g) => {
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    if ('fontKerning' in g) g.fontKerning = 'none';
    let size = 330;
    g.font = `800 ${size}px Unbounded`;
    size *= 1960 / g.measureText('CORVEXO').width;
    g.font = `800 ${size}px Unbounded`;
    g.fillStyle = '#f00';
    g.fillText('CORVEXO', W / 2, 400);
    g.globalCompositeOperation = 'lighter';
    g.font = '600 62px Unbounded';
    if ('letterSpacing' in g) g.letterSpacing = '46px';
    g.fillStyle = '#0f0';
    g.fillText('GAMES', W / 2 + 23, 560);
  }, false);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uMap: { value: tex }, uReveal: { value: 0 }, uFade: { value: 1 }, uTime: { value: 0 }, uLight: { value: new THREE.Vector2() } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;uniform float uReveal,uFade,uTime;uniform vec2 uLight;varying vec2 vUv;
      void main(){
        vec2 m=texture2D(uMap,vUv).rg;
        float sweep=smoothstep(vUv.x*1.3-.3,vUv.x*1.3-.1,uReveal*1.5-.2);
        float y=vUv.y;
        vec3 word=mix(vec3(.5,.4,.92),vec3(.86,.84,.96),smoothstep(.32,.8,y));
        float d=distance(vUv*vec2(3.2,1.),uLight*vec2(3.2,1.));
        word+=vec3(1.,.55,.25)*exp(-d*d*5.)*.5;
        float band=smoothstep(.06,.0,abs(fract(vUv.x*.5-uTime*.07+y*.14)-.5));
        word+=vec3(.5,.35,1.)*band*.35;
        vec3 col=word*m.r+vec3(.98,.57,.24)*.95*m.g;
        gl_FragColor=vec4(col,max(m.r,m.g)*sweep*uFade);
      }`,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(1, H / W), material);
}

/* ------- Nebula Blast ------- */
function buildNebula() {
  const g = new THREE.Group();
  const plasma = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vP;varying vec3 vN;varying vec3 vV;void main(){vP=position;vec4 p=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
    fragmentShader: `uniform float uTime;varying vec3 vP;varying vec3 vN;varying vec3 vV;${NOISE}
      void main(){
        vec3 p=normalize(vP)*2.1;
        float w=fbm(p+vec3(0.,uTime*.12,uTime*.08),4);
        float n=fbm(p*1.6+w*2.4-vec3(uTime*.09),4);
        vec3 col=mix(vec3(.05,.01,.26),vec3(.3,.08,.86),smoothstep(.3,.56,n));
        col=mix(col,vec3(1.2,.8,1.5),smoothstep(.56,.74,n));
        float f=pow(1.-clamp(dot(vN,vV),0.,1.),2.6);
        col+=vec3(.5,.26,1.)*f*1.3;
        gl_FragColor=vec4(col,1.);
      }`,
  });
  const star = new THREE.Mesh(new THREE.SphereGeometry(2.1, 72, 54), plasma);
  g.add(star, halo(3.1, 0x8b5cf6, 3.2, 1));
  const coreGlow = glow(0x8b5cf6, 13, 0.3);
  g.add(coreGlow);

  /* galaxy swirl */
  const N = 2600;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const arm = i % 3;
    const r = 3 + Math.pow(Math.random(), 1.6) * 7;
    const a = (arm / 3) * TAU + r * 0.62 + rand(-0.32, 0.32);
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.sin(a) * r;
    pos[i * 3 + 2] = rand(-0.28, 0.28);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const swirlMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: `uniform float uTime,uPx;attribute float aSeed;varying vec3 vC;
      void main(){float r=length(position.xy);float a=uTime*(.5/r+.02);float c=cos(a),s=sin(a);
        vec3 p=vec3(position.x*c-position.y*s,position.x*s+position.y*c,position.z);
        vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
        gl_PointSize=uPx*(.7+aSeed*1.7)*(22./-mv.z);
        vC=mix(vec3(.5,.34,1.),vec3(1.,.62,.9),aSeed*aSeed)*(.5+aSeed);}`,
    fragmentShader: 'varying vec3 vC;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(vC,smoothstep(.5,.05,d)*.8);}',
  });
  const swirl = new THREE.Points(geo, swirlMat);
  swirl.frustumCulled = false;

  const disc = new THREE.Group();
  disc.rotation.set(-1.05, 0.18, 0);
  disc.add(swirl);
  g.add(disc);

  /* the balls from the icon, each on a tilted orbit */
  const orbs = [
    { color: 0xb79dff, r: 4.6, size: 0.48, speed: 0.42, tilt: [-1.0, 0.35], phase: 0.6 },
    { color: 0xff9440, r: 5.8, size: 0.34, speed: -0.3, tilt: [-1.2, -0.42], phase: 2.2 },
    { color: 0x34d399, r: 3.6, size: 0.3, speed: 0.6, tilt: [-0.75, 0.15], phase: 4.2 },
  ].map((o) => {
    const pivot = new THREE.Group();
    pivot.rotation.set(o.tilt[0], o.tilt[1], 0);
    pivot.add(ring(o.r, 0.012, hdr(0x8b7be0, 0.9), 0.55));
    const holder = new THREE.Group();
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(o.size, 32, 24),
      new THREE.MeshPhysicalMaterial({ color: o.color, roughness: 0.15, clearcoat: 1, emissive: o.color, emissiveIntensity: 0.45 }),
    );
    ball.position.x = o.r;
    const aura = glow(o.color, o.size * 6.5, 0.6);
    aura.position.x = o.r;
    holder.add(ball, aura);
    pivot.add(holder);
    g.add(pivot);
    return { ...o, holder };
  });

  return {
    group: g,
    pixelMaterials: [swirlMat],
    update(dt, t) {
      plasma.uniforms.uTime.value = t;
      swirlMat.uniforms.uTime.value = t * 2;
      star.rotation.y = t * 0.08;
      orbs.forEach((o) => { o.holder.rotation.z = o.phase + t * o.speed; });
    },
  };
}

/* ------- Little Orbit ------- */
function buildOrbit() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.x = -0.5;
  g.add(inner);

  const craters = Array.from({ length: 46 }, () => ({ x: Math.random(), y: rand(0.14, 0.86), r: rand(0.008, 0.052) }));
  const paint = (g2, w, h, height) => {
    g2.fillStyle = height ? '#808080' : '#c4713c';
    g2.fillRect(0, 0, w, h);
    if (!height) {
      for (let i = 0; i < 90; i++) {
        g2.fillStyle = `rgba(${i % 2 ? '92,42,16' : '236,160,100'},.07)`;
        g2.beginPath();
        g2.ellipse(Math.random() * w, Math.random() * h, rand(40, 180), rand(14, 60), 0, 0, TAU);
        g2.fill();
      }
    }
    for (const c of craters) {
      const R = c.r * w;
      for (const dx of [-w, 0, w]) {
        const x = c.x * w + dx;
        const y = c.y * h;
        const grad = g2.createRadialGradient(x, y, 0, x, y, R);
        if (height) {
          grad.addColorStop(0, '#303030');
          grad.addColorStop(0.72, '#3a3a3a');
          grad.addColorStop(0.88, '#c8c8c8');
          grad.addColorStop(1, '#808080');
        } else {
          grad.addColorStop(0, '#8f4d24');
          grad.addColorStop(0.75, '#9d5729');
          grad.addColorStop(0.9, '#d98c54');
          grad.addColorStop(1, 'rgba(217,140,84,0)');
        }
        g2.fillStyle = grad;
        g2.beginPath();
        g2.ellipse(x, y, R, R * 0.92, 0, 0, TAU);
        g2.fill();
      }
    }
  };
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(2.6, 96, 64),
    new THREE.MeshStandardMaterial({
      map: canvasTexture(1536, 768, (c, w, h) => paint(c, w, h, false)),
      bumpMap: canvasTexture(1536, 768, (c, w, h) => paint(c, w, h, true), false),
      bumpScale: 3,
      roughness: 0.82,
    }),
  );
  g.add(planet, halo(3.35, 0xf08a4a, 3.4, 0.95));

  inner.add(dashRing(4.3, 40, 0.2, 0.03, new THREE.MeshBasicMaterial({ color: hdr(0xf5e4d3, 1.2) })));

  const cream = new THREE.MeshStandardMaterial({ color: 0xf8ead8, roughness: 0.4, emissive: 0xf8ead8, emissiveIntensity: 0.28 });
  const gun = new THREE.Group();
  gun.add(new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.13, 16, 32), cream));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshStandardMaterial({ color: EMBER, emissive: EMBER, emissiveIntensity: 2 }));
  gun.add(dot);
  const barrel = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.42, 4, 10), cream);
  barrel.position.y = 0.5;
  const barrelPivot = new THREE.Group();
  barrelPivot.add(barrel);
  gun.add(barrelPivot);
  inner.add(gun);

  const foeGeo = new THREE.TorusGeometry(0.2, 0.11, 12, 24);
  const foeMat = new THREE.MeshStandardMaterial({ color: 0xff9d5c, emissive: EMBER, emissiveIntensity: 0.7 });
  const fight = makeBattle(inner, {
    enemies: Array.from({ length: 6 }, () => new THREE.Mesh(foeGeo, foeMat)),
    shotMaterial: new THREE.MeshBasicMaterial({ color: hdr(0xffe4cc, 3.5) }),
    rMin: 4.9, rMax: 10, cooldown: 0.55, flashColor: EMBER,
  });

  return {
    group: g,
    update(dt, t) {
      planet.rotation.y = t * 0.1;
      const a = t * 0.34;
      const x = Math.cos(a) * 4.3;
      const y = Math.sin(a) * 4.3;
      gun.position.set(x, y, 0);
      const { aim } = fight(dt, x, y, 0.8);
      barrelPivot.rotation.z = aim - Math.PI / 2;
    },
  };
}

/* ------- Orbital Siege ------- */
function buildSiege() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.x = -0.56;
  g.add(inner);

  const dark = new THREE.MeshStandardMaterial({ color: 0x4a4a55, metalness: 0.6, roughness: 0.45 });
  const mid = new THREE.MeshStandardMaterial({ color: 0x75757f, metalness: 0.55, roughness: 0.42 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xe8591a, emissive: 0xf0600f, emissiveIntensity: 0.55, roughness: 0.4 });
  const glowTrim = new THREE.MeshBasicMaterial({ color: hdr(0xfb7a2c, 1.3) });

  const cyl = (r, h, mat) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 96), mat);
    c.rotation.x = Math.PI / 2;
    return c;
  };
  const hull = cyl(3.1, 0.4, dark);
  hull.position.z = -0.1;
  inner.add(hull);
  const deck = cyl(2.05, 0.24, mid);
  deck.position.z = 0.16;
  inner.add(deck);

  inner.add(new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.15, 16, 160), dark));
  inner.add(new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.045, 12, 160), glowTrim));
  const rimA = new THREE.Mesh(new THREE.TorusGeometry(3.14, 0.07, 12, 160), trim);
  rimA.position.z = 0.1;
  const rimB = new THREE.Mesh(new THREE.TorusGeometry(2.08, 0.05, 12, 120), trim);
  rimB.position.z = 0.28;
  inner.add(rimA, rimB);

  /* spokes tying the outer ring to the hull */
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.26;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.13, 0.13), dark);
    spoke.position.set(Math.cos(a) * 3.8, Math.sin(a) * 3.8, 0);
    spoke.rotation.z = a;
    inner.add(spoke);
  }

  /* hatch lights, as on the icon */
  for (const x of [-0.72, 0, 0.72]) {
    const pip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), trim);
    pip.position.set(x, -2.6, 0.14);
    pip.scale.z = 0.4;
    inner.add(pip);
  }

  const turret = new THREE.Group();
  turret.position.z = 0.42;
  const base = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.28, 16, 48), trim);
  turret.add(base);
  const socket = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16), dark);
  turret.add(socket);
  const barrels = new THREE.Group();
  for (const [y, len, r] of [[1.0, 0.9, 0.34], [1.72, 0.5, 0.42], [2.2, 0.5, 0.26]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 24), y === 1.72 ? trim : mid);
    b.position.y = y;
    barrels.add(b);
  }
  turret.add(barrels);
  const muzzle = glow(0xffd9a8, 0, 0);
  muzzle.position.set(0, 2.75, 0);
  turret.add(muzzle);
  inner.add(turret);

  const finShape = new THREE.Shape();
  finShape.moveTo(0.36, 0);
  finShape.lineTo(-0.28, 0.25);
  finShape.lineTo(-0.14, 0);
  finShape.lineTo(-0.28, -0.25);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.1, bevelEnabled: false });
  const finMat = new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xe22a1c, emissiveIntensity: 1.5 });
  const fleet = Array.from({ length: 7 }, () => new THREE.Mesh(finGeo, finMat));
  const fight = makeBattle(inner, {
    enemies: fleet,
    shotMaterial: new THREE.MeshBasicMaterial({ color: hdr(0xffc48a, 3.4) }),
    shotSize: 0.055, rMin: 5, rMax: 11, cooldown: 0.42, shotSpeed: 16, flashColor: 0xff7a3c,
  });

  let kick = 0;
  let flash = 0;
  return {
    group: g,
    update(dt, t) {
      inner.rotation.z = Math.sin(t * 0.1) * 0.08;
      const { aim, fired } = fight(dt, 0, 0, 2.8);
      let delta = aim - Math.PI / 2 - turret.rotation.z;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      turret.rotation.z += delta * (1 - Math.exp(-dt * 12));
      if (fired) { kick = 1; flash = 1; }
      kick = Math.max(0, kick - dt * 7);
      flash = Math.max(0, flash - dt * 9);
      barrels.position.y = -kick * 0.18;
      muzzle.material.opacity = flash;
      muzzle.scale.setScalar(flash * 2.8);
      for (const f of fleet) f.rotation.z = Math.atan2(f.position.y, f.position.x) + Math.PI;
    },
  };
}

/* ------- Parketo: a little parking lot adrift in space ------- */
function buildParketo() {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.x = 0.92;
  inner.scale.setScalar(0.72);
  g.add(inner);
  const S = 10;
  const tileShape = roundedRect(S, S, 1.5);

  const side = new THREE.Mesh(
    new THREE.ExtrudeGeometry(tileShape, { depth: 0.7, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3 }),
    new THREE.MeshStandardMaterial({ color: 0xa85a30, roughness: 0.75 }),
  );
  side.rotation.x = Math.PI / 2;
  side.position.y = -0.1;
  inner.add(side);

  const lot = canvasTexture(1024, 1024, (c, w) => {
    c.fillStyle = '#d4824f';
    c.fillRect(0, 0, w, w);
    c.fillStyle = '#f5a26e';
    c.beginPath();
    c.arc(w * 0.82, w * 0.14, w * 0.46, 0, TAU);
    c.fill();
    c.fillStyle = '#93a678';
    c.beginPath();
    c.arc(w * 0.06, w * 0.96, w * 0.32, 0, TAU);
    c.fill();
    c.strokeStyle = '#f7e6d3';
    c.lineCap = 'round';
    c.lineWidth = 26;
    for (const x of [0.325, 0.675]) {
      c.beginPath();
      c.moveTo(w * x, w * 0.1);
      c.lineTo(w * x, w * 0.56);
      c.stroke();
    }
  });
  lot.repeat.set(1 / S, 1 / S);
  lot.offset.set(0.5, 0.5);
  lot.wrapS = lot.wrapT = THREE.ClampToEdgeWrapping;
  const top = new THREE.Mesh(new THREE.ShapeGeometry(tileShape, 16), new THREE.MeshStandardMaterial({ map: lot, color: 0xb8b8b8, roughness: 0.85 }));
  top.rotation.x = -Math.PI / 2;
  top.receiveShadow = true;
  inner.add(top);

  /* sign */
  const signTex = canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#5a6a42';
    c.fillRect(0, 0, w, w);
    c.fillStyle = '#f7e6d3';
    c.font = '800 168px Unbounded';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('P', w / 2, w / 2 + 10);
  });
  signTex.center.set(0.5, 0.5);
  signTex.rotation = Math.PI;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3, 16), new THREE.MeshStandardMaterial({ color: 0xf7e6d3, roughness: 0.5 }));
  pole.position.set(-3.5, 1.5, 0.4);
  pole.castShadow = true;
  inner.add(pole);
  const sign = new THREE.Mesh(
    new THREE.CylinderGeometry(0.82, 0.82, 0.12, 48),
    [new THREE.MeshStandardMaterial({ color: 0x5a6a42 }), new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.08 }), new THREE.MeshStandardMaterial({ color: 0x5a6a42 })],
  );
  sign.rotation.set(Math.PI / 2 - 0.92, 0, 0);
  sign.position.set(-3.5, 3.3, 0.4);
  sign.castShadow = true;
  inner.add(sign);

  /* car, nose towards -Z */
  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xcfc2b0, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const extrudeUp = (w, l, r, h, mat, y) => {
    const m = new THREE.Mesh(
      new THREE.ExtrudeGeometry(roundedRect(w, l, r), { depth: h, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 4 }),
      mat,
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.castShadow = true;
    car.add(m);
    return m;
  };
  extrudeUp(1.6, 2.9, 0.48, 0.34, paint, 0.26);
  extrudeUp(1.3, 1.55, 0.42, 0.26, new THREE.MeshPhysicalMaterial({ color: 0x4a2612, roughness: 0.12, metalness: 0.2, clearcoat: 1 }), 0.68);
  const roof = extrudeUp(1.14, 1.1, 0.36, 0.05, paint, 0.98);
  roof.position.z = 0.04;

  const wheelGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.22, 24);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1c1a1e, roughness: 0.7 });
  const wheels = [[-0.8, -0.95], [0.8, -0.95], [-0.8, 0.95], [0.8, 0.95]].map(([x, z]) => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.27, z);
    w.castShadow = true;
    car.add(w);
    return w;
  });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffd2b0, emissive: 0xffb27a, emissiveIntensity: 1.2 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xff6a4a, emissive: 0xff3a1e, emissiveIntensity: 0.6 });
  for (const x of [-0.5, 0.5]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.05), lamp);
    l.position.set(x, 0.5, -1.5);
    car.add(l);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.05), tail);
    r.position.set(x, 0.5, 1.5);
    car.add(r);
  }
  inner.add(car);

  return {
    group: g,
    inner,
    update(dt, t) {
      inner.rotation.z = Math.sin(t * 0.35) * 0.03;
      inner.position.y = Math.sin(t * 0.7) * 0.12;
      inner.rotation.y = Math.sin(t * 0.23) * 0.14 + 0.2;
      /* parked, reverse out, hold, drive back in */
      const u = (t * 0.13) % 1;
      const out = u < 0.2 ? 0 : u < 0.45 ? smooth((u - 0.2) / 0.25) : u < 0.6 ? 1 : u < 0.9 ? 1 - smooth((u - 0.6) / 0.3) : 0;
      const prev = car.position.z;
      car.position.set(out * out * 1.3, 0, -1.7 + out * 4.4);
      car.rotation.y = -out * out * 0.72;
      const roll = (car.position.z - prev) / 0.27;
      wheels.forEach((w) => { w.rotation.x += roll; });
      tail.emissiveIntensity = Math.abs(car.position.z - prev) > 0.0005 ? 2 : 0.4;
    },
  };
}

/* ------- what comes next: an unfinished world, still a wireframe ------- */
function buildNext() {
  const g = new THREE.Group();
  const outer = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.6, 2)),
    new THREE.LineBasicMaterial({ color: hdr(0x8ea2ff, 1.3), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  const mid = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(2.1, 0)),
    new THREE.LineBasicMaterial({ color: hdr(EMBER, 1.9), transparent: true, opacity: 0.9 }),
  );
  const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshBasicMaterial({ color: hdr(0xffd9b8, 1.6) }));
  g.add(outer, mid, heart, glow(0x5a6dff, 9, 0.2));
  return {
    group: g,
    update(dt, t) {
      outer.rotation.set(t * 0.1, t * 0.16, 0);
      mid.rotation.set(-t * 0.28, t * 0.2, t * 0.1);
      heart.scale.setScalar(1 + Math.sin(t * 2.2) * 0.14);
    },
  };
}

function buildAsteroids(worldPositions, count) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  const offsets = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, rand(0.72, 1.18));
    const k = offsets.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a3246, roughness: 0.95, metalness: 0.1, flatShading: true }), count);
  mesh.frustumCulled = false;
  const m = new THREE.Object3D();
  const spot = new THREE.Vector3();
  const clearSpots = [[new THREE.Vector3(14, 3, 13), 13], [new THREE.Vector3(22, 0, 0), 11]];
  for (let i = 0; i < count; i++) {
    do {
      const belt = i % 4 === 3;
      const a = rand(0, TAU);
      const r = belt ? rand(36, 74) : rand(15, 26);
      spot.set(Math.cos(a) * r, rand(-4, 2.4), Math.sin(a) * r);
    } while (worldPositions.some((w) => w.distanceTo(spot) < 13) || clearSpots.some(([c, r]) => c.distanceTo(spot) < r));
    m.position.copy(spot);
    m.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
    m.scale.setScalar(Math.pow(Math.random(), 3) * 0.75 + 0.06);
    m.updateMatrix();
    mesh.setMatrixAt(i, m.matrix);
  }
  return mesh;
}

/* bakes three noise fields into a cube map once; the sky only recolours them per frame */
function bakeSky(renderer, size) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(
    new THREE.SphereGeometry(5, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 vD;${NOISE}
        void main(){vec3 d=normalize(vD);
          vec3 q=vec3(fbm(d*1.7+1.3,4),fbm(d*1.7+5.1,4),fbm(d*1.7+9.2,4));
          float a=smoothstep(.34,.82,fbm(d*2.1+q*1.9,6));
          float b=smoothstep(.38,.8,fbm(d*2.6-q*1.6+7.,6));
          float dust=smoothstep(.46,.72,fbm(d*3.4+q*2.4+3.,5));
          gl_FragColor=vec4(a,b,dust,1.);}`,
    }),
  ));
  new THREE.CubeCamera(0.1, 10, rt).update(renderer, s);
  return rt.texture;
}

export async function createScene(canvas, stageNames) {
  await Promise.all([document.fonts.load('800 200px Unbounded'), document.fonts.load('600 60px Unbounded')]);

  const mobile = matchMedia('(pointer:coarse)').matches || canvas.clientWidth < 760;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  let pixelRatio = Math.min(devicePixelRatio, mobile ? 1.5 : 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);

  /* image-based reflections from a small emissive room */
  {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x07060f);
    const panel = (color, k, x, y, z, s) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: hdr(color, k), side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(0x8b5cf6, 7, -7, 3, 3, 7);
    panel(EMBER, 7, 7, -2, 4, 6);
    panel(0xffffff, 6, 0, 8, 1, 5);
    panel(0x3d5bff, 4, 0, -6, -6, 8);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.05).texture;
    scene.environmentIntensity = 0.75;
    pmrem.dispose();
  }

  scene.add(new THREE.HemisphereLight(0x9aa8ff, 0x201028, 0.5));
  scene.add(new THREE.PointLight(0xffd8b0, 2.6, 0, 0));
  const fill = new THREE.DirectionalLight(0xcfd4ff, 0.7);
  fill.position.set(2, 4, 8);
  scene.add(fill);

  /* sky */
  const skyU = {
    uMap: { value: bakeSky(renderer, mobile ? 256 : 512) },
    uBase: { value: new THREE.Color() },
    uA: { value: new THREE.Color() },
    uB: { value: new THREE.Color() },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 24),
    new THREE.ShaderMaterial({
      uniforms: skyU, side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: 'varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `uniform samplerCube uMap;uniform vec3 uBase,uA,uB;varying vec3 vD;
        void main(){vec3 m=textureCube(uMap,normalize(vD)).rgb;
          vec3 c=uBase+uA*m.r*m.r*.5+uB*m.g*m.g*.42;
          c*=1.-m.b*.62;gl_FragColor=vec4(c,1.);}`,
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  /* far stars ride with the camera; only turning moves them */
  const starCount = mobile ? 2600 : 5200;
  const starPos = new Float32Array(starCount * 3);
  const starData = new Float32Array(starCount * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < starCount; i++) {
    v.randomDirection().multiplyScalar(rand(300, 800));
    v.toArray(starPos, i * 3);
    starData[i * 2] = Math.pow(Math.random(), 4) * 2.8 + 0.7;
    starData[i * 2 + 1] = Math.random();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('aData', new THREE.BufferAttribute(starData, 2));
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
    vertexShader: `uniform float uTime,uPx;attribute vec2 aData;varying vec3 vC;
      void main(){gl_Position=projectionMatrix*viewMatrix*vec4(position+cameraPosition,1.);
        gl_PointSize=aData.x*uPx;float tw=.72+.28*sin(uTime*(.6+aData.y*2.)+aData.y*40.);
        vec3 tint=aData.y<.16?vec3(1.,.72,.5):aData.y<.4?vec3(.74,.68,1.):vec3(1.);
        vC=tint*tw*(aData.x>2.?1.8:.9);}`,
    fragmentShader: 'varying vec3 vC;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(vC,smoothstep(.5,.1,d));}',
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  /* near dust wraps around the camera and stretches into streaks with speed */
  const dustCount = mobile ? 220 : 480;
  const dustPos = new Float32Array(dustCount * 6);
  const dustEnd = new Float32Array(dustCount * 2);
  for (let i = 0; i < dustCount; i++) {
    const x = rand(0, 90);
    const y = rand(0, 90);
    const z = rand(0, 90);
    dustPos.set([x, y, z, x, y, z], i * 6);
    dustEnd[i * 2 + 1] = 1;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('aEnd', new THREE.BufferAttribute(dustEnd, 1));
  const dustU = { uVel: { value: new THREE.Vector3() }, uPx: { value: 1 } };
  const dustVert = `uniform vec3 uVel;uniform float uPx;attribute float aEnd;varying float vA;
    void main(){vec3 p=mod(position-cameraPosition,90.)-45.+cameraPosition;
      vA=smoothstep(45.,18.,distance(p,cameraPosition));
      p-=uVel*aEnd;vec4 mv=viewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=uPx*14./max(1.,-mv.z);}`;
  const dustBase = { uniforms: dustU, vertexShader: dustVert, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const dustLines = new THREE.LineSegments(dustGeo, new THREE.ShaderMaterial({
    ...dustBase, fragmentShader: 'varying float vA;void main(){gl_FragColor=vec4(vec3(.85,.8,1.),vA*.9);}',
  }));
  const dustPoints = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
    ...dustBase, fragmentShader: 'varying float vA;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(vec3(.85,.8,1.),vA*smoothstep(.5,.1,d)*.8);}',
  }));
  dustLines.frustumCulled = dustPoints.frustumCulled = false;
  scene.add(dustLines, dustPoints);

  /* the system */
  const core = buildCore();
  scene.add(core.group);
  const title = buildTitle();
  scene.add(title);

  const pathMaterial = new THREE.LineBasicMaterial({ color: 0x9d8cf0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const builders = { nebula: buildNebula, orbit: buildOrbit, siege: buildSiege, parketo: buildParketo, next: buildNext };
  const worlds = {};
  for (const [name, cfg] of Object.entries(WORLDS)) {
    const a = THREE.MathUtils.degToRad(cfg.a);
    const pos = new THREE.Vector3(Math.cos(a) * cfg.r, 0, Math.sin(a) * cfg.r);
    const world = builders[name]();
    world.group.position.copy(pos);
    scene.add(world.group);

    const pathPts = Array.from({ length: 256 }, (_, i) => new THREE.Vector3(Math.cos((i / 256) * TAU) * cfg.r, 0, Math.sin((i / 256) * TAU) * cfg.r));
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pathPts), pathMaterial));

    const beacon = glow(cfg.color, 15, 0);
    beacon.position.copy(pos);
    scene.add(beacon);
    worlds[name] = { ...world, ...cfg, pos, beacon };
  }
  const beltPositions = Object.values(worlds).map((w) => w.pos);
  scene.add(buildAsteroids(beltPositions, mobile ? 150 : 320));

  /* Parketo gets the one shadow-casting light; it fades out everywhere else */
  const sun = new THREE.DirectionalLight(0xfff0dc, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
  sun.shadow.bias = -0.0006;
  sun.shadow.radius = 5;
  scene.add(sun, sun.target);

  /* post */
  const size = new THREE.Vector2();
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.34, 0.55, 1.05);
  composer.addPass(bloom);
  const lens = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uShift: { value: 0 }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: /* glsl */ `uniform sampler2D tDiffuse;uniform float uShift,uTime;varying vec2 vUv;
      float rnd(vec2 p){return fract(52.9829189*fract(dot(p+uTime*37.,vec2(.06711056,.00583715))));}
      void main(){vec2 c=vUv-.5;float r2=dot(c,c);vec2 s=c*r2*uShift;
        vec3 col=vec3(texture2D(tDiffuse,vUv+s).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-s).b);
        col*=1.-r2*1.05;col+=(rnd(gl_FragCoord.xy)-.5)*.016;gl_FragColor=vec4(col,1.);}`,
  });
  composer.addPass(lens);
  composer.addPass(new OutputPass());

  /* camera path through every stage; rebuilt on resize because framing depends on aspect */
  let posCurve;
  let lookCurve;
  let heroDist = 12.5;
  const up = new THREE.Vector3(0, 1, 0);

  function buildPath() {
    const aspect = camera.aspect;
    const portrait = aspect < 0.95;
    heroDist = portrait ? 12.6 / Math.max(aspect, 0.42) * 0.56 : Math.max(11.2, 12.4 / Math.min(aspect / 1.5, 1));
    const camPts = [];
    const lookPts = [];

    for (const name of stageNames) {
      if (name === 'hero') {
        camPts.push(new THREE.Vector3(0, 0, heroDist));
        lookPts.push(new THREE.Vector3(0, 0, 0));
      } else if (name === 'about') {
        camPts.push(new THREE.Vector3(14, 3, 13));
        lookPts.push(new THREE.Vector3(30, -3, -16));
      } else if (name === 'contact') {
        camPts.push(new THREE.Vector3(0, portrait ? 190 : 150, portrait ? 150 : 96));
        lookPts.push(new THREE.Vector3(0, 0, portrait ? -70 : -34));
      } else {
        const w = worlds[name];
        const dist = portrait ? w.far : w.side === 0 ? 17 : 15;
        const inward = w.pos.clone().normalize().negate();
        const across = new THREE.Vector3().crossVectors(up, inward);
        const cam = w.pos.clone()
          .addScaledVector(inward, dist * 0.92)
          .addScaledVector(across, dist * 0.34 * (w.side || 1))
          .addScaledVector(up, 2.2);
        const forward = w.pos.clone().sub(cam).normalize();
        const right = new THREE.Vector3().crossVectors(forward, up).normalize();
        const look = w.pos.clone();
        if (portrait) look.addScaledVector(up, -4.6);
        else if (w.side === 0) look.addScaledVector(up, -1.4);
        else look.addScaledVector(right, -w.side * Math.min(4.6, 3.1 * aspect));
        camPts.push(cam);
        lookPts.push(look);
        w.group.lookAt(cam);
        if (w.inner) {
          w.group.updateMatrixWorld(true);
          sun.position.copy(w.pos).add(new THREE.Vector3(0, 1, 0).applyQuaternion(w.group.quaternion).multiplyScalar(14)).add(right.clone().multiplyScalar(-6));
          sun.target.position.copy(w.pos);
        }
      }
    }
    posCurve = new THREE.CatmullRomCurve3(camPts, false, 'centripetal');
    lookCurve = new THREE.CatmullRomCurve3(lookPts, false, 'centripetal');

    /* hero composition */
    const vis = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const depth = heroDist + 1.2;
    const fw = vis * depth * aspect;
    const fh = vis * depth;
    const width = Math.min(fw * (portrait ? 0.94 : 0.84), fh * 1.9);
    title.scale.setScalar(width);
    title.position.set(0, portrait ? -fh * 0.13 : -fh * 0.17, -1.2);
    core.group.position.y = portrait ? fh * 0.11 : fh * 0.1;
    const s = portrait ? 1 : 0.96;
    core.group.scale.setScalar(s);
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    renderer.getDrawingBufferSize(size);
    const px = pixelRatio;
    starMat.uniforms.uPx.value = px;
    dustU.uPx.value = px;
    worlds.nebula.pixelMaterials.forEach((m) => { m.uniforms.uPx.value = px * (size.y / 900 / px + 0.3); });
    buildPath();
  }

  /* quality falls back in steps if the device can't keep up */
  let slowFrames = 0;
  let level = 0;
  function adapt(dt) {
    slowFrames = dt > 0.03 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
    if (slowFrames < 70 || level >= 3) return;
    slowFrames = 0;
    level += 1;
    if (level === 1 && pixelRatio > 1) pixelRatio = Math.max(1, pixelRatio - 0.4);
    if (level === 2) bloom.enabled = false;
    if (level === 3) pixelRatio = 0.8;
    renderer.setPixelRatio(pixelRatio);
    resize();
  }

  const look = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const moodA = new THREE.Color();
  const right = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const light = new THREE.Vector3();
  let time = 0;
  let intro = 0;
  const lastStage = stageNames.length - 1;
  const parketoIndex = stageNames.indexOf('parketo');

  function frame(dt, stage, pointer) {
    if (!posCurve) return;
    time += dt;
    intro = Math.min(1, intro + dt / 2.6);
    const eased = 1 - Math.pow(1 - intro, 3);

    const u = clamp(stage / lastStage);
    posCurve.getPoint(u, camera.position);
    lookCurve.getPoint(u, look);
    const heroWeight = clamp(1 - stage * 1.6);
    camera.position.z += (1 - eased) * 10 * heroWeight;
    camera.position.y += (1 - eased) * 2.4 * heroWeight;

    /* pointer parallax, gentler the farther we pull back */
    camera.matrixWorld.extractBasis(right, camUp, light);
    const sway = stage > lastStage - 0.6 ? 2.2 : 0.42;
    camera.position.addScaledVector(right, pointer.x * sway).addScaledVector(camUp, pointer.y * sway * 0.6);
    camera.lookAt(look);

    if (dt > 0) vel.lerp(light.copy(camera.position).sub(prevPos).divideScalar(dt), 1 - Math.exp(-dt * 10));
    prevPos.copy(camera.position);
    const speed = vel.length();
    dustU.uVel.value.copy(vel).multiplyScalar(0.09).clampLength(0, 14);
    camera.fov = 40 + clamp(speed / 90) * 9;
    camera.updateProjectionMatrix();
    lens.uniforms.uShift.value = 0.0035 + clamp(speed / 80) * 0.03;
    lens.uniforms.uTime.value = Math.floor(time * 24) % 64;

    const i = Math.min(lastStage - 1, Math.floor(stage));
    const f = stage - i;
    const a = MOODS[stageNames[i]];
    const b = MOODS[stageNames[i + 1]];
    skyU.uBase.value.setHex(a.base).lerp(moodA.setHex(b.base), f);
    skyU.uA.value.setHex(a.a).lerp(moodA.setHex(b.a), f);
    skyU.uB.value.setHex(a.b).lerp(moodA.setHex(b.b), f);
    sky.position.copy(camera.position);

    starMat.uniforms.uTime.value = time;

    const heroVisible = stage < 1.2 || stage > lastStage - 2;
    core.group.visible = heroVisible;
    if (heroVisible) core.update(dt, time, pointer);

    title.visible = stage < 1;
    title.material.uniforms.uTime.value = time;
    title.material.uniforms.uReveal.value = clamp((intro - 0.14) / 0.6);
    title.material.uniforms.uFade.value = clamp(1 - stage * 2.2);
    title.material.uniforms.uLight.value.set(pointer.x * 0.5 + 0.5, pointer.y * 0.5 + 0.5);

    for (const w of Object.values(worlds)) {
      const d = camera.position.distanceTo(w.pos);
      w.group.visible = d < 46;
      if (w.group.visible) w.update(dt, time, pointer);
      w.beacon.material.opacity = clamp((d - 34) / 60) * 0.7;
      w.beacon.scale.setScalar(5 + d * 0.085);
    }

    /* edge-on in the hero the orbits would collapse into one line across the screen */
    pathMaterial.opacity = clamp(stage - 0.5) * 0.3;

    sun.intensity = 1.1 * clamp(1.4 - Math.abs(stage - parketoIndex) * 1.6);
    bloom.strength = 0.34 + clamp(stage - (lastStage - 1)) * 0.2;

    composer.render(dt);
    adapt(dt);
  }

  resize();
  /* the first frame compiles every shader, so do it before the canvas fades in */
  frame(0, 0, { x: 0, y: 0 });
  return { frame, resize };
}
