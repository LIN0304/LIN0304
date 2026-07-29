// ASCII bay — 3D rendered as text, two ways, still zero JavaScript.
//
//   left    a torus raster: every frame is a real render — z-buffer, surface
//           normals, Lambert shading — quantised to the ramp ".,-~:;=!*#$@" and
//           flipped at 11 fps by discrete SMIL opacity gates;
//   centre  the HUD: live ramp legend, buffer stats, block-glyph equaliser;
//   right   a glyph sphere: 56 characters placed on a Fibonacci sphere and
//           moved by interpolated SMIL, each scaled and lit by its own depth.
//
// Rows are emitted as trimmed <tspan>s with an explicit textLength, so columns
// stay locked to the grid whatever monospace font the reader happens to have.

import {
  C, MONO, TAU, num, num2, esc, mul3, apply3, rotX, rotY, clamp,
  anim, animDiscrete, chromeDefs, chromeFrame, chromeOverlay, scanBand, twinkles,
  hudLabel, caret, axisGizmo, svgDoc,
} from './lib.mjs';

const ID = 'ax';
const W = 980, H = 420;

// -------------------------------------------------------------- raster bay --
const COLS = 36, ROWS = 18;
const FRAMES = 44;
const FPS = 11;
const RASTER_DUR = `${FRAMES / FPS}s`;
const RAMP = '.,-~:;=!*#$@';
const HOT = 8;                    // ramp index at which a cell counts as "hot"
const FS = 13;                    // font-size of the raster
const CW = FS * 0.6;              // monospace advance width
const LH = 14;                    // line height
const OX = 34, OY = 84;           // top-left of the raster grid

const R1 = 1, R2 = 2, K2 = 5.6;
const CELL_ASPECT = (FS * 0.6) / LH;      // a character cell is wider than tall in x

/**
 * One fixed scale for the whole loop, solved from the widest frame, so the
 * torus never pumps in size between frames.
 */
const FIT = (() => {
  let mx = 0, my = 0;
  for (let f = 0; f < 12; f++) {
    const A = (TAU * f) / 12, B = (TAU * f * 2) / 12;
    const cosA = Math.cos(A), sinA = Math.sin(A), cosB = Math.cos(B), sinB = Math.sin(B);
    for (let th = 0; th < TAU; th += 0.1)
      for (let ph = 0; ph < TAU; ph += 0.1) {
        const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
        const cx0 = R2 + R1 * ct, cy0 = R1 * st;
        const x = cx0 * (cosB * cp + sinA * sinB * sp) - cy0 * cosA * sinB;
        const y = cx0 * (sinB * cp - sinA * cosB * sp) + cy0 * cosA * cosB;
        const ooz = 1 / (K2 + cosA * cx0 * sp + cy0 * sinA);
        mx = Math.max(mx, Math.abs(x * ooz));
        my = Math.max(my, Math.abs(y * ooz));
      }
  }
  const yScale = Math.min((ROWS / 2 - 0.6) / my, (COLS / 2 - 0.6) / (mx / CELL_ASPECT));
  return { xScale: yScale / CELL_ASPECT, yScale };
})();

/** One frame of the torus: classic z-buffered ASCII render. */
function donutFrame(A, B) {
  const chars = new Array(COLS * ROWS).fill(-1);
  const zbuf = new Array(COLS * ROWS).fill(0);
  const cosA = Math.cos(A), sinA = Math.sin(A);
  const cosB = Math.cos(B), sinB = Math.sin(B);
  for (let th = 0; th < TAU; th += 0.06) {
    const ct = Math.cos(th), st = Math.sin(th);
    for (let ph = 0; ph < TAU; ph += 0.015) {
      const cp = Math.cos(ph), sp = Math.sin(ph);
      const cx0 = R2 + R1 * ct;
      const cy0 = R1 * st;
      const x = cx0 * (cosB * cp + sinA * sinB * sp) - cy0 * cosA * sinB;
      const y = cx0 * (sinB * cp - sinA * cosB * sp) + cy0 * cosA * cosB;
      const z = K2 + cosA * cx0 * sp + cy0 * sinA;
      const ooz = 1 / z;
      const xp = Math.round(COLS / 2 - 0.5 + FIT.xScale * ooz * x);
      const yp = Math.round(ROWS / 2 - 0.5 - FIT.yScale * ooz * y);
      if (xp < 0 || xp >= COLS || yp < 0 || yp >= ROWS) continue;
      const lum =
        cp * ct * sinB - cosA * ct * sp - sinA * st + cosB * (cosA * st - ct * sinA * sp);
      if (lum <= 0) continue;
      const idx = yp * COLS + xp;
      if (ooz > zbuf[idx]) {
        zbuf[idx] = ooz;
        chars[idx] = Math.min(RAMP.length - 1, Math.max(0, Math.round(lum * 7.2)));
      }
    }
  }
  return chars;
}

