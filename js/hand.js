/**
 * hand.js — the player character: a fully procedural ✌️ made of primitives.
 * No external assets, no skeleton, no downloads. Just a Group you can drop
 * into a scene and feed a physics state every frame.
 *
 *   import { createHand } from './hand.js';
 *   const hand = createHand();
 *   scene.add(hand.root);
 *   hand.update(dt, { speedNorm, vy, grounded, falling, face });
 */

import * as THREE from 'three';

const PALM_W = 1.06;
const PALM_H = 1.12;
const PALM_R = 0.32;
const PALM_D = 0.3;

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

export function createHand() {
  const root = new THREE.Group();       // physics position + facing (yaw)
  const tilt = new THREE.Group();       // lean / roll / squash & stretch
  const body = new THREE.Group();       // vertical bob
  const spinner = new THREE.Group();    // tumble when swallowed by a hole
  const flipped = new THREE.Group();    // holds the model, rotated 180deg

  root.add(tilt);
  tilt.add(body);
  body.add(spinner);
  spinner.add(flipped);
  root.rotation.order = 'YXZ';

  /* the palm/thumb side faces local -Z, so the ✌️ you see from behind the
     camera is the palm side while you walk away. Walk the other way and the
     back of the hand shows — which is exactly the 180° you want. */
  flipped.rotation.y = Math.PI;

  const skin = new THREE.MeshStandardMaterial({
    color: 0xffd25e, roughness: 0.52, metalness: 0.04,
    emissive: 0x4a2f00, emissiveIntensity: 0.45,
  });
  const skinDim = new THREE.MeshStandardMaterial({
    color: 0xf3b93f, roughness: 0.6, metalness: 0.04,
    emissive: 0x3a2400, emissiveIntensity: 0.35,
  });

  /* ── palm ────────────────────────────────────────────────────────────── */
  /* Generous tessellation everywhere. ExtrudeGeometry's bevel was only 3
     segments and the curves only 16, which reads as visible faceting on the
     palm edges; the finger capsules and knuckle spheres were similarly low. */
  const palmGeo = new THREE.ExtrudeGeometry(roundedRectShape(PALM_W, PALM_H, PALM_R), {
    depth: PALM_D, bevelEnabled: true,
    bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 8, curveSegments: 40,
  });
  palmGeo.center();
  const palm = new THREE.Mesh(palmGeo, skin);
  palm.position.y = PALM_H / 2 + 0.05;
  palm.castShadow = true;
  palm.receiveShadow = true;
  flipped.add(palm);

  /* ── fingers ─────────────────────────────────────────────────────────── */
  const fingers = [];

  function makeFinger({ x, y, z = 0, len, r, angle, tiltBack = 0, mat = skin }) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.rotation.order = 'YXZ';

    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 16, 40), mat);
    mesh.position.y = len / 2 + r * 0.55;
    mesh.castShadow = true;
    pivot.add(mesh);

    // soft knuckle swell at the base
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(r * 1.16, 32, 24), mat);
    knuckle.position.y = r * 0.5;
    knuckle.scale.set(1, 0.86, 1);
    pivot.add(knuckle);

    pivot.rotation.z = angle;
    pivot.rotation.x = tiltBack;
    pivot.userData.base = angle;
    pivot.userData.tiltBack = tiltBack;

    flipped.add(pivot);
    fingers.push(pivot);
    return pivot;
  }

