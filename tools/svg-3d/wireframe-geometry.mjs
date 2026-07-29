// Geometry bay — three renderers, zero JavaScript, zero CSS.
//
//   bay 01  tesseract   a 4-cube rotating in the xw and zw planes, projected
//                       4D -> 3D -> 2D, so edges swell and shrink as vertices
//                       move through w;
//   bay 02  icosphere   a *solid* icosahedron: 20 faces, per-frame backface
//                       culling and Lambert shading. Culling is what makes a
//                       convex solid render correctly without a z-buffer;
//   bay 03  torus knot  a (2,3) knot swept as depth-cued polyline segments with
//                       a packet running the loop.
//
// Everything below is baked into <animate> value lists at generation time.

import {
  C, MONO, TAU, num, num2, esc, mul3, apply3, rotX, rotY, rotZ, cross, norm, dot,
  anim, animDiscrete, chromeDefs, chromeFrame, chromeOverlay, scanBand, twinkles,
  axisGizmo, svgDoc, clamp, lerp,
} from './lib.mjs';

const ID = 'wf';
const W = 980, H = 372;
const L = 12;
const DUR = `${L}s`;
const K = 32;        // keyframes for the wireframe + solid bays
const KK = 26;       // keyframes for the knot (slower, cheaper)

const BAYS = [
  { cx: 186, cy: 168 },
  { cx: 490, cy: 168 },
  { cx: 794, cy: 168 },
];

const times = (k) => Array.from({ length: k }, (_, i) => (i * L) / k);
const persp = (p, focal = 620) => {
  const s = focal / (focal + p[2]);
  return { x: p[0] * s, y: p[1] * s, s, z: p[2] };
};

const gateOf = (flags) => {
  const values = [], keyTimes = [];
  flags.forEach((f, i) => {
    const v = f ? '1' : '0';
    if (i === 0 || values[values.length - 1] !== v) {
      values.push(v);
      keyTimes.push(num2(i / flags.length));
    }
  });
  if (values.length === 1) return values[0] === '1' ? '' : `<set attributeName="opacity" to="0"/>`;
  return animDiscrete('opacity', values, keyTimes, DUR);
};

