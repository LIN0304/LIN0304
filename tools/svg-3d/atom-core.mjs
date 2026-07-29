// Reactor core — a real 3D atom baked into pure SMIL.
//
// What makes this different from a flat "three tilted ellipses" atom:
//   · the whole atom tumbles on two axes, so every orbital plane is recomputed
//     per keyframe from an actual 3x3 rotation matrix;
//   · each orbit is split into its near and far half, and the halves are drawn
//     on opposite sides of the nucleus — so the ring is genuinely occluded when
//     it passes behind the core, and genuinely in front when it swings forward;
//   · electrons and nucleons carry the same treatment plus depth-driven radius
//     and brightness, so the eye reads distance, not just motion.
//
// A rotating circle always projects to an ellipse with semi-major R and a
// signed foreshortening k, which is why the orbits can ride cheap
// rotate()+scale() transform pairs instead of hundreds of baked polygon points.

import {
  C, MONO, TAU, num, num2, esc, rng, mul3, apply3, rotX, rotY, rotZ, cross, dot,
  norm, anim, animDiscrete, animTransform, chromeDefs, chromeFrame, chromeOverlay,
  scanBand, twinkles, hudLabel, caret, axisGizmo, svgDoc, clamp,
} from './lib.mjs';

const ID = 'ac';
const W = 980, H = 440;
const CX = 490, CY = 226;
const L = 16;              // master loop, seconds
const DUR = `${L}s`;
const KS = 48;             // slow track: orbits, nucleons, HUD
const KF = 96;             // fast track: electrons

// Orbital shells. Periods divide the master loop evenly so the whole scene is
// seamless: 4, 3 and 5 revolutions per 16s.
const SHELLS = [
  { R: 160, tilt: 0, T: L / 4, e: 3, name: 'M', dash: '6 8' },
  { R: 127, tilt: 62, T: L / 3, e: 3, name: 'L', dash: '5 7' },
  { R: 95, tilt: 124, T: L / 5, e: 2, name: 'K', dash: '4 6' },
];

const tumble = (t) => {
  const yaw = (TAU * t) / L;
  const pitch = 0.3 + 0.42 * Math.sin(TAU * (t / L));
  return mul3(rotY(yaw), rotX(pitch));
};
const nucleusSpin = (t) => mul3(tumble(t), rotZ((TAU * t) / (L / 3)));

const frameTimes = (k) => Array.from({ length: k }, (_, i) => (i * L) / k);

// ---------------------------------------------------------------- geometry --
/** Orthonormal object-space frame for a shell: normal, plus two in-plane axes. */
function shellBasis(tiltDeg) {
  const a = (tiltDeg * Math.PI) / 180;
  const n = [Math.cos(a), Math.sin(a), 0];
  const u = norm(cross(n, [0, 0, 1]));
  const v = cross(n, u);
  return { n, u, v };
}

/**
 * Per-keyframe screen decomposition of one orbit: ellipse rotation psi, signed
 * foreshortening sk, and which drawn half is currently the far one.
 * Sign choices are carried forward frame to frame so the baked value lists stay
 * continuous instead of snapping 180 degrees at the poles.
 */
function orbitTrack(shell, times) {
  const { n: nObj } = shellBasis(shell.tilt);
  const psi = [], sk = [], farA = [], depth = [];
  let prevU = [1, 0, 0];
  let prevPsi = null;
  for (const t of times) {
    const M = tumble(t);
    const nw = norm(apply3(M, nObj));
    let u = cross([0, 0, 1], nw);
    if (Math.hypot(u[0], u[1], u[2]) < 1e-6) u = prevU.slice();
    u = norm(u);
    if (dot(u, prevU) < 0) u = [-u[0], -u[1], -u[2]];
    prevU = u;
    const v = cross(nw, u);
    let a = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
    if (prevPsi !== null) a = prevPsi + ((((a - prevPsi) % 360) + 540) % 360) - 180;
    prevPsi = a;
    const s = Math.cos((a * Math.PI) / 180) * v[1] - Math.sin((a * Math.PI) / 180) * v[0];
    psi.push(num(a));
    sk.push(num2(s));
    farA.push(v[2] > 0);          // half drawn through +y (pre-scale) sits behind
    depth.push(v[2]);
  }
  return { psi, sk, farA, depth };
}