// index + middle: the V. the angles DIVERGE (index leans -x, middle leans
  // +x) so the gap grows with height instead of the two closing and crossing.
  makeFinger({ x: -0.26, y: 0.5, len: 1.45, r: 0.145, angle: 0.12, tiltBack: -0.04 });
  makeFinger({ x: 0.04, y: 0.5, len: 1.58, r: 0.145, angle: -0.06, tiltBack: -0.06 });

  // thumb: folds out past the palm edge so it reads clearly as a thumb
  const thumb = makeFinger({ x: -0.43, y: 0.26, z: 0.14, len: 0.46, r: 0.15, angle: 0.49, tiltBack: 0.25, mat: skinDim });
  thumb.rotation.y = -0.18;

  // ring + pinky: folded, so they read as knuckle bumps on the palm edge
  [[0.25, 1.06, 0.0, 0.15], [0.44, 0.98, -0.02, 0.135]].forEach(([x, y, z, r]) => {
    const k = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), skinDim);
    k.position.set(x, y, z);
    k.scale.set(1.05, 0.82, 1);
    k.castShadow = true;
    flipped.add(k);
  });

  /* ── animation state ─────────────────────────────────────────────────── */
  let clock = 0;
  let spin = 0;
  let squash = 0;

  /* Oscillation phases are INTEGRATED with dt, never recomputed as
     `clock * frequency`. A speed-dependent frequency multiplied by a growing
     clock makes the phase jump backwards every time you accelerate or brake,
     which reads as a violent jitter. Accumulating keeps it continuous. */
  let stepPhase = 0;
  let fingerPhase = 0;

  /* smoothed speed, so animation never snaps when velocity changes fast */
  let smoothSp = 0;

  const _v = new THREE.Vector3();

  return {
    root,
    /** Kick a squash impulse — call on take-off / landing. */
    punch(amount) { squash += amount; },
    /** Used when the hand is swallowed by a hole, and on respawn. */
    reset() {
      spin = 0;
      squash = 0;
      stepPhase = 0;
      fingerPhase = 0;
      smoothSp = 0;
      root.rotation.set(0, root.rotation.y, 0);
      root.scale.setScalar(1);
      tilt.scale.setScalar(1);
      tilt.rotation.set(0, 0, 0);
      spinner.rotation.set(0, 0, 0);
      body.position.y = 0;
    },
    /**
     * @param {number} dt seconds
     * @param {{speedNorm:number, vy:number, grounded:boolean, falling:boolean, face:number}} s
     */
    update(dt, s) {
      clock += dt;
      const raw = THREE.MathUtils.clamp(s.speedNorm || 0, 0, 1);

      /* ease the speed signal so accelerations and braking read as motion,
         not as a snap in the rig */
      smoothSp = THREE.MathUtils.lerp(smoothSp, raw, 1 - Math.pow(0.0002, dt));
      const sp = smoothSp;

      /* ── fall-in: shrink + tumble into the pit ── */
      if (s.falling) {
        spin += dt * 3.4;
        const k = Math.max(0.001, root.scale.x - dt * 1.5);
        root.scale.setScalar(k);
        root.rotation.z = spin;
        root.rotation.x = Math.sin(spin * 0.7) * 0.5;
        tilt.rotation.set(0, 0, 0);
        body.position.y = 0;
        spinner.rotation.y = spin * 0.5;
        for (let i = 0; i < fingers.length; i++) {
          const f = fingers[i];
          f.rotation.z = f.userData.base + Math.sin(clock * 12 + i) * 0.22 + i * 0.12;
        }
        return;
      }

      root.scale.lerp(_v.setScalar(1), 1 - Math.pow(0.001, dt));
      tilt.rotation.set(0, 0, 0);
      spinner.rotation.y = THREE.MathUtils.lerp(spinner.rotation.y, 0, 1 - Math.pow(0.0005, dt));

      /* advance the walk cycle by how fast we are going, in radians */
      stepPhase += dt * (3.6 + sp * 9.6);
      fingerPhase += dt * (3.2 + sp * 6.5);

      /* ── locomotion ── */
      if (s.grounded) {
        const step = Math.sin(stepPhase);
        body.position.y = Math.abs(step) * 0.1 * sp;
        tilt.rotation.x = -0.17 * sp + Math.sin(stepPhase * 2) * 0.015 * sp;
        tilt.rotation.z = step * 0.055 * sp;
      } else {
        body.position.y = THREE.MathUtils.lerp(body.position.y, 0, 1 - Math.pow(0.002, dt));
        const targetX = s.vy > 0 ? -0.14 : 0.16;
        tilt.rotation.x = THREE.MathUtils.lerp(tilt.rotation.x, targetX, 1 - Math.pow(0.004, dt));
        tilt.rotation.z = THREE.MathUtils.lerp(tilt.rotation.z, 0.09, 1 - Math.pow(0.004, dt));
      }

      /* ── idle breathing, always at a fixed rate ── */
      tilt.rotation.x += Math.sin(clock * 1.6) * 0.012;
      body.position.y += Math.sin(clock * 1.9) * 0.018;

      /* ── squash & stretch ── */
      const target = s.grounded ? 0 : THREE.MathUtils.clamp(s.vy * 0.03, -0.26, 0.3);
      squash = THREE.MathUtils.lerp(squash, target, 1 - Math.pow(0.0006, dt));
      squash = THREE.MathUtils.clamp(squash, -0.45, 0.45);
      tilt.scale.set(1 - squash * 0.45, 1 + squash, 1 - squash * 0.45);

      /* ── fingers idle wiggle ── */
      const w = 0.035 + sp * 0.075;
      for (let i = 0; i < fingers.length; i++) {
        const f = fingers[i];
        f.rotation.z = f.userData.base + Math.sin(fingerPhase + i * 1.1) * w;
        f.rotation.x = f.userData.tiltBack + Math.cos(fingerPhase * 0.8 + i) * w * 0.5;
      }

      /* ── facing (full 360°, always takes the short way round) ── */
      if (s.face !== undefined) {
        const cur = root.rotation.y;
        let diff = s.face - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        root.rotation.y = cur + diff * (1 - Math.pow(0.0002, dt));
      }
    },
  };
}