// ------------------------------------------------------------- bay 01 · 4d --
function tesseract({ cx, cy }) {
  const R = 36;
  const verts = [];
  for (let i = 0; i < 16; i++)
    verts.push([(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1, (i & 8) ? 1 : -1]);
  const edges = [];
  for (let a = 0; a < 16; a++)
    for (let b = a + 1; b < 16; b++) {
      const d = a ^ b;
      if (d && (d & (d - 1)) === 0) edges.push([a, b]);
    }

  const rot4 = (i, j, ang) => {
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const c = Math.cos(ang), s = Math.sin(ang);
    m[i * 4 + i] = c; m[i * 4 + j] = -s; m[j * 4 + i] = s; m[j * 4 + j] = c;
    return m;
  };
  const mm = (a, b) => {
    const m = new Array(16).fill(0);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) m[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
    return m;
  };
  const ap = (m, v) => [0, 1, 2, 3].map((r) =>
    m[r * 4] * v[0] + m[r * 4 + 1] * v[1] + m[r * 4 + 2] * v[2] + m[r * 4 + 3] * v[3]);

  // per-frame projected vertices
  const frames = times(K).map((t) => {
    const u = t / L;
    const M = mm(mm(rot4(0, 3, TAU * u), rot4(2, 3, TAU * u * 2)), rot4(0, 2, TAU * u));
    const M3 = mul3(rotY(TAU * u * 0.5), rotX(0.5));
    return verts.map((v) => {
      const q = ap(M, v);
      const kw = 2.9 / (2.9 - q[3]);                      // 4D -> 3D
      const p3 = apply3(M3, [q[0] * kw * R, q[1] * kw * R, q[2] * kw * R]);
      const p = persp(p3);
      return { x: cx + p.x, y: cy + p.y, z: p.z, w: q[3] };
    });
  });

  const parts = [];
  for (const [a, b] of edges) {
    const pts = [], ops = [], ws = [];
    for (const f of frames) {
      const A = f[a], B = f[b];
      pts.push(`${num(A.x)},${num(A.y)} ${num(B.x)},${num(B.y)}`);
      const depth = (A.z + B.z) / 2;
      const wAvg = (A.w + B.w) / 2;
      ops.push(num2(clamp(0.24 + 0.5 * (1 - (depth + 120) / 240) + 0.16 * wAvg, 0.08, 0.95)));
      ws.push(num2(clamp(0.7 + 0.55 * wAvg, 0.5, 1.5)));
    }
    parts.push(`<polyline points="${pts[0]}" fill="none" stroke="${C.warm}" stroke-linecap="round">${anim('points', pts, DUR)}${anim('stroke-opacity', ops, DUR)}${anim('stroke-width', ws, DUR)}</polyline>`);
  }
  // corner nodes
  for (let i = 0; i < 16; i++) {
    const xs = [], ys = [], rs = [], os = [];
    for (const f of frames) {
      xs.push(num(f[i].x));
      ys.push(num(f[i].y));
      rs.push(num2(1.1 + 0.9 * (f[i].w + 1) / 2));
      os.push(num2(clamp(0.35 + 0.45 * (f[i].w + 1) / 2, 0.2, 0.95)));
    }
    parts.push(`<circle cx="${xs[0]}" cy="${ys[0]}" r="${rs[0]}" fill="${C.hot}">${anim('cx', xs, DUR)}${anim('cy', ys, DUR)}${anim('r', rs, DUR)}${anim('opacity', os, DUR)}</circle>`);
  }
  return parts.join('');
}

// ---------------------------------------------------------- bay 02 · solid --
function icosphere({ cx, cy }) {
  const R = 70;
  const p = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0],
    [0, -1, p], [0, 1, p], [0, -1, -p], [0, 1, -p],
    [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1],
  ];
  const V = raw.map((v) => norm(v).map((c) => c * R));
  const F = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const LIGHT = norm([-0.45, -0.6, -0.66]);

  const frames = times(K).map((t) => {
    const u = t / L;
    const M = mul3(mul3(rotY(TAU * u), rotX(0.42 * Math.sin(TAU * u) + 0.25)), rotZ(TAU * u * 0.5));
    return V.map((v) => apply3(M, v));
  });

  const parts = [];
  for (const face of F) {
    const pts = [], fills = [], gate = [], strokes = [];
    for (const fr of frames) {
      const [a, b, c] = face.map((i) => fr[i]);
      const n = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
      const visible = n[2] < -0.02;                       // outward normal toward camera
      gate.push(visible);
      const lam = Math.max(0, dot(n, LIGHT));
      const P = [a, b, c].map((v) => persp(v));
      pts.push(P.map((q) => `${num(cx + q.x)},${num(cy + q.y)}`).join(' '));
      fills.push(num2(0.07 + 0.72 * Math.pow(lam, 1.25)));
      strokes.push(num2(0.22 + 0.7 * lam));
    }
    parts.push(`<polygon points="${pts[0]}" fill="#ff9a3d" stroke="${C.hot}" stroke-width="0.9" stroke-linejoin="round">${anim('points', pts, DUR)}${anim('fill-opacity', fills, DUR)}${anim('stroke-opacity', strokes, DUR)}${gateOf(gate)}</polygon>`);
  }

  // two packets riding the outside of the sphere
  for (let k = 0; k < 2; k++) {
    const xs = [], ys = [], rs = [], os = [];
    for (const t of times(K)) {
      const u = t / L;
      const th = TAU * (u * (k ? -1.5 : 2) + k * 0.5);
      const tilt = 0.5 + k * 0.7;
      const v = [Math.cos(th) * (R + 16), Math.sin(th) * (R + 16) * Math.sin(tilt), Math.sin(th) * (R + 16) * Math.cos(tilt)];
      const q = persp(v);
      xs.push(num(cx + q.x));
      ys.push(num(cy + q.y));
      rs.push(num2(1.4 + 1.3 * q.s));
      os.push(num2(clamp(0.3 + 0.7 * (1 - (q.z + 110) / 220), 0.2, 1)));
    }
    parts.push(`<circle cx="${xs[0]}" cy="${ys[0]}" r="${rs[0]}" fill="${C.hot}" filter="url(#${ID}-glow)">${anim('cx', xs, DUR)}${anim('cy', ys, DUR)}${anim('r', rs, DUR)}${anim('opacity', os, DUR)}</circle>`);
  }
  return parts.join('');
}

