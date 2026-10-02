/**
 * hub.js — MalenHub
 * A floating island with one hole per game in /jeux. Walk, jump into a hole,
 * get teleported to that game's HTML file.
 *
 * Controls: WASD / ZQSD / arrows · Space to jump · mouse drag or Q/E to orbit
 */

import * as THREE from 'three';
import { createHand } from './hand.js';

/* ═══════════════════════════ tunables ═══════════════════════════ */

const CFG = {
  gravity: 27,
  jumpV: 9.6,
  moveSpeed: 8.2,
  accel: 62,
  airAccel: 26,
  friction: 28,
  maxFall: 34,

  holeR: 1.75,          // radius of every hole
  holeSpacing: 5.4,     // distance between two hole centres
  assistRange: 2.0,     // how close to a hole you can "aim" a jump
  assistBoost: 0.9,     // fraction of run speed used when aiming at a hole
  magnet: 40,           // how hard a hole sucks you in once you are over it

  coyote: 0.13,
  jumpBuffer: 0.16,

  camDist: 8.2,
  camHeight: 2.55,
  camPitch: 0.30,
  deathY: -7,

  eyeHeight: 1.05,      // where the camera looks, relative to the feet
};

/* ═══════════════════════ game manifest (generated) ═══════════════════════ */

async function loadGames() {
  /* Manifests can be hand-written, so normalise whatever shape we get into
     "jeux/<file>.html" (or an absolute http(s) URL). Already-prefixed values
     must not get a second "jeux/". */
  const normalise = (u) => {
    const raw = String(u).trim().replace(/^\.?\//, '');
    if (/^https?:/i.test(raw)) return raw;
    if (/^jeux\//i.test(raw)) return raw;
    return `jeux/${raw}`;
  };

  const clean = (list) =>
    Array.isArray(list)
      ? list
          .filter((g) => g && typeof g.url === 'string' && typeof g.name === 'string')
          .filter((g) => !/^\s*javascript:/i.test(g.url) && !g.url.includes('..'))
          .map((g, i) => ({ index: i, id: g.id || `g${i + 1}`, name: g.name, url: normalise(g.url) }))
      : [];

  if (Array.isArray(window.MALEN_GAMES)) return clean(window.MALEN_GAMES);

  try {
    const res = await fetch('games.json', { cache: 'no-store' });
    if (res.ok) return clean(await res.json());
  } catch {
    /* opened straight from the filesystem — no manifest available */
  }
  return [];
}

/* ═══════════════════════════════ helpers ═══════════════════════════════ */

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.pow(lambda, dt));

function hsl(h, s, l) {
  return new THREE.Color().setHSL(h / 360, s, l);
}

/** Round rect used for the island silhouette. */
function roundedRectShape(w, h, r) {
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

/** Even ring for a handful of games, golden-angle spiral once it gets busy.
    MIN_CLEAR guarantees the spawn pad in the middle is never swallowed by a hole. */
const MIN_CLEAR = CFG.holeR + 3.4;

function layout(n) {
  const pts = [];
  if (n === 0) return pts;

  if (n <= 11) {
    const R = Math.max((CFG.holeSpacing * n) / (2 * Math.PI) + 1.2, MIN_CLEAR);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      pts.push([Math.cos(a) * R, Math.sin(a) * R]);
    }
  } else {
    const sp = n > 20 ? 4.5 : CFG.holeSpacing;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const r = MIN_CLEAR + sp * Math.sqrt(i + 0.45);
      const a = i * golden;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  return pts;
}

/** Round floating text billboard. */
function makeLabel(text, color, index) {
  const pad = 26;
  const fontPx = 46;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `800 ${fontPx}px "Segoe UI", system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2 + 34;
  const h = fontPx + pad * 1.4;

  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.font = `800 ${fontPx}px "Segoe UI", system-ui, sans-serif`;
  g.textBaseline = 'middle';

  g.fillStyle = 'rgba(8,12,26,0.80)';
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.lineWidth = 3;
  const r = h / 2;
  g.beginPath();
  g.moveTo(r, 0);
  g.lineTo(w - r, 0);
  g.quadraticCurveTo(w, 0, w, r);
  g.lineTo(w, h - r);
  g.quadraticCurveTo(w, h, w - r, h);
  g.lineTo(r, h);
  g.quadraticCurveTo(0, h, 0, h - r);
  g.lineTo(0, r);
  g.quadraticCurveTo(0, 0, r, 0);
  g.closePath();
  g.fill();
  g.stroke();

  g.fillStyle = `#${color.getHexString()}`;
  g.beginPath();
  g.arc(pad + 2, h / 2, 11, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.font = `700 26px "Segoe UI", system-ui, sans-serif`;
  g.fillText(String(index + 1).padStart(2, '0'), pad + 22, h / 2 + 1);

  g.fillStyle = '#ffffff';
  g.font = `800 ${fontPx}px "Segoe UI", system-ui, sans-serif`;
  g.fillText(text, pad + 62, h / 2 + 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
  );
  spr.scale.set(w / 100, h / 100, 1);
  spr.renderOrder = 12;
  spr.center.set(0.5, 0);
  return spr;
}

/** Soft radial falloff, used for the warm ground pool under the player. */
function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Grass-ish procedural texture for the island top. */
function grassTexture() {
  // a single instance is stretched right across the island so the pattern
  // never tiles. that stretches it far more than a repeating setup did, so
  // the canvas resolution goes up to keep it from going soft.
  const s = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#4fae62';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 21000; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = 4 + Math.random() * 24;
    const light = Math.random();
    g.fillStyle = light > 0.5 ? `rgba(150,215,140,${0.05 + Math.random() * 0.1})`
                              : `rgba(30,90,50,${0.05 + Math.random() * 0.12})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // the island UVs are normalised to 0..1, so repeat 1 is exactly one
  // non-repeating instance across the whole island (see the remap above)
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  t.anisotropy = 4;
  return t;
}

/** Infinite-grid texture for the void far below. */
function gridTexture() {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#080c1a';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(110,168,255,0.30)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, s, s);
  g.strokeStyle = 'rgba(110,168,255,0.09)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(s / 2, 0); g.lineTo(s / 2, s);
  g.moveTo(0, s / 2); g.lineTo(s, s / 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(46, 46);
  return t;
}

function starfield(count = 900) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = 260 + Math.random() * 120;
    const k = Math.sqrt(1 - u * u);
    pos[i * 3] = r * k * Math.cos(th);
    pos[i * 3 + 1] = Math.abs(u) * r * 0.7 + 12;
    pos[i * 3 + 2] = r * k * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false })
  );
}

/* ═══════════════════════════════ boot ═══════════════════════════════ */

const $ = (id) => document.getElementById(id);

const el = {
  canvas: $('scene'), hud: $('hud'), count: $('countValue'), nearby: $('nearby'),
  fade: $('fade'), dive: $('dive'), diveName: document.querySelector('.dive-name'),
  toast: $('toast'), menu: $('menu'), menuSub: $('menuSub'), gameList: $('gameList'),
  play: $('playBtn'), pause: $('pause'), pauseBtn: $('pauseBtn'), resume: $('resumeBtn'),
  home: $('homeBtn'), touch: $('touch'), stick: $('stick'), nub: $('stickNub'),
  jump: $('jumpBtn'), fatal: $('fatal'), fatalMsg: $('fatalMsg'),
};

function fatal(msg) {
  el.menu.classList.add('hidden');
  el.hud.classList.add('hidden');
  el.fatal.classList.remove('hidden');
  el.fatalMsg.innerHTML = msg;
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: el.canvas, antialias: true, powerPreference: 'high-performance',
  });
} catch (e) {
  fatal("Impossible de d&eacute;marrer WebGL.<br>Tente un autre navigateur ou active l'acc&eacute;l&eacute;ration mat&eacute;rielle.");
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080c1a);
scene.fog = new THREE.Fog(0x080c1a, 55, 190);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
camera.position.set(0, 6, 12);

/* ── lights ─────────────────────────────────────────────────────────── */
scene.add(new THREE.HemisphereLight(0x9fc7ff, 0x2a1c3a, 0.62));

const sun = new THREE.DirectionalLight(0xfff2d6, 2.35);
sun.position.set(20, 30, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

const rimLight = new THREE.DirectionalLight(0x6ea8ff, 0.85);
rimLight.position.set(-18, 10, -20);
scene.add(rimLight);

/* ── backdrop ───────────────────────────────────────────────────────── */
scene.add(starfield());

const voidFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(700, 700),
  new THREE.MeshBasicMaterial({ map: gridTexture(), fog: true })
);
voidFloor.rotation.x = -Math.PI / 2;
voidFloor.position.y = -55;
scene.add(voidFloor);

/* ── world container ────────────────────────────────────────────────── */
const world = new THREE.Group();
scene.add(world);

/* ═══════════════════════════ game state ═══════════════════════════ */

const GAMES = await loadGames();

const holes = [];
const hand = createHand();

const P = {
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  grounded: true,
  coyote: 0,
  buffer: 0,
  face: 0,
};

let ISLAND_R = 18;
let camYaw = 0;
let camDist = CFG.camDist;
let state = 'menu';           // menu | play | pause | falling
let fallT = 0;
let target = null;            // game we are being swallowed by
let fallHole = null;          // hole we are being swallowed by
let diveFadeTimer = 0;        // pending "fade to black" during a dive

/* ═════════════════════════ build the island ═════════════════════════ */

function buildWorld() {
  while (world.children.length) world.remove(world.children[0]);
  holes.length = 0;

  const pts = layout(GAMES.length);
  let maxR = 0;

  pts.forEach(([x, z], i) => {
    const hue = (i * 47 + 205) % 360;
    const color = hsl(hue, 0.85, 0.6);
    const r = CFG.holeR;

    /* shaft you can see through */
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 0.6, 3.4, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 1, side: THREE.BackSide, emissive: color, emissiveIntensity: 0.09 })
    );
    shaft.position.set(x, -1.7, z);
    world.add(shaft);

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(r * 0.62, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, fog: true })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(x, -3.3, z);
    world.add(glow);

    /* glowing rim */
    const rimMat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.9,
      roughness: 0.3, metalness: 0.15,
    });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 10, 48), rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(x, 0.01, z);
    world.add(rim);

    /* soft halo on the ground around the hole */
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(r + 0.12, r + 1.15, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, depthWrite: false })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(x, 0.02, z);
    world.add(halo);

    const label = makeLabel(GAMES[i].name, color, i);
    label.position.set(x, 2.15, z);
    world.add(label);
    label.userData.w = label.scale.x;
    label.userData.h = label.scale.y;

    holes.push({ i, x, z, r, game: GAMES[i], color, rimMat, glow, halo, label, pulse: 0 });
    maxR = Math.max(maxR, Math.hypot(x, z));
  });

  ISLAND_R = Math.max(12, maxR + CFG.holeSpacing * 0.9);
  const size = ISLAND_R * 2;
  const corner = Math.min(9, ISLAND_R * 0.32);

  const shape = roundedRectShape(size, size, corner);
  for (const h of holes) {
    const path = new THREE.Path();
    // ExtrudeGeometry lives in XY and we rotateX(-90deg) later, so shape.y -> world -z
    path.absarc(h.x, -h.z, h.r, 0, Math.PI * 2, true);
    shape.holes.push(path);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.8, bevelEnabled: false, curveSegments: 26,
  });
  geo.rotateX(-Math.PI / 2);

  /* ExtrudeGeometry gives the top face UVs in shape space (-ISLAND_R..ISLAND_R)
   * rather than 0..1, which is why the grass either tiled dozens of times or
   * collapsed onto the texture border. Remap to 0..1 once, here, so the grass
   * can sit as exactly one instance with repeat 1 and no offset tricks. */
  {
    const uv = geo.attributes.uv;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const du = maxU - minU || 1;
    const dv = maxV - minV || 1;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (uv.getX(i) - minU) / du, (uv.getY(i) - minV) / dv);
    }
    uv.needsUpdate = true;
  }

  const island = new THREE.Mesh(geo, [
    new THREE.MeshStandardMaterial({ map: grassTexture(), color: 0xbfe9c6, roughness: 0.95, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1, metalness: 0 }),
  ]);
  island.position.y = -0.8;
  island.receiveShadow = true;
  world.add(island);

  // centre spawn pad
  const pad = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.5, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.09, depthWrite: false })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.03;
  world.add(pad);

  // shadow camera fits the island
  const s = ISLAND_R + 6;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 110 });
  sun.shadow.camera.updateProjectionMatrix();
}

buildWorld();

/* ═════════════════════════ the player ═════════════════════════ */

const player = new THREE.Group();
player.add(hand.root);

/* The warm pool around the player used to be a PointLight parented to the
 * player at y=1.7, i.e. inside the body. A point light that close blows out a
 * bright hotspot on whatever it sits inside, and three.js r169 has no
 * light.layers vs object.layers test, so you cannot exclude the player from it.
 * An additive ground decal gives the same warm pool without lighting the body. */
const playerGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(6, 6),
  new THREE.MeshBasicMaterial({
    map: radialTexture('rgba(255,217,138,0.55)', 'rgba(255,217,138,0)'),
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0.85,
  })
);
playerGlow.rotation.x = -Math.PI / 2;
playerGlow.position.y = 0.05;
player.add(playerGlow);
scene.add(player);

/* ═══════════════════════════ input ═══════════════════════════ */

const keys = new Set();
const moveInput = { x: 0, y: 0 };   // x = strafe, y = forward
const touchVec = { x: 0, y: 0 };
let touchActive = false;
let jumpQueued = false;

const CODE_MAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  // AZERTY
  KeyZ: 'up', KeyQ: 'camLeft',
  KeyE: 'camRight',
  Space: 'jump',
};

const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

addEventListener('keydown', (e) => {
  if (BLOCK.has(e.code)) e.preventDefault();

  if (e.code === 'Escape') {
    if (state === 'play') pause();
    else if (state === 'pause') resume();
    return;
  }
  if (e.code === 'Enter' && (state === 'menu' || state === 'pause')) {
    if (state === 'pause') resume(); else start();
    return;
  }
  if (state !== 'play') return;

  const a = CODE_MAP[e.code];
  if (!a) return;
  keys.add(a);
  if (a === 'jump') jumpQueued = true;
}, { passive: false });

addEventListener('keyup', (e) => {
  const a = CODE_MAP[e.code];
  if (a) keys.delete(a);
});

addEventListener('blur', () => { keys.clear(); if (state === 'play') pause(); });

/* camera orbit: mouse drag + Q/E */
let dragging = false;
let lastX = 0;

el.canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  dragging = true;
  lastX = e.clientX;
  el.canvas.setPointerCapture(e.pointerId);
});
el.canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  camYaw -= (e.clientX - lastX) * 0.006;
  lastX = e.clientX;
});
const endDrag = () => { dragging = false; };
el.canvas.addEventListener('pointerup', endDrag);
el.canvas.addEventListener('pointercancel', endDrag);
el.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
el.canvas.addEventListener('wheel', (e) => {
  if (state !== 'play') return;
  e.preventDefault();
  camDist = clamp(camDist + e.deltaY * 0.006, 4, 16);
}, { passive: false });

/* touch stick + jump button */
if (matchMedia('(hover: none) and (pointer: coarse)').matches) {
  el.touch.hidden = false;
  let stickId = null;
  const R = 44;

  const stickMove = (e) => {
    if (e.pointerId !== stickId) return;
    const b = el.stick.getBoundingClientRect();
    let dx = e.clientX - (b.left + b.width / 2);
    let dy = e.clientY - (b.top + b.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    el.nub.style.transform = `translate(${dx}px, ${dy}px)`;
    touchVec.x = dx / R;
    touchVec.y = -dy / R;
  };
  const stickEnd = () => {
    stickId = null; touchActive = false;
    touchVec.x = touchVec.y = 0;
    el.nub.style.transform = '';
  };

  el.stick.addEventListener('pointerdown', (e) => {
    stickId = e.pointerId; touchActive = true;
    el.stick.setPointerCapture(e.pointerId);
    stickMove(e);
  });
  el.stick.addEventListener('pointermove', stickMove);
  el.stick.addEventListener('pointerup', stickEnd);
  el.stick.addEventListener('pointercancel', stickEnd);

  el.jump.addEventListener('pointerdown', (e) => { e.preventDefault(); if (state === 'play') jumpQueued = true; });
}

/* ═══════════════════════════ menu ui ═══════════════════════════ */

function fillMenu() {
  const n = GAMES.length;
  el.count.textContent = String(n);
  el.menuSub.textContent = n
    ? `${n} jeu${n === 1 ? '' : 'x'}, ${n} trou${n === 1 ? '' : 's'}. Saute dedans !`
    : 'Aucun jeu pour l’instant.';

  if (!n) {
    el.gameList.innerHTML =
      '<span class="empty">Le dossier <code>jeux/</code> est vide.<br>' +
      'Ajoute des fichiers <code>.html</code> dedans, puis lance <code>node build.js</code> : ' +
      'un trou appara&icirc;t automatiquement par jeu.</span>';
    return;
  }

  el.gameList.innerHTML = GAMES.map((g, i) => {
    const hue = (i * 47 + 205) % 360;
    return `<span class="chip"><i style="background:hsl(${hue} 85% 60%)"></i>${escapeHtml(g.name)}</span>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastT = 0;
function toast(msg, ms = 2400) {
  el.toast.textContent = msg;
  el.toast.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.toast.classList.remove('on'), ms);
}

function start() {
  el.menu.classList.add('hidden');
  el.pause.classList.add('hidden');
  el.hud.classList.remove('hidden');
  resetPlayer();
  state = 'play';
}

function pause() {
  if (state !== 'play') return;
  state = 'pause';
  keys.clear();
  el.pause.classList.remove('hidden');
}

function resume() {
  if (state !== 'pause') return;
  el.pause.classList.add('hidden');
  state = 'play';
}

/* ═══════════════════════ going back from a game ═══════════════════════
 * Diving into a hole navigates away, so the browser's back button has to
 * be able to bring you home. Without this the hub is restored from bfcache
 * frozen mid-dive: "Tu sautes dans <game>" still on screen, fade still black.
 * A sessionStorage flag covers the full-reload case too, where the browser
 * rebuilds the page from scratch instead of restoring it.
 */

const DIVE_KEY = 'malenhub:dived';

function markDive() {
  try { sessionStorage.setItem(DIVE_KEY, '1'); } catch { /* private mode */ }
}

/** reads AND clears the flag */
function takeDiveMark() {
  try {
    const v = sessionStorage.getItem(DIVE_KEY);
    sessionStorage.removeItem(DIVE_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

function returnToPlay() {
  takeDiveMark();            // consume it, so this can only ever fire once
  clearTimeout(diveFadeTimer);
  el.dive.classList.remove('on');
  el.fade.classList.remove('on');
  el.nearby.classList.remove('on');
  el.pause.classList.add('hidden');
  el.menu.classList.add('hidden');
  el.hud.classList.remove('hidden');
  resetPlayer();
  state = 'play';
}

addEventListener('pageshow', (e) => {
  if (e.persisted) returnToPlay();          // back/forward via bfcache
});

addEventListener('popstate', () => {
  if (takeDiveMark()) returnToPlay();       // back, page fully reloaded
});

el.play.addEventListener('click', start);
el.resume.addEventListener('click', resume);
el.pauseBtn.addEventListener('click', pause);
el.home.addEventListener('click', () => {
  el.pause.classList.add('hidden');
  el.menu.classList.remove('hidden');
  state = 'menu';
});

function resetPlayer() {
  P.pos.set(0, 0.01, 0);
  P.vel.set(0, 0, 0);
  P.grounded = true;
  P.coyote = CFG.coyote;
  P.buffer = 0;
  P.face = camYaw;
  fallT = 0;
  target = null;
  fallHole = null;
  jumpQueued = false;
  hand.reset();
  clearTimeout(diveFadeTimer);
  el.fade.classList.remove('on');
  el.dive.classList.remove('on');
}

fillMenu();

/* coming back from a game with the back button? drop straight onto the island
   instead of making them click "Jouer" again */
if (takeDiveMark()) start();

/* ═══════════════════════════ physics ═══════════════════════════ */

function holeUnderfoot(x, z) {
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    const dx = x - h.x;
    const dz = z - h.z;
    if (dx * dx + dz * dz < h.r * h.r) return h;
  }
  return null;
}

function nearestHole(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const h of holes) {
    const d = Math.hypot(x - h.x, z - h.z) - h.r;
    if (d < bestD) { bestD = d; best = h; }
  }
  return bestD < CFG.assistRange ? { hole: best, dist: bestD } : null;
}

function readMove() {
  let x = 0;
  let y = 0;
  if (keys.has('left')) x -= 1;
  if (keys.has('right')) x += 1;
  if (keys.has('up')) y += 1;
  if (keys.has('down')) y -= 1;
  if (touchActive) { x += touchVec.x; y += touchVec.y; }
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  return { x, y };
}

function doJump() {
  if (P.coyote <= 0) return false;

  P.vel.y = CFG.jumpV;
  P.grounded = false;
  P.coyote = 0;
  hand.punch(-0.34);

  // "aim assist": jumping next to a hole nudges you over it
  const near = nearestHole(P.pos.x, P.pos.z);
  if (near) {
    const h = near.hole;
    const dx = h.x - P.pos.x;
    const dz = h.z - P.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const boost = CFG.moveSpeed * CFG.assistBoost;
    P.vel.x = (dx / d) * boost;
    P.vel.z = (dz / d) * boost;
    P.face = Math.atan2(dx, dz);
  }
  return true;
}

function beginFallIn(h) {
  state = 'falling';
  fallT = 0;
  target = h.game;
  fallHole = h;
  h.pulse = 1;
  P.vel.set(0, Math.min(P.vel.y, -5), 0);
  el.diveName.textContent = h.game.name;
  el.dive.classList.add('on');
  markDive();
  clearTimeout(diveFadeTimer);
  diveFadeTimer = setTimeout(() => el.fade.classList.add('on'), 190);
  keys.clear();
  touchActive = false;
  touchVec.x = touchVec.y = 0;
}

function updatePlay(dt) {
  /* camera keys */
  if (keys.has('camLeft')) camYaw += dt * 2.4;
  if (keys.has('camRight')) camYaw -= dt * 2.4;

  /* jump buffer + coyote time */
  P.buffer = jumpQueued ? CFG.jumpBuffer : Math.max(0, P.buffer - dt);
  jumpQueued = false;
  P.coyote = P.grounded ? CFG.coyote : Math.max(0, P.coyote - dt);
  if (P.buffer > 0 && P.coyote > 0) {
    P.buffer = 0;
    doJump();
  }

  /* camera-relative movement */
  const mv = readMove();
  const fx = -Math.sin(camYaw);
  const fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw);
  const rz = -Math.sin(camYaw);

  const wishX = fx * mv.y + rx * mv.x;
  const wishZ = fz * mv.y + rz * mv.x;
  const wishLen = Math.hypot(wishX, wishZ);
  const a = P.grounded ? CFG.accel : CFG.airAccel;

  if (wishLen > 0.001) {
    P.vel.x += wishX * a * dt;
    P.vel.z += wishZ * a * dt;
    const sp = Math.hypot(P.vel.x, P.vel.z);
    if (sp > CFG.moveSpeed) {
      const k = CFG.moveSpeed / sp;
      P.vel.x *= k;
      P.vel.z *= k;
    }
    P.face = Math.atan2(wishX, wishZ);
  } else if (P.grounded) {
    const sp = Math.hypot(P.vel.x, P.vel.z);
    const drop = Math.min(sp, CFG.friction * dt);
    if (sp > 0.0001) {
      P.vel.x -= (P.vel.x / sp) * drop;
      P.vel.z -= (P.vel.z / sp) * drop;
    }
  }

  /* gravity + integrate */
  P.vel.y = Math.max(P.vel.y - CFG.gravity * dt, -CFG.maxFall);
  P.pos.addScaledVector(P.vel, dt);

  /* ground support: a hole removes the floor */
  const over = holeUnderfoot(P.pos.x, P.pos.z);
  if (over) {
    /* hole magnet: once your feet are over the pit you go in — you can never
       skip over a hole, no matter how fast or how high you jump */
    const sp = Math.hypot(P.vel.x, P.vel.z);
    if (sp > 0.0001) {
      const cut = Math.min(sp, CFG.magnet * dt);
      P.vel.x -= (P.vel.x / sp) * cut;
      P.vel.z -= (P.vel.z / sp) * cut;
    }
    if (P.pos.y < 0.45) P.vel.y -= 16 * dt;

    if (!P.grounded && P.pos.y < -0.02) { beginFallIn(over); return; }
    P.grounded = false;
  } else if (P.pos.y <= 0) {
    const impact = P.vel.y;
    P.pos.y = 0;
    if (!P.grounded && impact < -4) hand.punch(0.3);
    P.vel.y = 0;
    P.grounded = true;
  } else {
    P.grounded = false;
  }

  /* soft island bounds — an invisible fence, no accidental deaths */
  const lim = ISLAND_R - 1.4;
  const d = Math.hypot(P.pos.x, P.pos.z);
  if (d > lim) {
    const k = lim / d;
    P.pos.x *= k;
    P.pos.z *= k;
    P.vel.x *= 0.4;
    P.vel.z *= 0.4;
  }

  /* fell off the world somehow */
  if (P.pos.y < CFG.deathY) {
    resetPlayer();
    toast('Oups — retour au depart');
  }
}

function updateFalling(dt) {
  fallT += dt;
  P.vel.y = Math.max(P.vel.y - 16 * dt, -30);
  P.pos.addScaledVector(P.vel, dt);
  const h = holeUnderfoot(P.pos.x, P.pos.z) || target;
  if (h && P.pos.y < -1.6) {
    P.pos.x = damp(P.pos.x, h.x, 0.0002, dt);
    P.pos.z = damp(P.pos.z, h.z, 0.0002, dt);
  }
  if (fallT > 0.72 && target) {
    const url = target.url;
    target = null;
    window.location.href = url;
  }
}

/* ═══════════════════════════ camera ═══════════════════════════ */

const camTarget = new THREE.Vector3(0, CFG.eyeHeight, 0);
const camWant = new THREE.Vector3();
const lookWant = new THREE.Vector3();

function updateCamera(dt, snap) {
  if (state === 'falling' && fallHole) {
    camTarget.x = damp(camTarget.x, fallHole.x, 0.004, dt);
    camTarget.z = damp(camTarget.z, fallHole.z, 0.004, dt);
  } else {
    camTarget.x = P.pos.x;
    camTarget.z = P.pos.z;
  }
  camTarget.y = damp(camTarget.y, P.pos.y + CFG.eyeHeight, 0.0008, dt);

  const pitch = CFG.camPitch + (state === 'falling' ? 0.5 : 0);
  const dist = state === 'falling' ? camDist * 0.75 : camDist;

  camWant.set(
    camTarget.x + Math.sin(camYaw) * dist * Math.cos(pitch),
    camTarget.y + Math.sin(pitch) * dist + CFG.camHeight * 0.35,
    camTarget.z + Math.cos(camYaw) * dist * Math.cos(pitch)
  );
  camWant.y = Math.max(camWant.y, 1.3);

  lookWant.copy(camTarget);

  if (snap) {
    camera.position.copy(camWant);
    camera.lookAt(lookWant);
  } else {
    camera.position.lerp(camWant, 1 - Math.pow(0.0006, dt));
    camera.lookAt(lookWant);
  }
}

/* ═══════════════════════════ visuals ═══════════════════════════ */

function updateHoles(dt, t) {
  let nearest = null;
  let bestD = Infinity;

  for (const h of holes) {
    const d = Math.hypot(P.pos.x - h.x, P.pos.z - h.z) - h.r;
    const near = clamp(1 - d / 9, 0, 1);
    const focused = state !== 'falling' && d < CFG.assistRange;

    h.pulse = damp(h.pulse, focused ? 1 : 0, 0.002, dt);
    h.rimMat.emissiveIntensity = 0.85 + h.pulse * 2.4 + Math.sin(t * 2.4 + h.i) * 0.18;
    h.halo.material.opacity = 0.1 + h.pulse * 0.35;
    h.halo.scale.setScalar(1 + h.pulse * 0.16);
    h.glow.material.opacity = 0.45 + h.pulse * 0.5;

    h.label.position.y = 2.15 + Math.sin(t * 1.7 + h.i * 0.8) * 0.09;
    const ls = 1 + h.pulse * 0.1;
    h.label.scale.set(h.label.userData.w * ls, h.label.userData.h * ls, 1);
    h.label.material.opacity = (0.35 + near) * (state === 'falling' ? 0.15 : 1);

    if (d < bestD) { bestD = d; nearest = h; }
  }

  /* HUD prompt */
  if (state === 'play' && bestD < CFG.assistRange) {
    el.nearby.innerHTML =
      `<span class="dot" style="color:#${nearest.color.getHexString()}"></span>` +
      `<span>${escapeHtml(nearest.game.name)}</span>` +
      `<span class="go"><b>Espace</b> pour y sauter</span>`;
    el.nearby.classList.add('on');
  } else {
    el.nearby.classList.remove('on');
  }
}

/* ═══════════════════════════ main loop ═══════════════════════════ */

const clock = new THREE.Clock();
let t = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;

  if (state === 'play') updatePlay(dt);
  else if (state === 'falling') updateFalling(dt);

  /* player transform */
  player.position.copy(P.pos);
  const speed = Math.hypot(P.vel.x, P.vel.z);
  hand.update(dt, {
    speedNorm: speed / CFG.moveSpeed,
    vy: P.vel.y,
    grounded: P.grounded,
    falling: state === 'falling',
    face: P.face,
  });

  playerGlow.material.opacity = 0.85 + Math.sin(t * 2) * 0.12;

  updateHoles(dt, t);
  updateCamera(dt, false);

  renderer.render(scene, camera);
}

/* ═══════════════════════════ resize ═══════════════════════════ */

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 120));
resize();

/* prime the first frame so the menu already shows the island behind it */
resetPlayer();
updateCamera(0.016, true);
renderer.render(scene, camera);
frame();

/* expose a tiny API — handy in the console, and used by nothing else */
window.MALENHUB = {
  games: GAMES,
  holes,
  get player() { return P; },
  get playerGroup() { return player; },
  get state() { return state; },
  get hand() { return hand; },
  createHand,
  teleport(name) {
    const g = GAMES.find((x) => x.name === name || x.url.endsWith(name));
    if (g) location.href = g.url;
  },
};