/** Trimmed <tspan> rows for one luminance tier of one frame. */
function tierRows(chars, hot) {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    let line = '';
    for (let c = 0; c < COLS; c++) {
      const v = chars[r * COLS + c];
      const inTier = v >= 0 && (hot ? v >= HOT : v < HOT);
      line += inTier ? RAMP[v] : ' ';
    }
    const start = line.search(/\S/);
    if (start < 0) continue;
    const end = line.replace(/\s+$/, '').length;
    const text = line.slice(start, end);
    rows.push(
      `<tspan x="${num(OX + start * CW)}" y="${num(OY + r * LH)}" textLength="${num(text.length * CW)}">${esc(text)}</tspan>`,
    );
  }
  return rows.join('');
}

function rasterBay() {
  const groups = [];
  for (let f = 0; f < FRAMES; f++) {
    const u = f / FRAMES;
    const chars = donutFrame(TAU * u, TAU * u * 2);
    const base = tierRows(chars, false);
    const hot = tierRows(chars, true);
    const keyTimes = f === 0 ? ['0', num2(1 / FRAMES)] : ['0', num2(f / FRAMES), num2((f + 1) / FRAMES)];
    const values = f === 0 ? ['1', '0'] : ['0', '1', '0'];
    groups.push(
      `<g${f === 0 ? '' : ' opacity="0"'}>${animDiscrete('opacity', values, keyTimes, RASTER_DUR)}` +
      `<text font-family="${MONO}" font-size="${FS}" fill="${C.label}" xml:space="preserve" lengthAdjust="spacingAndGlyphs">${base}</text>` +
      `<text font-family="${MONO}" font-size="${FS}" fill="${C.hot}" xml:space="preserve" lengthAdjust="spacingAndGlyphs" filter="url(#${ID}-soft)">${hot}</text>` +
      `</g>`,
    );
  }
  return groups.join('\n');
}

// --------------------------------------------------------- glyph sphere bay --
const SPHERE_CX = 786, SPHERE_CY = 196, SPHERE_R = 104;
const SPHERE_L = 12;                 // seconds
const SPHERE_K = 28, SPHERE_KS = 14;
const GLYPHS = 'AGENTLOOP01EVAL01ROUTE01SHIP01TRACE01MEMORY01GATE01TOOL01';

function glyphSphere() {
  const n = 56;
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = Math.PI * (1 + Math.sqrt(5)) * i;
    nodes.push({
      p: [Math.cos(th) * rr * SPHERE_R, y * SPHERE_R, Math.sin(th) * rr * SPHERE_R],
      ch: GLYPHS[i % GLYPHS.length],
    });
  }
  const M = (t) => {
    const u = t / SPHERE_L;
    return mul3(rotY(TAU * u), rotX(0.34 * Math.sin(TAU * u) + 0.18));
  };
  const dur = `${SPHERE_L}s`;
  const out = [];
  for (const node of nodes) {
    const xs = [], ys = [], fs = [], os = [];
    for (let i = 0; i < SPHERE_K; i++) {
      const p = apply3(M((i * SPHERE_L) / SPHERE_K), node.p);
      const s = 620 / (620 + p[2]);
      xs.push(num(SPHERE_CX + p[0] * s));
      ys.push(num(SPHERE_CY + p[1] * s + 4));
    }
    for (let i = 0; i < SPHERE_KS; i++) {
      const p = apply3(M((i * SPHERE_L) / SPHERE_KS), node.p);
      const d = -p[2] / SPHERE_R;                       // +1 nearest
      fs.push(num(8 + 5.5 * (d + 1) / 2));
      os.push(num2(clamp(0.14 + 0.86 * Math.pow((d + 1) / 2, 1.7), 0.1, 1)));
    }
    out.push(
      `<text x="${xs[0]}" y="${ys[0]}" font-family="${MONO}" font-size="${fs[0]}" fill="${C.warm}" text-anchor="middle">${esc(node.ch)}${anim('x', xs, dur)}${anim('y', ys, dur)}${anim('font-size', fs, dur)}${anim('opacity', os, dur)}</text>`,
    );
  }
  // equator ribbon: three packets circling the glyph shell
  for (let k = 0; k < 3; k++) {
    const xs = [], ys = [], rs = [];
    for (let i = 0; i < SPHERE_K; i++) {
      const t = (i * SPHERE_L) / SPHERE_K;
      const th = TAU * (t / SPHERE_L) * (k === 1 ? -1 : 1) + (k * TAU) / 3;
      const p = apply3(M(t), [
        Math.cos(th) * (SPHERE_R + 14),
        Math.sin(th) * (SPHERE_R + 14) * 0.25,
        Math.sin(th) * (SPHERE_R + 14) * 0.96,
      ]);
      const s = 620 / (620 + p[2]);
      xs.push(num(SPHERE_CX + p[0] * s));
      ys.push(num(SPHERE_CY + p[1] * s));
      rs.push(num2(1 + 1.8 * s * (p[2] < 0 ? 1 : 0.45)));
    }
    out.push(`<circle cx="${xs[0]}" cy="${ys[0]}" r="${rs[0]}" fill="#fff0d6" filter="url(#${ID}-glow)">${anim('cx', xs, dur)}${anim('cy', ys, dur)}${anim('r', rs, dur)}</circle>`);
  }
  return out.join('');
}