/** One orbit, emitted twice: the far half behind the nucleus, the near half in front. */
function orbitArcs(shell, track, layer) {
  const R = shell.R;
  const arcA = `M ${R} 0 A ${R} ${R} 0 0 1 ${-R} 0`;
  const arcB = `M ${-R} 0 A ${R} ${R} 0 0 1 ${R} 0`;
  // Brightness tracks depth so the crossover is smooth, not a pop.
  const opA = track.depth.map((d) => num2(0.5 - 0.34 * d));
  const opB = track.depth.map((d) => num2(0.5 + 0.34 * d));
  const gateA = track.farA.map((f) => (layer === 'back' ? f : !f));
  const gateB = track.farA.map((f) => (layer === 'back' ? !f : f));
  const gateOf = (flags) => {
    const values = [], keyTimes = [];
    flags.forEach((f, i) => {
      const val = f ? '1' : '0';
      if (i === 0 || values[values.length - 1] !== val) {
        values.push(val);
        keyTimes.push(num2(i / flags.length));
      }
    });
    return animDiscrete('opacity', values, keyTimes, DUR);
  };
  const stroke = layer === 'back' ? C.line : C.warm;
  const path = (d, opacity, g) =>
    `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${layer === 'back' ? 1 : 1.35}" stroke-dasharray="${shell.dash}" vector-effect="non-scaling-stroke" stroke-linecap="round">${anim('stroke-opacity', opacity, DUR)}${g}</path>`;
  return `<g transform="translate(${CX},${CY})"><g>${animTransform('rotate', track.psi, DUR, 'additive="sum"')}${animTransform('scale', track.sk.map((s) => `1 ${s}`), DUR, 'additive="sum"')}<g>${path(arcA, opA, gateOf(gateA))}${path(arcB, opB, gateOf(gateB))}</g></g></g>`;
}

/** Electron positions are computed in object space so they never jump when the
 *  screen-space basis flips sign at the poles. */
function electronTrack(shell, phase) {
  const { u, v } = shellBasis(shell.tilt);
  const fast = frameTimes(KF), slow = frameTimes(KS);
  const pos = (t) => {
    const ph = (TAU * t) / shell.T + phase;
    const p = [0, 1, 2].map((i) => shell.R * (Math.cos(ph) * u[i] + Math.sin(ph) * v[i]));
    return apply3(tumble(t), p);
  };
  const xs = [], ys = [], rs = [], os = [], front = [];
  for (const t of fast) {
    const p = pos(t);
    xs.push(num(CX + p[0]));
    ys.push(num(CY + p[1]));
    front.push(p[2] <= 0);
  }
  for (const t of slow) {
    const d = -pos(t)[2] / shell.R;          // +1 nearest camera, -1 farthest
    rs.push(num2(2.5 + 1.5 * d));
    os.push(num2(clamp(0.62 + 0.38 * d, 0.2, 1)));
  }
  return { xs, ys, rs, os, front };
}

/** Dim wake dots lagging each electron along its orbit — cheap motion trail. */
function electronGhosts(shell, phase) {
  const { u, v } = shellBasis(shell.tilt);
  const times = frameTimes(KS);
  const out = [];
  for (let g = 1; g <= 2; g++) {
    const lag = 0.17 * g;
    const xs = [], ys = [], os = [];
    for (const t of times) {
      const ph = (TAU * t) / shell.T + phase - lag;
      const p = apply3(tumble(t), [0, 1, 2].map((i) =>
        shell.R * (Math.cos(ph) * u[i] + Math.sin(ph) * v[i])));
      xs.push(num(CX + p[0]));
      ys.push(num(CY + p[1]));
      os.push(num2(clamp((0.3 - g * 0.09) * (0.55 + 0.45 * (-p[2] / shell.R)), 0.02, 0.4)));
    }
    out.push(`<circle cx="${xs[0]}" cy="${ys[0]}" r="${num2(2 - g * 0.45)}" fill="${C.pale}">${anim('cx', xs, DUR)}${anim('cy', ys, DUR)}${anim('opacity', os, DUR)}</circle>`);
  }
  return out.join('');
}