// ----------------------------------------------------------- bay 03 · knot --
function torusKnot({ cx, cy }) {
  const N = 60, SEG = 10, PER = N / SEG;
  const P = 2, Q = 3, S = 29;
  const point = (th) => {
    const r = 2 + Math.cos(Q * th);
    return [r * Math.cos(P * th) * S, r * Math.sin(P * th) * S, Math.sin(Q * th) * S * 1.5];
  };
  const frames = times(KK).map((t) => {
    const u = t / L;
    const M = mul3(rotY(TAU * u), rotX(0.5 + 0.35 * Math.sin(TAU * u)));
    return Array.from({ length: N + 1 }, (_, i) => {
      const q = persp(apply3(M, point((TAU * i) / N)));
      return { x: cx + q.x, y: cy + q.y, z: q.z };
    });
  });

  const parts = [];
  for (let s = 0; s < SEG; s++) {
    const pts = [], ops = [], ws = [];
    for (const fr of frames) {
      const slice = [];
      let depth = 0;
      for (let i = 0; i <= PER; i++) {
        const p = fr[(s * PER + i) % N];
        slice.push(`${num(p.x)},${num(p.y)}`);
        depth += p.z;
      }
      depth /= PER + 1;
      pts.push(slice.join(' '));
      ops.push(num2(clamp(1.05 - (depth + 90) / 190, 0.22, 1)));
      ws.push(num2(clamp(3.1 - (depth + 90) / 95, 1.2, 3.2)));
    }
    parts.push(`<polyline points="${pts[0]}" fill="none" stroke="${C.line}" stroke-linecap="round" stroke-linejoin="round">${anim('points', pts, DUR)}${anim('stroke-opacity', ops, DUR)}${anim('stroke-width', ws, DUR)}</polyline>`);
  }
  // packet running the knot
  for (let k = 0; k < 2; k++) {
    const xs = [], ys = [], rs = [];
    for (let i = 0; i < KK * 2; i++) {
      const t = (i * L) / (KK * 2);
      const u = t / L;
      const M = mul3(rotY(TAU * u), rotX(0.5 + 0.35 * Math.sin(TAU * u)));
      const q = persp(apply3(M, point(TAU * (u * 2 + k * 0.5))));
      xs.push(num(cx + q.x));
      ys.push(num(cy + q.y));
      rs.push(num2(1.5 + 1.6 * (q.s - 0.85) * 6));
    }
    parts.push(`<circle cx="${xs[0]}" cy="${ys[0]}" r="2" fill="#fff0d6" filter="url(#${ID}-glow)">${anim('cx', xs, DUR)}${anim('cy', ys, DUR)}${anim('r', rs.map((r) => num2(clamp(Number(r), 1.2, 3.4))), DUR)}</circle>`);
  }
  return parts.join('');
}

