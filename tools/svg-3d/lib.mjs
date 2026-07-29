// Shared kit for the pure-SMIL 3D asset generators.
//
// Everything here emits declarative SVG only: no JavaScript and no CSS ever
// reaches the artwork. The renderers below precompute keyframes on the host and
// bake them into <animate>/<animateTransform> value lists, which is what makes
// real 3D (perspective, depth sorting, occlusion) possible inside a static
// <img> on a GitHub README.

export const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace";

// Profile palette — warm reactor orange on near-black, matching the rest of
// the README assets.
export const C = {
  bgTop: '#140b06',
  bgBottom: '#0e0804',
  chrome: '#1b0e07',
  border: '#673110',
  rule: '#3b2111',
  dim: '#7a4a24',
  label: '#cc6b2c',
  title: '#c89a72',
  line: '#ff7a1a',
  glow: '#ff8a22',
  warm: '#ffb057',
  hot: '#ffd08a',
  pale: '#ffca88',
  cyan: '#4ad6c8',
  violet: '#a97bff',
};

// ------------------------------------------------------------------ numbers --
/** Compact fixed-point: 1 decimal, trailing ".0" dropped. Keeps value lists small. */
export const num = (n) => {
  const v = Math.round(n * 10) / 10;
  const s = Object.is(v, -0) ? '0' : String(v);
  return s;
};
/** Two decimals for opacities / scales, same trailing-zero trim. */
export const num2 = (n) => {
  const v = Math.round(n * 100) / 100;
  const s = Object.is(v, -0) ? '0' : String(v);
  return s;
};
export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

/** Deterministic PRNG so regenerating the assets is byte-stable. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ------------------------------------------------------------------- linalg --
export const mul3 = (a, b) => {
  const m = new Array(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) m[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return m;
};
export const apply3 = (m, [x, y, z]) => [
  m[0] * x + m[1] * y + m[2] * z,
  m[3] * x + m[4] * y + m[5] * z,
  m[6] * x + m[7] * y + m[8] * z,
];
export const rotX = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
export const rotY = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
export const rotZ = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (v) => {
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
};

/** 4D rotation in the (i,j) plane — used by the tesseract. */
export function rot4(i, j, a) {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const c = Math.cos(a), s = Math.sin(a);
  m[i * 4 + i] = c; m[i * 4 + j] = -s;
  m[j * 4 + i] = s; m[j * 4 + j] = c;
  return m;
}
export const mul4 = (a, b) => {
  const m = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++) m[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return m;
};
export const apply4 = (m, v) => [0, 1, 2, 3].map((r) =>
  m[r * 4] * v[0] + m[r * 4 + 1] * v[1] + m[r * 4 + 2] * v[2] + m[r * 4 + 3] * v[3]);

/**
 * Pinhole projection. World is right-handed with +y down (screen order) and +z
 * pointing away from the camera, so bigger z == farther == smaller.
 */
export function project([x, y, z], { cx, cy, focal = 900, dist = 900 }) {
  const s = focal / Math.max(focal + z + dist - focal, 1); // focal / (dist + z)
  return { x: cx + x * s, y: cy + y * s, s, z };
}
export const projector = (opts) => (p) => project(p, opts);

// ------------------------------------------------------------------ animate --
/** <animate> over a baked value list. */
export const anim = (attr, values, dur, extra = '') =>
  `<animate attributeName="${attr}" values="${values.join(';')}" dur="${dur}" repeatCount="indefinite"${extra ? ' ' + extra : ''}/>`;
/** Discrete <animate> — frame flipping, hard visibility swaps. */
export const animDiscrete = (attr, values, keyTimes, dur) =>
  `<animate attributeName="${attr}" calcMode="discrete" values="${values.join(';')}" keyTimes="${keyTimes.join(';')}" dur="${dur}" repeatCount="indefinite"/>`;
export const animTransform = (type, values, dur, extra = '') =>
  `<animateTransform attributeName="transform" type="${type}" values="${values.join(';')}" dur="${dur}" repeatCount="indefinite" ${extra}/>`;