function gateFrom(flags, invert = false) {
  const values = [], keyTimes = [];
  flags.forEach((f, i) => {
    const val = (invert ? !f : f) ? '1' : '0';
    if (i === 0 || values[values.length - 1] !== val) {
      values.push(val);
      keyTimes.push(num2(i / flags.length));
    }
  });
  if (values.length === 1) return values[0] === '1' ? '' : `<set attributeName="opacity" to="0"/>`;
  return animDiscrete('opacity', values, keyTimes, DUR);
}

/** Nucleons on a Fibonacci shell, breathing, spun by their own faster matrix. */
function nucleons(count) {
  const slow = frameTimes(KS);
  const base = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = Math.PI * (1 + Math.sqrt(5)) * i;
    base.push({ p: [Math.cos(th) * r, y, Math.sin(th) * r], phase: (i * TAU) / count });
  }
  return base.map((nk, i) => {
    const xs = [], ys = [], rs = [], os = [], front = [];
    for (const t of slow) {
      const breathe = 13.5 + 2.6 * Math.sin((TAU * t) / (L / 4) + nk.phase);
      const p = apply3(nucleusSpin(t), nk.p.map((c) => c * breathe));
      const d = -p[2] / 16;
      xs.push(num(CX + p[0]));
      ys.push(num(CY + p[1]));
      rs.push(num2(5.4 + 1.5 * d));
      os.push(num2(clamp(0.55 + 0.45 * d, 0.25, 1)));
      front.push(p[2] <= 0);
    }
    return { i, xs, ys, rs, os, front, proton: i % 2 === 0 };
  });
}

/** Perspective floor: rows rush toward the viewer, verticals converge on the core. */
function floorGrid() {
  const horizon = 330, depthPx = 102, halfTop = 60, halfBottom = 620;
  const rows = 8;
  const times = frameTimes(32);
  const out = [
    `<line x1="26" y1="${horizon}" x2="954" y2="${horizon}" stroke="${C.line}" stroke-opacity="0.3" stroke-width="1"/>`,
  ];
  for (let i = -7; i <= 7; i++) {
    out.push(`<line x1="${num(CX + i * 16)}" y1="${horizon}" x2="${num(CX + i * 16 * 9.5)}" y2="${horizon + depthPx}" stroke="${C.line}" stroke-opacity="${i === 0 ? 0.22 : 0.1}" stroke-width="1"/>`);
  }
  for (let i = 0; i < rows; i++) {
    const ys = [], x1s = [], x2s = [], ops = [];
    for (const t of times) {
      const f = ((i + 0.5) / rows + t / L) % 1;
      const e = Math.pow(f, 2.6);
      const y = horizon + depthPx * e;
      const half = halfTop + (halfBottom - halfTop) * e;
      ys.push(num(y));
      x1s.push(num(CX - half));
      x2s.push(num(CX + half));
      ops.push(num2(0.08 + 0.42 * Math.min(1, e * 3.4) * (1 - e * 0.35)));
    }
    out.push(`<line x1="${x1s[0]}" y1="${ys[0]}" x2="${x2s[0]}" y2="${ys[0]}" stroke="${C.glow}" stroke-width="1">${anim('x1', x1s, DUR)}${anim('x2', x2s, DUR)}${anim('y1', ys, DUR)}${anim('y2', ys, DUR)}${anim('stroke-opacity', ops, DUR)}</line>`);
  }
  // core light pooling on the deck
  out.push(`<ellipse cx="${CX}" cy="${horizon + 26}" rx="190" ry="26" fill="url(#${ID}-pool)"><animate attributeName="rx" values="176;204;176" dur="6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.55;0.85;0.55" dur="3.4s" repeatCount="indefinite"/></ellipse>`);
  return `<g>${out.join('')}</g>`;
}