// ---------------------------------------------------------------- hud bits --
/** Block-glyph equaliser: each column flips through ▁▂▃▄▅▆▇█ on its own clock. */
function equaliser(x, y, cols = 12) {
  const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const out = [];
  for (let c = 0; c < cols; c++) {
    const steps = 6;
    const dur = `${num2(1.6 + (c % 5) * 0.34)}s`;
    const seq = Array.from({ length: steps }, (_, i) =>
      BLOCKS[Math.floor(3.6 + 3.4 * Math.sin((TAU * i) / steps + c * 1.1)) % BLOCKS.length]);
    seq.forEach((glyph, i) => {
      const kt = [0, i / steps, (i + 1) / steps].map(num2);
      const vals = i === 0 ? ['1', '0'] : ['0', '1', '0'];
      const keyTimes = i === 0 ? ['0', num2(1 / steps)] : kt;
      out.push(`<text x="${num(x + c * 11)}" y="${y}" font-family="${MONO}" font-size="12" fill="${c % 3 === 0 ? C.glow : C.label}"${i === 0 ? '' : ' opacity="0"'}>${glyph}${animDiscrete('opacity', vals, keyTimes, dur)}</text>`);
    });
  }
  return out.join('');
}

/** The ramp legend with a highlight box stepping along it. */
function rampLegend(x, y) {
  const steps = RAMP.length;
  const xs = [], dur = `${num2(steps / 6)}s`;
  for (let i = 0; i < steps; i++) xs.push(num(x + i * 8.4 - 1));
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="14" fill="${C.hot}" letter-spacing="0" xml:space="preserve" textLength="${num(steps * 8.4)}" lengthAdjust="spacingAndGlyphs">${esc(RAMP)}</text>
<rect x="${xs[0]}" y="${y - 12}" width="10" height="16" fill="none" stroke="${C.glow}" stroke-width="1" opacity="0.8">${animDiscrete('x', xs, xs.map((_, i) => num2(i / steps)), dur)}</rect>`;
}

// ------------------------------------------------------------------- build --
export function buildAsciiBay() {
  const gizmoFrames = Array.from({ length: SPHERE_K }, (_, i) => {
    const u = i / SPHERE_K;
    return mul3(rotY(TAU * u), rotX(0.34 * Math.sin(TAU * u) + 0.18));
  });

  const body = `<defs>
${chromeDefs(ID, { glowStd: 2 })}
<filter id="${ID}-soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<radialGradient id="${ID}-pool" cx="0.5" cy="0.5" r="0.5"><stop offset="0%" stop-color="${C.line}" stop-opacity="0.22"/><stop offset="100%" stop-color="${C.line}" stop-opacity="0"/></radialGradient>
<clipPath id="${ID}-clip"><rect x="10" y="8" width="960" height="${H - 16}" rx="12"/></clipPath>
</defs>
${chromeFrame(ID, { w: W, h: H, title: 'ascii-bay --render torus,glyph-sphere · z-buffer + smil · 11 fps · no js' })}
<g clip-path="url(#${ID}-clip)">
${twinkles(880304, 10, { x: 24, y: 52, w: 932, h: 340 })}
<line x1="352" y1="52" x2="352" y2="392" stroke="${C.rule}" stroke-width="1" stroke-dasharray="2 5" opacity="0.6"/>
<line x1="614" y1="52" x2="614" y2="392" stroke="${C.rule}" stroke-width="1" stroke-dasharray="2 5" opacity="0.6"/>

<!-- bay 01 · z-buffered torus raster -->
<ellipse cx="192" cy="368" rx="140" ry="16" fill="url(#${ID}-pool)"/>
<text x="34" y="66" font-family="${MONO}" font-size="9.5" fill="${C.dim}">torus.raster · ${COLS}×${ROWS} cells · z-buffer on · ${FRAMES} frames/loop</text>
<g>${rasterBay()}</g>
<text x="34" y="382" font-family="${MONO}" font-size="10" font-weight="700" fill="${C.label}" letter-spacing="2">BAY 01 · ASCII RASTER</text>
<text x="34" y="396" font-family="${MONO}" font-size="9" fill="${C.dim}">lambert shading → ramp quantise → discrete smil flip</text>

<!-- centre · hud -->
<g font-family="${MONO}">
${hudLabel(378, 82, 'LUMA RAMP')}
${rampLegend(378, 108)}
<text x="378" y="126" font-size="9" fill="${C.dim}">dark → bright · 12 steps</text>
${hudLabel(378, 160, 'BUFFERS')}
<text x="378" y="180" font-size="11" font-weight="600" fill="${C.hot}">z-buffer  ${COLS * ROWS} cells</text>
<text x="378" y="196" font-size="11" font-weight="600" fill="${C.hot}">glyphs    56 nodes</text>
<text x="378" y="212" font-size="11" font-weight="600" fill="${C.hot}">rate      ${FPS} fps · ${FRAMES}f loop</text>
${hudLabel(378, 246, 'SIGNAL')}
${equaliser(378, 274)}
${hudLabel(378, 308, 'PIPELINE')}
<text x="378" y="328" font-size="10.5" fill="${C.hot}">shade → quantise → flip</text>
<text x="378" y="344" font-size="10.5" fill="${C.hot}">rotate → project → scale</text>
${caret(378, 356, 5, 10, '0.3s')}
<text x="378" y="396" font-size="9" fill="${C.dim}">no js · no css · pure smil</text>
</g>

<!-- bay 03 · glyph sphere -->
<ellipse cx="${SPHERE_CX}" cy="368" rx="140" ry="16" fill="url(#${ID}-pool)"/>
<text x="946" y="66" font-family="${MONO}" font-size="9.5" fill="${C.dim}" text-anchor="end">glyph.sphere · 56 nodes · fibonacci lattice · depth-scaled</text>
<circle cx="${SPHERE_CX}" cy="${SPHERE_CY}" r="128" fill="none" stroke="${C.rule}" stroke-width="1" opacity="0.45"/>
<g>${glyphSphere()}</g>
<text x="946" y="382" font-family="${MONO}" font-size="10" font-weight="700" fill="${C.label}" letter-spacing="2" text-anchor="end">BAY 02 · GLYPH FIELD</text>
<text x="946" y="396" font-family="${MONO}" font-size="9" fill="${C.dim}" text-anchor="end">characters carried by interpolated 3d motion</text>

${axisGizmo({ cx: 926, cy: 118, len: 18, frames: gizmoFrames, dur: `${SPHERE_L}s`, label: '' })}
${scanBand(ID, { w: W, h: H, dur: '10s' })}
</g>
${chromeOverlay(ID, { w: W, h: H })}`;

  return svgDoc({
    w: W,
    h: H,
    titleId: `${ID}-title`,
    descId: `${ID}-desc`,
    title: 'ASCII bay — 3D rendered as text in pure SVG SMIL',
    desc:
      'Two 3D ASCII renderers animated with no JavaScript and no CSS: on the left a spinning torus rendered as ASCII art — every frame z-buffered and Lambert-shaded on a 38 by 19 character grid, quantised to the ramp from dot to at-sign and flipped at 12 frames per second; in the centre a HUD with the luminance ramp, buffer stats and a block-glyph equaliser; on the right a sphere of 56 characters on a Fibonacci lattice, each glyph scaled and brightened by its own depth as the field rotates. Ray Lin, agentic systems engineer, Taipei.',
    body,
  });
}