/**
 * A 0/1 gate baked from a per-keyframe boolean. Emits the fewest possible
 * keyTimes: only the frames where the gate actually flips.
 */
export function gate(flags, dur) {
  const K = flags.length;
  const values = [];
  const keyTimes = [];
  for (let i = 0; i < K; i++) {
    const v = flags[i] ? '1' : '0';
    if (i === 0 || values[values.length - 1] !== v) {
      values.push(v);
      keyTimes.push(num2(i / K));
    }
  }
  if (values.length === 1) return values[0] === '1' ? '' : ' opacity="0"';
  return { values, keyTimes };
}
export function gateAnim(flags, dur) {
  const g = gate(flags, dur);
  if (typeof g === 'string') return g === '' ? '' : '';
  return animDiscrete('opacity', g.values, g.keyTimes, dur);
}

// ------------------------------------------------------------------- chrome --
/**
 * The shared terminal-window chrome every asset in this profile wears:
 * rounded frame, title bar with traffic lights, live pulse, scanline overlay.
 */
export function chromeDefs(id, { glowStd = 2.5 } = {}) {
  return `<linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bgTop}"/><stop offset="1" stop-color="${C.bgBottom}"/></linearGradient>
<linearGradient id="${id}-top" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${C.line}" stop-opacity="0"/><stop offset="0.5" stop-color="${C.line}" stop-opacity="0.8"/><stop offset="1" stop-color="${C.line}" stop-opacity="0"/></linearGradient>
<linearGradient id="${id}-band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.line}" stop-opacity="0"/><stop offset="0.5" stop-color="${C.line}" stop-opacity="0.06"/><stop offset="1" stop-color="${C.line}" stop-opacity="0"/></linearGradient>
<pattern id="${id}-scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#000000" fill-opacity="0.07"/><rect y="2" width="4" height="2" fill="#ffffff" fill-opacity="0.012"/></pattern>
<filter id="${id}-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="${glowStd}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}

export function chromeFrame(id, { w, h, x = 10, y = 8, title }) {
  const iw = w - x * 2;
  const ih = h - y * 2;
  const cx = x + iw / 2;
  return `<rect x="${x}" y="${y}" width="${iw}" height="${ih}" rx="12" fill="url(#${id}-bg)" stroke="${C.border}" stroke-width="1.5"/>
<rect x="${x}" y="${y}" width="${iw}" height="36" rx="12" fill="${C.chrome}"/>
<rect x="${x}" y="${y + 24}" width="${iw}" height="12" fill="${C.chrome}"/>
<rect x="${x + 1}" y="${y}" width="${iw - 2}" height="2" fill="url(#${id}-top)"/>
<circle cx="${x + 24}" cy="${y + 18}" r="5.5" fill="#ff5f56"/>
<circle cx="${x + 44}" cy="${y + 18}" r="5.5" fill="#ffbd2e"/>
<circle cx="${x + 64}" cy="${y + 18}" r="5.5" fill="#27c93f"/>
<text x="${cx}" y="${y + 22}" font-family="${MONO}" font-size="11.5" font-weight="700" fill="${C.title}" text-anchor="middle">${esc(title)}</text>
<circle cx="${x + iw - 24}" cy="${y + 18}" r="3" fill="${C.glow}"><animate attributeName="opacity" values="0.5;1;0.5" dur="2.4s" repeatCount="indefinite"/></circle>
<circle cx="${x + iw - 24}" cy="${y + 18}" r="4" fill="none" stroke="${C.glow}" stroke-width="1"><animate attributeName="r" values="4;10" dur="2.4s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.7;0" dur="2.4s" repeatCount="indefinite"/></circle>`;
}

export const chromeOverlay = (id, { w, h, x = 10, y = 8 }) =>
  `<rect x="${x}" y="${y}" width="${w - x * 2}" height="${h - y * 2}" rx="12" fill="url(#${id}-scan)" clip-path="url(#${id}-clip)" pointer-events="none"/>`;

/** Slow vertical sweep, drawn last inside the clip. */
export const scanBand = (id, { w, h, x = 11, y = 8, dur = '8s' }) =>
  `<rect x="${x}" y="${-64}" width="${w - x * 2}" height="64" fill="url(#${id}-band)"><animate attributeName="y" values="-64;${h}" dur="${dur}" repeatCount="indefinite"/></rect>`;

/** Field of faint twinkling motes; deterministic from `seed`. */
export function twinkles(seed, count, box) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const x = box.x + r() * box.w;
    const y = box.y + r() * box.h;
    const rad = 0.8 + r() * 0.5;
    const dur = 3.2 + r() * 2.2;
    const begin = -r() * 5;
    out.push(`<circle cx="${num(x)}" cy="${num(y)}" r="${num2(rad)}" fill="${C.warm}" opacity="0.2"><animate attributeName="opacity" values="0.1;0.65;0.1" dur="${num2(dur)}s" begin="${num2(begin)}s" repeatCount="indefinite"/></circle>`);
  }
  return out.join('\n');
}

/** Small caps label with the orange tick, as used across the profile HUDs. */
export const hudLabel = (x, y, text, { anchor = 'start' } = {}) =>
  `<rect x="${anchor === 'end' ? x - 6 : x}" y="${anchor === 'end' ? y - 16 : y - 8}" width="6" height="3" fill="${C.line}"/>
<text x="${anchor === 'end' ? x : x + 12}" y="${y}" font-family="${MONO}" font-size="10" font-weight="700" fill="${C.label}" letter-spacing="2" text-anchor="${anchor}">${esc(text)}</text>`;

export const caret = (x, y, w = 5, h = 10, begin = '0s') =>
  `<rect x="${num(x)}" y="${num(y)}" width="${w}" height="${h}" fill="${C.glow}"><animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1.1s" begin="${begin}" repeatCount="indefinite"/></rect>`;

/**
 * Live 3D axis gizmo: the same rotation matrix the scene uses, drawn as three
 * projected axes so the viewer can read the orientation at a glance.
 */
export function axisGizmo({ cx, cy, len = 26, frames, dur, label = 'ORIENT' }) {
  const axes = [
    { v: [1, 0, 0], name: 'x', color: C.line },
    { v: [0, 1, 0], name: 'y', color: C.warm },
    { v: [0, 0, 1], name: 'z', color: C.hot },
  ];
  const parts = [
    `<circle cx="${cx}" cy="${cy}" r="${len + 8}" fill="none" stroke="${C.rule}" stroke-width="1" opacity="0.6"/>`,
    `<text x="${cx}" y="${cy + len + 24}" font-family="${MONO}" font-size="8.5" fill="${C.dim}" text-anchor="middle" letter-spacing="1.4">${esc(label)}</text>`,
  ];
  for (const ax of axes) {
    const xs = [], ys = [], os = [], tx = [], ty = [];
    for (const M of frames) {
      const p = apply3(M, ax.v);
      xs.push(num(cx + p[0] * len));
      ys.push(num(cy + p[1] * len));
      os.push(num2(0.35 + 0.55 * (1 - (p[2] + 1) / 2)));
      tx.push(num(cx + p[0] * (len + 9)));
      ty.push(num(cy + p[1] * (len + 9) + 3));
    }
    parts.push(
      `<line x1="${cx}" y1="${cy}" x2="${xs[0]}" y2="${ys[0]}" stroke="${ax.color}" stroke-width="1.4" stroke-linecap="round">${anim('x2', xs, dur)}${anim('y2', ys, dur)}${anim('stroke-opacity', os, dur)}</line>`,
      `<text x="${tx[0]}" y="${ty[0]}" font-family="${MONO}" font-size="8.5" fill="${ax.color}" text-anchor="middle" opacity="0.8">${ax.name}${anim('x', tx, dur)}${anim('y', ty, dur)}${anim('opacity', os, dur)}</text>`,
    );
  }
  return parts.join('\n');
}

/** Wrap the document. */
export function svgDoc({ w, h, titleId, descId, title, desc, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="${titleId} ${descId}">
<title id="${titleId}">${esc(title)}</title>
<desc id="${descId}">${esc(desc)}</desc>
${body}
</svg>
`;
}