// ------------------------------------------------------------------- build --
export function buildAtomCore() {
  const slow = frameTimes(KS);
  const gizmoFrames = slow.map((t) => tumble(t));

  const tracks = SHELLS.map((s) => orbitTrack(s, slow));
  const electrons = SHELLS.flatMap((s, si) =>
    Array.from({ length: s.e }, (_, k) => ({
      id: `${ID}-e${si}${k}`,
      shell: si,
      track: electronTrack(s, (TAU * k) / s.e),
      ghosts: electronGhosts(s, (TAU * k) / s.e),
    })),
  );
  const nucs = nucleons(13);

  const electronDefs = electrons.map(({ id, track }) =>
    `<g id="${id}"><circle cx="${track.xs[0]}" cy="${track.ys[0]}" r="${track.rs[0]}" fill="#fff0d6" filter="url(#${ID}-eglow)">${anim('cx', track.xs, DUR)}${anim('cy', track.ys, DUR)}${anim('r', track.rs, DUR)}${anim('opacity', track.os, DUR)}</circle></g>`,
  ).join('\n');

  const nucleonDefs = nucs.map((n) =>
    `<circle id="${ID}-n${n.i}" cx="${n.xs[0]}" cy="${n.ys[0]}" r="${n.rs[0]}" fill="${n.proton ? '#ff8f2e' : '#e9b183'}" stroke="#5c2a0d" stroke-width="0.8">${anim('cx', n.xs, DUR)}${anim('cy', n.ys, DUR)}${anim('r', n.rs, DUR)}${anim('opacity', n.os, DUR)}</circle>`,
  ).join('\n');

  const useLayer = (items, layer) => items.map((it) => {
    const g = gateFrom(it.track ? it.track.front : it.front, layer === 'back');
    const href = it.id ?? `${ID}-n${it.i}`;
    return `<use href="#${href}">${g}</use>`;
  }).join('');

  // vented photons: one per ray, easing out of the core
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (TAU * i) / 8 + 0.35;
    const x0 = CX + Math.cos(a) * 26, y0 = CY + Math.sin(a) * 26;
    const x1 = CX + Math.cos(a) * 210, y1 = CY + Math.sin(a) * 210;
    const dur = num2(2.6 + (i % 4) * 0.42);
    const begin = num2(-i * 0.55);
    return `<circle r="1.6" fill="${C.pale}"><animateMotion path="M${num(x0)},${num(y0)} L${num(x1)},${num(y1)}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.1 0.8 0.4 1"/><animate attributeName="opacity" values="0;0.95;0" keyTimes="0;0.18;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`;
  }).join('');

  // HUD: spectral bars
  const bars = Array.from({ length: 7 }, (_, i) => {
    const x = 36 + i * 11;
    const h0 = 10 + ((i * 5) % 17);
    const dur = num2(1.9 + (i % 5) * 0.23);
    const hs = [h0, 8 + ((i * 7) % 23), 26 - ((i * 3) % 15), h0];
    return `<rect x="${x}" y="${num(120 - h0)}" width="6" height="${h0}" fill="${C.glow}" opacity="${i % 2 ? 0.85 : 1}">${anim('height', hs.map(num), `${dur}s`)}${anim('y', hs.map((h) => num(120 - h)), `${dur}s`)}</rect>`;
  }).join('');

  const shellRows = SHELLS.map((s, i) => {
    const filled = '■'.repeat(s.e) + '□'.repeat(4 - s.e);
    return `<text x="34" y="${212 + i * 20}" font-family="${MONO}" font-size="11" fill="${C.hot}"><tspan fill="${C.label}">${s.name}</tspan>  ${esc(filled)}  ${s.e}e⁻  r=${s.R}</text>`;
  }).join('\n');

  const body = `<defs>
${chromeDefs(ID)}
<radialGradient id="${ID}-core" cx="0.5" cy="0.5" r="0.5"><stop offset="0%" stop-color="${C.line}" stop-opacity="0.36"/><stop offset="55%" stop-color="#ff4d00" stop-opacity="0.11"/><stop offset="100%" stop-color="#ff4d00" stop-opacity="0"/></radialGradient>
<radialGradient id="${ID}-sphere" cx="0.36" cy="0.32" r="0.72"><stop offset="0%" stop-color="#ffd9a8" stop-opacity="0.9"/><stop offset="45%" stop-color="#ff8a22" stop-opacity="0.55"/><stop offset="100%" stop-color="#7a2c05" stop-opacity="0.85"/></radialGradient>
<radialGradient id="${ID}-pool" cx="0.5" cy="0.5" r="0.5"><stop offset="0%" stop-color="${C.line}" stop-opacity="0.3"/><stop offset="60%" stop-color="${C.line}" stop-opacity="0.08"/><stop offset="100%" stop-color="${C.line}" stop-opacity="0"/></radialGradient>
<filter id="${ID}-eglow" x="-160%" y="-160%" width="420%" height="420%"><feGaussianBlur stdDeviation="4.5" result="b1"/><feGaussianBlur stdDeviation="1.6" result="b2"/><feMerge><feMergeNode in="b1"/><feMergeNode in="b2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<clipPath id="${ID}-clip"><rect x="10" y="8" width="960" height="424" rx="12"/></clipPath>
<clipPath id="${ID}-type"><rect x="806" y="286" width="146" height="14"><animate attributeName="width" values="0;146" dur="1.2s" begin="0.6s" fill="freeze"/></rect></clipPath>
${electronDefs}
${nucleonDefs}
</defs>
${chromeFrame(ID, { w: W, h: H, title: "reactor-core --monitor atom-01 --depth-sort 3d --live · the loop's power plant" })}
<g clip-path="url(#${ID}-clip)">
${twinkles(20260729, 16, { x: 24, y: 52, w: 932, h: 360 })}
${floorGrid()}
<circle cx="${CX}" cy="${CY}" r="96" fill="url(#${ID}-core)"><animate attributeName="r" values="88;108;88" dur="6s" repeatCount="indefinite"/></circle>
<g fill="none" stroke="${C.rule}" stroke-width="1" opacity="0.3"><circle cx="${CX}" cy="${CY}" r="58"/><circle cx="${CX}" cy="${CY}" r="184"/></g>

<!-- far halves of every orbit, behind the core -->
${SHELLS.map((s, i) => orbitArcs(s, tracks[i], 'back')).join('\n')}
<g>${electrons.map((e) => e.ghosts).join('')}</g>
<g>${useLayer(electrons, 'back')}</g>
<g>${useLayer(nucs, 'back')}</g>

<!-- nucleus -->
<circle cx="${CX}" cy="${CY}" r="21" fill="url(#${ID}-sphere)"><animate attributeName="r" values="20;23;20" dur="3.4s" repeatCount="indefinite"/></circle>
<circle cx="${CX}" cy="${CY}" r="26" fill="${C.line}" opacity="0.16" filter="url(#${ID}-glow)"><animate attributeName="opacity" values="0.1;0.26;0.1" dur="3.4s" repeatCount="indefinite"/></circle>
<g>${useLayer(nucs, 'front')}</g>
<g><circle cx="${CX}" cy="${CY}" r="25" fill="none" stroke="${C.warm}" stroke-opacity="0.4" stroke-width="1" stroke-dasharray="2 6"/><animateTransform attributeName="transform" type="rotate" from="0 ${CX} ${CY}" to="-360 ${CX} ${CY}" dur="24s" repeatCount="indefinite"/></g>
<circle cx="${CX}" cy="${CY}" r="30" fill="none" stroke="${C.line}" stroke-width="1"><animate attributeName="r" values="26;74" dur="4s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.55;0" dur="4s" repeatCount="indefinite"/></circle>
<circle cx="${CX}" cy="${CY}" r="30" fill="none" stroke="${C.line}" stroke-width="1"><animate attributeName="r" values="26;74" dur="4s" begin="-2s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.55;0" dur="4s" begin="-2s" repeatCount="indefinite"/></circle>
${rays}

<!-- near halves in front of the core, electrons last so they ride on top -->
${SHELLS.map((s, i) => orbitArcs(s, tracks[i], 'front')).join('\n')}
<g>${useLayer(electrons, 'front')}</g>

<!-- HUD -->
<g font-family="${MONO}">
${hudLabel(34, 76, 'CORE TEMP')}
${bars}
<text x="34" y="140" font-size="9.5" fill="${C.dim}">6.2e8 K · nominal · Δ +0.4%</text>
${hudLabel(34, 168, 'TUMBLE')}
<text x="34" y="188" font-size="11.5" font-weight="600" fill="${C.hot}">yaw 2π/16s · pitch ±24°</text>
${shellRows}
${caret(150, 264)}
</g>
<g font-family="${MONO}" text-anchor="end">
${hudLabel(946, 84, 'DEPTH SORT', { anchor: 'end' })}
<text x="946" y="104" font-size="11.5" font-weight="600" fill="${C.hot}">${8 + 13 + 6} nodes · 2 layers/frame</text>
<text x="946" y="122" font-size="9.5" fill="${C.dim}">near/far split · occlusion on</text>
${hudLabel(946, 154, 'FIELD INTEGRITY', { anchor: 'end' })}
<text x="946" y="174" font-size="11.5" font-weight="600" fill="${C.hot}">■■■■□ 82% stable</text>
${hudLabel(946, 206, 'EMISSION', { anchor: 'end' })}
<text x="946" y="226" font-size="11.5" font-weight="600" fill="${C.hot}">8 γ/s · vented</text>
${hudLabel(946, 258, 'RENDER', { anchor: 'end' })}
<text x="946" y="278" font-size="9.5" fill="${C.dim}">smil keyframes ${KF}/loop · no js</text>
<g clip-path="url(#${ID}-type)"><text x="946" y="296" font-size="11.5" font-weight="600" fill="${C.hot}">route(energy) → ship</text></g>
${caret(949, 288, 5, 10, '0.2s')}
</g>
<rect x="26" y="286" width="104" height="104" rx="10" fill="#160c06" fill-opacity="0.82" stroke="${C.rule}" stroke-width="1"/>
${axisGizmo({ cx: 78, cy: 330, len: 26, frames: gizmoFrames, dur: DUR, label: 'ATOM FRAME' })}
<text x="905" y="352" font-family="${MONO}" font-size="9" fill="${C.dim}" text-anchor="end">loop ${L}s · seamless</text>
<rect x="912" y="345" width="5" height="8" fill="${C.glow}"><animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite"/></rect>
${scanBand(ID, { w: W, h: H, dur: '8.5s' })}
</g>
${chromeOverlay(ID, { w: W, h: H })}`;

  return svgDoc({
    w: W,
    h: H,
    titleId: `${ID}-title`,
    descId: `${ID}-desc`,
    title: 'Reactor core — 3D depth-sorted atom, pure SVG SMIL',
    desc:
      'Animated 3D atom reactor core in pure SVG SMIL with no JavaScript and no CSS: the whole atom tumbles on two axes while three electron shells are recomputed per keyframe from a rotation matrix, each orbit split into near and far halves so the rings pass in front of and behind a nucleus built from thirteen orbiting nucleons; electrons grow and brighten as they swing toward the camera, photons vent from the core, a perspective floor grid rushes past and live telemetry reports core temperature, tumble rate, shell occupancy and depth-sort load. Ray Lin, agentic systems engineer, AI agent infrastructure, Taipei.',
    body,
  });
}