// ------------------------------------------------------------------- build --
export function buildGeometryBay() {
  const gizmoFrames = times(K).map((t) => {
    const u = t / L;
    return mul3(rotY(TAU * u), rotX(0.42 * Math.sin(TAU * u) + 0.25));
  });

  const pedestal = ({ cx, cy }, rx) =>
    `<ellipse cx="${cx}" cy="${cy + 112}" rx="${rx}" ry="${num(rx * 0.13)}" fill="none" stroke="${C.rule}" stroke-width="1" opacity="0.85"/>
<ellipse cx="${cx}" cy="${cy + 112}" rx="${num(rx * 0.58)}" ry="${num(rx * 0.075)}" fill="none" stroke="${C.rule}" stroke-width="1" opacity="0.5"/>
<ellipse cx="${cx}" cy="${cy + 112}" rx="${num(rx * 0.75)}" ry="${num(rx * 0.1)}" fill="url(#${ID}-pool)"><animate attributeName="opacity" values="0.5;0.9;0.5" dur="4.5s" repeatCount="indefinite"/></ellipse>`;

  const bayLabel = ({ cx, cy }, tag, name, spec) =>
    `<text x="${cx}" y="${cy + 128}" font-family="${MONO}" font-size="10" font-weight="700" fill="${C.label}" text-anchor="middle" letter-spacing="2">${esc(tag)}</text>
<text x="${cx}" y="${cy + 144}" font-family="${MONO}" font-size="10.5" font-weight="600" fill="${C.hot}" text-anchor="middle">${esc(name)}</text>
<text x="${cx}" y="${cy + 158}" font-family="${MONO}" font-size="9" fill="${C.dim}" text-anchor="middle">${esc(spec)}</text>`;

  const body = `<defs>
${chromeDefs(ID, { glowStd: 2.2 })}
<radialGradient id="${ID}-pool" cx="0.5" cy="0.5" r="0.5"><stop offset="0%" stop-color="${C.line}" stop-opacity="0.34"/><stop offset="100%" stop-color="${C.line}" stop-opacity="0"/></radialGradient>
<clipPath id="${ID}-clip"><rect x="10" y="8" width="960" height="${H - 16}" rx="12"/></clipPath>
</defs>
${chromeFrame(ID, { w: W, h: H, title: 'geometry-bay --render 4d,solid,knot · pure-smil 3d — no js, no css' })}
<g clip-path="url(#${ID}-clip)">
${twinkles(70430, 12, { x: 24, y: 52, w: 932, h: 290 })}
<line x1="338" y1="52" x2="338" y2="330" stroke="${C.rule}" stroke-width="1" stroke-dasharray="2 5" opacity="0.6"/>
<line x1="642" y1="52" x2="642" y2="330" stroke="${C.rule}" stroke-width="1" stroke-dasharray="2 5" opacity="0.6"/>
<text x="26" y="62" font-family="${MONO}" font-size="9.5" fill="${C.dim}">renderer: svg+smil · objects: 3 · faces: 20 culled/frame · edges: 42 · keyframes: ${K}/loop</text>
<rect x="588" y="54" width="5" height="9" fill="${C.glow}"><animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1.1s" repeatCount="indefinite"/></rect>

${pedestal(BAYS[0], 96)}
${pedestal(BAYS[1], 96)}
${pedestal(BAYS[2], 96)}

<g>${tesseract(BAYS[0])}</g>
<g>${icosphere(BAYS[1])}</g>
<g>${torusKnot(BAYS[2])}</g>

${bayLabel(BAYS[0], 'BAY 01', 'tesseract · 4-cube', '16 v · 32 e · rot xw+zw')}
${bayLabel(BAYS[1], 'BAY 02', 'icosphere · solid', '20 f · backface cull · lambert')}
${bayLabel(BAYS[2], 'BAY 03', 'torus knot (2,3)', '60 samples · 10 depth bands')}

${axisGizmo({ cx: 906, cy: 88, len: 20, frames: gizmoFrames, dur: DUR, label: 'WORLD' })}
${scanBand(ID, { w: W, h: H, dur: '9s' })}
</g>
${chromeOverlay(ID, { w: W, h: H })}`;

  return svgDoc({
    w: W,
    h: H,
    titleId: `${ID}-title`,
    descId: `${ID}-desc`,
    title: 'Geometry bay — 4D tesseract, solid icosphere and torus knot in pure SVG SMIL',
    desc:
      'Three animated 3D renders with no JavaScript and no CSS: a tesseract rotating through the xw and zw planes and projected from four dimensions down to two, a solid icosahedron whose twenty faces are backface-culled and Lambert-shaded every frame, and a (2,3) torus knot drawn as depth-cued polyline bands with packets running the loop — a render test for the agent runtime by Ray Lin, agentic systems engineer, Taipei.',
    body,
  });
}
