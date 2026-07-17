#!/usr/bin/env node
// Token Usage Dashboard generator — pure SVG SMIL, zero JS in output.
// Reads a usage.json export and emits desktop + mobile SVGs (timestamped
// snapshot + stable alias) under assets/.
//
// This file is the ONE renderer for the GitHub profile dashboard. It is mirrored
// byte-for-byte into LIN0304/LIN0304 by the local publish flow, which drives it
// through scripts/publish_public_dashboard.py on every "Fetch newest". Editing
// only the copy in the profile repo does not change what a Fetch publishes —
// see docs/PUBLISH_PIPELINE.md in codex-usage-dashboard.
//
// Usage: node tools/token-usage-dashboard/generate.mjs
//          [--data <usage.json>] [--assets <dir>] [--stamp 20260716T2330000800]
//
// Defaults resolve against the repo the script sits in, so it runs flagless from
// either checkout: <root>/codex-usage-dashboard/data/usage.json in the profile
// repo, <root>/data/usage.json in the local dashboard project.

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const defaultData = () => {
  const profileRepoPath = join(ROOT, 'codex-usage-dashboard', 'data', 'usage.json');
  return existsSync(profileRepoPath) ? profileRepoPath : join(ROOT, 'data', 'usage.json');
};

const DATA_PATH = argValue('--data') ?? defaultData();
const ASSETS_DIR = argValue('--assets') ?? join(ROOT, 'assets');
const DATA = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

// Stamped into every SVG this generator emits, and the only thing app.js's
// verifyPublishedSvg() matches on after upload. Keep it out of the artwork:
// the point is that panel headings and copy can be redesigned freely without
// breaking post-publish verification. Change it here and in app.js together.
const RENDER_MARKER = '<!-- render: token-usage-dashboard -->';

// ---------------------------------------------------------------- helpers --
const fmt = (n) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B`
  : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K`
  : `${n}`;
const int = (n) => Math.round(n).toLocaleString('en-US');
const usd = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n, d = 1) => `${n.toFixed(d)}%`;
const r2 = (n) => Math.round(n * 100) / 100;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function stampNow() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((a, x) => ((a[x.type] = x.value), a), {});
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}0800`;
}

// ------------------------------------------------------------------ stats --
const T = DATA.totals;
const days = DATA.day_rows;
const daily = days.map((d) => d.tokens.total_tokens);
const totalTokens = T.total_tokens;
const cacheHit = (T.cached_input_tokens / T.input_tokens) * 100;
let cost = 0, savings = 0;
for (const m of DATA.model_rows) { cost += m.costs.total_cost; savings += m.costs.cached_savings; }
const sessions = DATA.session_count;
// window.days is the literal string 'all' for the All history range, which every
// per-day figure below divides by. Fall back to the counted span so that range
// renders real numbers instead of NaN.
const windowDays =
  typeof DATA.window.days === 'number' ? DATA.window.days : DATA.window.calendar_day_count ?? days.length;
const activeDays = DATA.window.active_day_count;

const peakIdx = daily.indexOf(Math.max(...daily));
const peakVal = daily[peakIdx];
const peakDay = days[peakIdx].day.slice(5);
const todayVal = daily[daily.length - 1];
const todayDay = days[days.length - 1].day.slice(5);
const nonZero = daily.filter((v) => v > 0);
const minVal = Math.min(...nonZero);
const avgVal = totalTokens / windowDays;
const medianVal = [...nonZero].sort((a, b) => a - b)[Math.floor(nonZero.length / 2)];
const last7 = daily.slice(-7).reduce((a, b) => a + b, 0);
const prev7 = daily.slice(-14, -7).reduce((a, b) => a + b, 0);
const d7pct = prev7 > 0 ? ((last7 - prev7) / prev7) * 100 : 0;

const reasoning = T.reasoning_output_tokens;
const reasoningShareOut = (reasoning / T.output_tokens) * 100;
const reasoningDaily = days.map((d) => d.tokens.reasoning_output_tokens);
const reasoningPeak = Math.max(...reasoningDaily);
const reasoningPeakDay = days[reasoningDaily.indexOf(reasoningPeak)].day.slice(5);

const models = DATA.model_rows.slice(0, 5).map((m) => ({
  name: m.model, tokens: m.tokens.total_tokens, share: (m.tokens.total_tokens / totalTokens) * 100,
}));
const otherTokens = totalTokens - models.reduce((a, m) => a + m.tokens, 0);
const otherCount = DATA.model_rows.length - models.length;

const agents = Object.entries(DATA.by_agent)
  .map(([name, v]) => ({ name, tokens: v.tokens.total_tokens }))
  .filter((a) => a.tokens > 0)
  .sort((a, b) => b.tokens - a.tokens);
const act = DATA.activity.codex ?? {};
const toolCalls = act.tool_call_count ?? 0;
const subagentSessions = act.subagent_sessions ?? 0;

const mix = [
  { key: 'cached', label: 'Cached input', val: T.cached_input_tokens, color: '#2dd4a3' },
  { key: 'fresh', label: 'Non-cached input', val: T.input_tokens - T.cached_input_tokens, color: '#58a6ff' },
  { key: 'output', label: 'Output', val: T.output_tokens - reasoning, color: '#ff8a22' },
  { key: 'reasoning', label: 'Reasoning', val: reasoning, color: '#b779ff' },
];

const publishedAt = DATA.published_at ?? DATA.generated_at;

// ----------------------------------------------------------- svg builders --
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace";
const text = (x, y, size, fill, s, { anchor = 'start', weight = 800, extra = '' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" font-family="${MONO}"${extra}>${esc(s)}</text>`;

// Depth-faked electron: animateMotion on an ellipse + synced r/opacity keyframes.
function electron(cx, cy, rx, ry, rot, dur, begin, color, rBase = 2.6) {
  const path = `M${-rx},0 a${rx},${ry} 0 1,0 ${2 * rx},0 a${rx},${ry} 0 1,0 ${-2 * rx},0`;
  return `<g transform="translate(${cx},${cy}) rotate(${rot})">
    <circle r="${rBase}" fill="${color}">
      <animateMotion path="${path}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>
      <animate attributeName="r" values="${rBase * 0.7};${rBase * 1.35};${rBase * 0.7};${rBase * 0.5};${rBase * 0.7}" keyTimes="0;0.25;0.5;0.75;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.65;1;0.65;0.3;0.65" keyTimes="0;0.25;0.5;0.75;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>
    </circle>
  </g>`;
}

function orbitRing(cx, cy, rx, ry, rot, color, dur, dash = '5 7') {
  return `<g transform="translate(${cx},${cy}) rotate(${rot})">
    <ellipse rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-width="1" stroke-opacity="0.68" stroke-dasharray="${dash}">
      <animate attributeName="stroke-dashoffset" values="0;-48" dur="${dur}s" repeatCount="indefinite"/>
    </ellipse>
  </g>`;
}

// Drifting/twinkling particle field.
function particles(specs) {
  return specs.map(([x1, y1, x2, y2, r, color, dur, begin, peak]) =>
    `<circle r="${r}" fill="${color}"><animateMotion path="M${x1},${y1} L${x2},${y2}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;${peak};0" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`
  ).join('');
}

// 3D wireframe: project rotating vertices, emit per-edge animated lines.
function wireframe({ cx, cy, scale, tiltX, dur, verts, edges, stroke, width = 1.3, frames = 24, spin = 1, glowIdx = [] }) {
  const proj = [];
  for (let f = 0; f <= frames; f++) {
    const th = (spin * 2 * Math.PI * f) / frames;
    const ct = Math.cos(th), st = Math.sin(th);
    const cx2 = Math.cos(tiltX), sx2 = Math.sin(tiltX);
    proj.push(verts.map(([x, y, z]) => {
      const x1 = x * ct + z * st, z1 = -x * st + z * ct;      // rotate Y
      const y2 = y * cx2 - z1 * sx2, z2 = y * sx2 + z1 * cx2; // tilt X
      const p = 3.4 / (3.4 + z2);                              // perspective
      return [r2(cx + x1 * p * scale), r2(cy + y2 * p * scale), z2];
    }));
  }
  const val = (pick) => proj.map((fr) => pick(fr)).join(';');
  let out = '';
  for (const [a, b] of edges) {
    out += `<line x1="0" y1="0" x2="0" y2="0" stroke="${stroke}" stroke-width="${width}" stroke-opacity="0.85" stroke-linecap="round">`
      + `<animate attributeName="x1" values="${val((f) => f[a][0])}" dur="${dur}s" repeatCount="indefinite"/>`
      + `<animate attributeName="y1" values="${val((f) => f[a][1])}" dur="${dur}s" repeatCount="indefinite"/>`
      + `<animate attributeName="x2" values="${val((f) => f[b][0])}" dur="${dur}s" repeatCount="indefinite"/>`
      + `<animate attributeName="y2" values="${val((f) => f[b][1])}" dur="${dur}s" repeatCount="indefinite"/>`
      + `</line>`;
  }
  for (const i of glowIdx) {
    out += `<circle cx="0" cy="0" r="2" fill="#ffd08a">`
      + `<animate attributeName="cx" values="${val((f) => f[i][0])}" dur="${dur}s" repeatCount="indefinite"/>`
      + `<animate attributeName="cy" values="${val((f) => f[i][1])}" dur="${dur}s" repeatCount="indefinite"/>`
      + `<animate attributeName="opacity" values="${proj.map((fr) => r2(0.25 + 0.75 * (1 - (fr[i][2] + 1.05) / 2.1))).join(';')}" dur="${dur}s" repeatCount="indefinite"/>`
      + `</circle>`;
  }
  return out;
}

const CUBE = {
  verts: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
  edges: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]],
};
const OCTA = {
  verts: [[0, -1.25, 0], [1.25, 0, 0], [0, 0, 1.25], [-1.25, 0, 0], [0, 0, -1.25], [0, 1.25, 0]],
  edges: [[0, 1], [0, 2], [0, 3], [0, 4], [5, 1], [5, 2], [5, 3], [5, 4], [1, 2], [2, 3], [3, 4], [4, 1]],
};

// Panel with corner brackets + pulsing node.
function panel(x, y, w, h, tag, title, right = '') {
  const b = 10;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#0d0907" stroke="#ff7a1a" stroke-opacity="0.55"/>
  <path d="M${x + 1} ${y + b + 8} V${y + 8} Q${x + 1} ${y + 1} ${x + 8} ${y + 1} H${x + b + 8}" fill="none" stroke="#ffb057" stroke-width="2" stroke-opacity="0.9"/>
  <path d="M${x + w - b - 8} ${y + 1} H${x + w - 8} Q${x + w - 1} ${y + 1} ${x + w - 1} ${y + 8} V${y + b + 8}" fill="none" stroke="#ffb057" stroke-width="2" stroke-opacity="0.9"/>
  <path d="M${x + 1} ${y + h - b - 8} V${y + h - 8} Q${x + 1} ${y + h - 1} ${x + 8} ${y + h - 1} H${x + b + 8}" fill="none" stroke="#673110" stroke-width="2"/>
  <path d="M${x + w - b - 8} ${y + h - 1} H${x + w - 8} Q${x + w - 1} ${y + h - 1} ${x + w - 1} ${y + h - 8} V${y + h - b - 8}" fill="none" stroke="#673110" stroke-width="2"/>
  <circle cx="${x + w - 14}" cy="${y + 14}" r="2.4" fill="#ff8a22">
    <animate attributeName="opacity" values="0.3;1;0.3" dur="2.6s" repeatCount="indefinite"/>
  </circle>
  <path d="M${x + 16} ${y + 34} H${x + w - 16}" stroke="#ff7a1a" stroke-width="1" opacity="0.65"/>
  ${text(x + 16, y + 25, 14, '#ff8a22', `${tag} ${title}`, { weight: 900 })}
  ${right ? text(x + w - 16, y + 25, 10.5, '#ffd08a', right, { anchor: 'end' }) : ''}`;
}

// KPI card with staggered sweep + blinking corner.
function kpi(x, y, w, h, label, value, sub, accent, begin, vSize = 21) {
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#15100c" stroke="${accent}" stroke-opacity="0.7"/>
    <rect x="${x + 8}" y="${y + 9}" width="${w - 16}" height="2" fill="${accent}" opacity="0.75"/>
    <rect x="${x + 8}" y="${y + 9}" width="26" height="2" fill="#fff2df" opacity="0.9">
      <animate attributeName="x" values="${x + 8};${x + w - 34};${x + 8}" dur="5.2s" begin="${begin}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.9;0" dur="5.2s" begin="${begin}s" repeatCount="indefinite"/>
    </rect>
    <circle cx="${x + w - 12}" cy="${y + 21}" r="2.2" fill="${accent}">
      <animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="${begin}s" repeatCount="indefinite"/>
    </circle>
    ${text(x + 12, y + 26, 10.5, '#ffb057', `> ${label}`)}
    ${text(x + 12, y + 52, vSize, '#fff2df', value, { weight: 850 })}
    ${text(x + w - 10, y + 66, 9, '#2dd4a3', sub, { anchor: 'end' })}
  </g>`;
}

// Daily chart geometry.
function chartGeom(x0, x1, y0, y1, series, yMax) {
  const n = series.length;
  const X = (i) => r2(x0 + (i * (x1 - x0)) / (n - 1));
  const Y = (v) => r2(y1 - (Math.min(v, yMax) / yMax) * (y1 - y0));
  const pts = series.map((v, i) => [X(i), Y(v)]);
  const line = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a},${b}`).join(' ');
  const area = `M${x0},${y1} ${pts.map(([a, b]) => `L${a},${b}`).join(' ')} L${x1},${y1} Z`;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return { pts, line, area, len: Math.ceil(len), X, Y };
}

// ============================================================== DESKTOP ==
function desktopSVG() {
  const W = 1160, H = 1080;
  const yMax = 6.4e9;
  const g = chartGeom(94, 1090, 300, 452, daily, yMax);
  const peakPt = g.pts[peakIdx];
  const gridY = [0, 1.6e9, 3.2e9, 4.8e9, 6.4e9];

  const xTicks = [0, 12, 26, peakIdx, 52, 66, daily.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);

  const kpis = [
    ['TOTAL TOKENS', fmt(totalTokens), `${windowDays}d window`, '#ff8a22', 0, 22],
    ['EST COST', usd(cost), `${usd(cost / windowDays)} / day`, '#ff4d00', 0.6, 19],
    ['CACHE HIT', pct(cacheHit), `${fmt(T.cached_input_tokens)} cached`, '#2dd4a3', 1.2, 22],
    ['SAVINGS', usd(savings), 'vs no-cache', '#f06d19', 1.8, 17],
    ['SESSIONS', int(sessions), `${Math.round(sessions / windowDays)} / day`, '#ffb057', 2.4, 22],
    ['ACTIVE DAYS', `${activeDays}/${windowDays}`, 'telemetry on', '#b779ff', 3.0, 22],
  ];
  const kw = 165, kg = 14;

  const stat = (x, k, v, color = '#fff2df') =>
    text(x, 486, 10, '#cc6b2c', k) + text(x + k.length * 6.4 + 8, 486, 10, color, v, { weight: 850 });

  // --- model share rows (stacked: name/value line + bar line) inside [03]
  const barX = 422, barW = 328, rowH = 36, rowY0 = 578;
  const modelRows = models.map((m, i) => {
    const y = rowY0 + i * rowH;
    const w = Math.max(3, r2((m.share / 100) * barW));
    return `<g>
      ${text(barX, y, 11.5, '#fff2df', m.name.length > 24 ? m.name.slice(0, 23) + '…' : m.name)}
      <text x="${barX + barW}" y="${y}" font-size="11" text-anchor="end" font-family="${MONO}"><tspan fill="#fff2df" font-weight="900">${esc(fmt(m.tokens))}</tspan><tspan fill="#ffb057" font-weight="800" font-size="9.5"> · ${esc(pct(m.share, 2))}</tspan></text>
      <rect x="${barX}" y="${y + 6}" width="${barW}" height="11" rx="4" fill="#24160d" stroke="#4b2a13"/>
      <rect x="${barX}" y="${y + 6}" width="${w}" height="11" rx="4" fill="url(#modelBar)">
        <animate attributeName="width" values="0;${w}" dur="0.9s" begin="${0.3 + i * 0.18}s" fill="freeze"/>
      </rect>
      <rect x="${barX}" y="${y + 6}" width="9" height="11" rx="3" fill="#fff2df" opacity="0">
        <animate attributeName="x" values="${barX};${barX + Math.max(w - 9, 0)}" dur="3.2s" begin="${1.4 + i * 0.5}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;0.3;0" dur="3.2s" begin="${1.4 + i * 0.5}s" repeatCount="indefinite"/>
      </rect>
    </g>`;
  }).join('') + `<g>
      ${text(barX, rowY0 + 5 * rowH, 11, '#cc6b2c', `+ ${otherCount} more models`)}
      <rect x="${barX}" y="${rowY0 + 5 * rowH + 6}" width="${barW}" height="11" rx="4" fill="#24160d" stroke="#4b2a13"/>
      <rect x="${barX}" y="${rowY0 + 5 * rowH + 6}" width="3" height="11" rx="1.5" fill="#7a4318"/>
      ${text(barX + barW, rowY0 + 5 * rowH, 10.5, '#cc6b2c', fmt(otherTokens), { anchor: 'end' })}
    </g>`;

  // --- token mix stacked bar
  const mxX = 798, mxW = 296, mxY = 574;
  let acc = 0;
  const mixBar = mix.map((m) => {
    const w = r2((m.val / totalTokens) * mxW);
    const seg = `<rect x="${r2(mxX + acc)}" y="${mxY}" width="${Math.max(w, 1.4)}" height="14" fill="${m.color}"/>`;
    acc += w;
    return seg;
  }).join('');
  const mixRows = mix.map((m, i) => {
    const y = 606 + i * 26;
    return `<rect x="${mxX}" y="${y - 8}" width="9" height="9" rx="2" fill="${m.color}"/>
      ${text(mxX + 16, y, 10.5, '#fff2df', m.label)}
      ${text(mxX + mxW - 52, y, 11, '#fff2df', fmt(m.val), { anchor: 'end', weight: 900 })}
      ${text(mxX + mxW, y, 9.5, m.color, pct((m.val / totalTokens) * 100, 2), { anchor: 'end' })}`;
  }).join('');

  // --- reasoning gauge (share of output tokens)
  const gx = mxX + 74, gy = 752, gr = 38;
  const gaugeAngle = -120 + (reasoningShareOut / 100) * 240;
  const arc = (a0, a1, color, wd, op = 1) => {
    const p0 = [gx + gr * Math.sin((a0 * Math.PI) / 180), gy - gr * Math.cos((a0 * Math.PI) / 180)];
    const p1 = [gx + gr * Math.sin((a1 * Math.PI) / 180), gy - gr * Math.cos((a1 * Math.PI) / 180)];
    return `<path d="M${r2(p0[0])},${r2(p0[1])} A${gr},${gr} 0 ${a1 - a0 > 180 ? 1 : 0},1 ${r2(p1[0])},${r2(p1[1])}" fill="none" stroke="${color}" stroke-width="${wd}" stroke-opacity="${op}" stroke-linecap="round"/>`;
  };

  // --- agent fleet lanes
  const fleetY0 = 878, laneH = 26, laneX = 200, laneW = 330;
  const fleetRows = agents.slice(0, 4).map((a, i) => {
    const share = (a.tokens / totalTokens) * 100;
    const y = fleetY0 + i * laneH;
    const w = Math.max(2.5, r2((share / 100) * laneW));
    const dur = 3 + i * 1.4;
    return `<g>
      ${text(70, y + 4, 11.5, '#fff2df', a.name)}
      <path d="M${laneX} ${y} H${laneX + laneW}" stroke="#24160d" stroke-width="10" stroke-linecap="round"/>
      <path d="M${laneX} ${y} H${laneX + w}" stroke="url(#modelBar)" stroke-width="10" stroke-linecap="round"/>
      <circle r="2.6" fill="#ffd08a" filter="url(#softGlow)">
        <animateMotion path="M${laneX},${y} L${laneX + laneW},${y}" dur="${dur}s" begin="${-i * 0.9}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.9;1" dur="${dur}s" begin="${-i * 0.9}s" repeatCount="indefinite"/>
      </circle>
      ${text(laneX + laneW + 62, y + 4, 11.5, '#fff2df', fmt(a.tokens), { anchor: 'end', weight: 900 })}
      ${text(laneX + laneW + 118, y + 4, 9.5, '#ffb057', share >= 1 ? pct(share, 1) : share >= 0.01 ? pct(share, 2) : '<0.01%', { anchor: 'end' })}
    </g>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">
  ${RENDER_MARKER}
  <title id="title">Token Usage Dashboard — telemetry</title>
  <desc id="desc">Animated token usage telemetry: ${fmt(totalTokens)} tokens over ${windowDays} days, ${pct(cacheHit)} cache hit, ${usd(cost)} estimated cost, ${int(sessions)} sessions, peak ${fmt(peakVal)} on ${peakDay}, reasoning tokens visible at ${pct(reasoningShareOut)} of output. Pure SVG SMIL — particle atom orbits and precomputed 3D wireframes, no JavaScript.</desc>
  <defs>
    <linearGradient id="panelBG" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#160b04"/><stop offset="62%" stop-color="#0c0806"/><stop offset="100%" stop-color="#221004"/>
    </linearGradient>
    <linearGradient id="peakArea" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffb057" stop-opacity="0.95"/><stop offset="35%" stop-color="#ff7a1a" stop-opacity="0.5"/><stop offset="100%" stop-color="#ff4d00" stop-opacity="0.02"/>
    </linearGradient>
    <linearGradient id="peakStroke" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#ff7a1a"/><stop offset="70%" stop-color="#ffb057"/><stop offset="100%" stop-color="#ffd08a"/>
    </linearGradient>
    <linearGradient id="modelBar" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#cc3a00"/><stop offset="100%" stop-color="#ff7a1a"/>
    </linearGradient>
    <linearGradient id="scanline" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#ffd08a" stop-opacity="0"/><stop offset="50%" stop-color="#ffd08a" stop-opacity="0.5"/><stop offset="100%" stop-color="#ffd08a" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="coreGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#ff7a1a" stop-opacity="0.5"/><stop offset="60%" stop-color="#ff4d00" stop-opacity="0.14"/><stop offset="100%" stop-color="#ff4d00" stop-opacity="0"/>
    </radialGradient>
    <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="peakGlow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="chartClip"><rect x="94" y="292" width="996" height="166"/></clipPath>
  </defs>

  <rect width="${W}" height="${H}" rx="18" fill="#050403"/>
  <rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="18" fill="url(#panelBG)" stroke="#ff7a1a" stroke-width="2"/>
  ${Array.from({ length: 30 }, (_, i) => `<path d="M32 ${56 + i * 34} L1128 ${56 + i * 34}" stroke="#3b2111" stroke-width="1" opacity="0.28"/>`).join('')}
  <path d="M36 110 H1124" stroke="#ff7a1a" stroke-width="1.4" opacity="0.8"/>
  <path d="M36 ${H - 26} H1124" stroke="#ff7a1a" stroke-width="1.4" opacity="0.5"/>

  <!-- header: title, boot underline, LIVE, mini atom, particle drift -->
  <g>
    ${text(50, 66, 25, '#ff8a22', ':: TOKEN_USAGE_DASHBOARD // TELEMETRY_FEED', { weight: 900 })}
    <rect x="50" y="74" width="0" height="2.5" fill="#ff7a1a">
      <animate attributeName="width" values="0;640" dur="1.4s" begin="0.2s" fill="freeze"/>
    </rect>
    ${text(50, 96, 13, '#ffca88', `> window ${windowDays}d | snapshot ${publishedAt} | feed 127.0.0.1:8787 /?v=reasoning-visible`, { weight: 750 })}
    <g>
      <circle cx="1046" cy="62" r="3.6" fill="#ff7a1a"><animate attributeName="opacity" values="0.25;1;0.25" dur="2s" repeatCount="indefinite"/></circle>
      <circle cx="1046" cy="62" r="7" fill="none" stroke="#ff7a1a" stroke-width="1">
        <animate attributeName="r" values="4;11" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="stroke-opacity" values="0.7;0" dur="2s" repeatCount="indefinite"/>
      </circle>
      ${text(1058, 66, 12, '#ff8a22', 'LIVE', { weight: 900 })}
    </g>
    <g>
      <circle cx="988" cy="60" r="3.2" fill="#ffb057"/>
      ${orbitRing(988, 60, 13, 5.5, -18, '#ff8a22', 3)}
      ${electron(988, 60, 13, 5.5, -18, 2.6, 0, '#ffd08a', 1.7)}
      ${electron(988, 60, 13, 5.5, 62, 3.4, -1.2, '#2dd4a3', 1.7)}
    </g>
    ${particles([
      [60, 92, 700, 84, 1.2, '#ffb057', 9, 0, 0.5],
      [200, 100, 900, 92, 1, '#2dd4a3', 12, -4, 0.4],
      [420, 86, 1090, 96, 1.2, '#ff8a22', 10, -7, 0.45],
      [80, 104, 560, 98, 0.9, '#b779ff', 13, -2, 0.35],
    ])}
  </g>

  <!-- KPI row -->
  ${kpis.map((k, i) => kpi(50 + i * (kw + kg), 130, kw, 76, k[0], k[1], k[2], k[3], k[4], k[5])).join('')}

  <!-- [01] daily token volume -->
  <g>
    ${panel(50, 226, 1060, 274, '[01]', 'DAILY TOKEN VOLUME // PEAK TRACE')}
    <g transform="translate(826,246)">
      <rect width="270" height="18" rx="9" fill="#1b0e07" stroke="#ff7a1a" stroke-opacity="0.6"/>
      <circle cx="14" cy="9" r="3.5" fill="#ff8a22"><animate attributeName="opacity" values="0.3;1;0.3" dur="1.6s" repeatCount="indefinite"/></circle>
      ${text(24, 13, 10, '#ffd08a', `peak ${fmt(peakVal)} · ${peakDay} · today ${fmt(todayVal)}`)}
    </g>
    ${gridY.map((v) => text(88, g.Y(v) + 4, 10, '#7a4318', fmt(v).replace('.0', ''), { anchor: 'end' })).join('')}
    ${gridY.slice(1, -1).map((v) => `<path d="M94 ${g.Y(v)} H1090" stroke="#4b2a13" stroke-width="1" opacity="0.55" stroke-dasharray="2 4"/>`).join('')}
    <path d="M94 452 H1090" stroke="#6c3a16" stroke-width="1.3"/>
    <path d="${g.area}" fill="url(#peakArea)" opacity="0">
      <animate attributeName="opacity" values="0;1" dur="1s" begin="1.6s" fill="freeze"/>
    </path>
    <path d="${g.line}" fill="none" stroke="url(#peakStroke)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"
      stroke-dasharray="${g.len}" stroke-dashoffset="${g.len}">
      <animate attributeName="stroke-dashoffset" values="${g.len};0" dur="2.4s" begin="0.3s" fill="freeze"/>
    </path>
    <g clip-path="url(#chartClip)">
      <rect x="94" y="292" width="46" height="166" fill="url(#scanline)" opacity="0.16">
        <animate attributeName="x" values="70;1090;70" dur="16s" begin="2s" repeatCount="indefinite"/>
      </rect>
    </g>
    <circle r="4" fill="#fff2df" filter="url(#peakGlow)">
      <animateMotion path="${g.line}" dur="18s" begin="2.8s" repeatCount="indefinite" rotate="0"/>
    </circle>
    <circle r="1.8" fill="#ffd08a">
      <animateMotion path="${g.line}" dur="18s" begin="2.55s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.7;0.25;0.7" dur="1.2s" repeatCount="indefinite"/>
    </circle>
    <g>
      <circle cx="${peakPt[0]}" cy="${peakPt[1]}" r="11" fill="#ff4d00" opacity="0.3">
        <animate attributeName="r" values="8;14;8" dur="2.6s" repeatCount="indefinite"/>
      </circle>
      <circle cx="${peakPt[0]}" cy="${peakPt[1]}" r="6" fill="#ff8a22" filter="url(#peakGlow)"/>
      <circle cx="${peakPt[0]}" cy="${peakPt[1]}" r="2.8" fill="#fff2df"/>
      <rect x="${peakPt[0] - 66}" y="${peakPt[1] - 34}" width="132" height="20" rx="5" fill="#1b0e07" stroke="#ff7a1a" stroke-opacity="0.85"/>
      ${text(peakPt[0], peakPt[1] - 20, 11, '#ffd08a', `↑ ${fmt(peakVal)} · ${peakDay}`, { anchor: 'middle', weight: 900 })}
    </g>
    <circle cx="${g.pts[daily.length - 1][0]}" cy="${g.pts[daily.length - 1][1]}" r="4.5" fill="#1b0e07" stroke="#ffd08a" stroke-width="1.6"/>
    ${text(g.pts[daily.length - 1][0] - 4, g.pts[daily.length - 1][1] - 10, 9, '#ffd08a', `today ${fmt(todayVal)}`, { anchor: 'end' })}
    ${xTicks.map((i) => text(g.X(i), 468, 10, '#ffca88', days[i].day.slice(5), { anchor: 'middle' })).join('')}
    ${stat(66, 'avg', fmt(avgVal))}${stat(180, 'median', fmt(medianVal))}${stat(320, 'range', `${fmt(minVal)} ↔ ${fmt(peakVal)}`)}${stat(510, 'last 7d', fmt(last7))}${stat(640, 'Δ vs prev 7d', `${d7pct >= 0 ? '+' : ''}${d7pct.toFixed(0)}%`, d7pct >= 0 ? '#2dd4a3' : '#ff5f56')}${stat(810, 'trend', d7pct >= 0 ? '▲ accelerating' : '▼ cooling', d7pct >= 0 ? '#2dd4a3' : '#ff5f56')}
  </g>

  <!-- [02] token core: particle atom -->
  <g>
    ${panel(50, 520, 340, 280, '[02]', 'TOKEN CORE // ATOM', 'SMIL orbits')}
    <circle cx="220" cy="668" r="86" fill="url(#coreGlow)"/>
    <circle cx="220" cy="668" r="66" fill="none" stroke="#673110" stroke-width="1" stroke-dasharray="3 6">
      <animateTransform attributeName="transform" type="rotate" from="0 220 668" to="360 220 668" dur="40s" repeatCount="indefinite"/>
    </circle>
    <circle cx="220" cy="668" r="20" fill="#1b0e07" stroke="#ff8a22" stroke-width="1.6" filter="url(#softGlow)">
      <animate attributeName="r" values="19;21.5;19" dur="3.2s" repeatCount="indefinite"/>
    </circle>
    <circle cx="220" cy="668" r="30" fill="none" stroke="#ff4d00" stroke-opacity="0.5" stroke-width="1">
      <animate attributeName="r" values="24;40" dur="3.2s" repeatCount="indefinite"/>
      <animate attributeName="stroke-opacity" values="0.5;0" dur="3.2s" repeatCount="indefinite"/>
    </circle>
    ${text(220, 664, 15, '#fff2df', fmt(totalTokens), { anchor: 'middle', weight: 900 })}
    ${text(220, 677, 7.5, '#ffb057', 'TOKENS', { anchor: 'middle' })}
    ${orbitRing(220, 668, 128, 44, -18, '#ff8a22', 2.6)}
    ${orbitRing(220, 668, 118, 40, 46, '#2dd4a3', 3.1)}
    ${orbitRing(220, 668, 108, 36, 112, '#b779ff', 3.6)}
    ${electron(220, 668, 128, 44, -18, 7, 0, '#ffd08a')}
    ${electron(220, 668, 128, 44, -18, 7, -3.5, '#ff8a22')}
    ${electron(220, 668, 118, 40, 46, 8.5, -2, '#2dd4a3')}
    ${electron(220, 668, 118, 40, 46, 8.5, -6.2, '#9adfca')}
    ${electron(220, 668, 108, 36, 112, 6, -1.3, '#b779ff')}
    ${particles([
      [220, 640, 150, 560, 1.3, '#ffb057', 4.2, 0, 0.8],
      [220, 640, 292, 566, 1.3, '#ff8a22', 5, -1.8, 0.7],
      [220, 640, 202, 552, 1.1, '#2dd4a3', 5.8, -3, 0.6],
    ])}
    ${text(66, 786, 9, '#cc6b2c', `input ${fmt(T.input_tokens)} · cached ${fmt(T.cached_input_tokens)} · output ${fmt(T.output_tokens)}`)}
  </g>

  <!-- [03] model share -->
  <g>
    ${panel(406, 520, 360, 280, '[03]', 'MODEL SHARE', `${DATA.model_rows.length} models`)}
  </g>
  ${modelRows}

  <!-- [04] token mix + reasoning visible -->
  <g>
    ${panel(782, 520, 328, 280, '[04]', 'TOKEN MIX', `${fmt(totalTokens)} total`)}
    <rect x="${mxX - 2}" y="${mxY - 2}" width="${mxW + 4}" height="18" rx="5" fill="#24160d" stroke="#4b2a13"/>
    ${mixBar}
    ${mixRows}
    <g>
      ${arc(-120, 120, '#24160d', 7)}
      ${arc(-120, gaugeAngle, '#b779ff', 7, 0.95)}
      <g transform="rotate(-120 ${gx} ${gy})">
        <path d="M${gx} ${gy} L${gx} ${gy - gr + 9}" stroke="#fff2df" stroke-width="2" stroke-linecap="round"/>
        <animateTransform attributeName="transform" type="rotate" values="-120 ${gx} ${gy};${r2(gaugeAngle + 6)} ${gx} ${gy};${r2(gaugeAngle)} ${gx} ${gy}" keyTimes="0;0.8;1" dur="1.8s" begin="0.8s" fill="freeze"/>
      </g>
      <circle cx="${gx}" cy="${gy}" r="3.4" fill="#b779ff"/>
      ${text(gx, gy + 24, 13, '#fff2df', pct(reasoningShareOut), { anchor: 'middle', weight: 900 })}
      ${text(gx, gy + 36, 7.5, '#b779ff', 'REASONING / OUTPUT', { anchor: 'middle' })}
    </g>
    <g transform="translate(${gx + 78},${gy - 34})">
      <rect width="132" height="30" rx="6" fill="#170d1f" stroke="#b779ff" stroke-opacity="0.65">
        <animate attributeName="stroke-opacity" values="0.35;0.9;0.35" dur="2.8s" repeatCount="indefinite"/>
      </rect>
      <circle cx="12" cy="15" r="2.6" fill="#b779ff"><animate attributeName="opacity" values="0.3;1;0.3" dur="1.4s" repeatCount="indefinite"/></circle>
      ${text(21, 12, 8.5, '#d9b8ff', 'REASONING VISIBLE', { weight: 900 })}
      ${text(21, 24, 8, '#9a7bc0', `${fmt(reasoning)} · peak ${fmt(reasoningPeak)} ${reasoningPeakDay}`)}
    </g>
  </g>

  <!-- [05] agent fleet -->
  <g>
    ${panel(50, 820, 640, 180, '[05]', 'AGENT FLEET // TOKEN LANES', `${agents.length} agents active`)}
    ${fleetRows}
    ${text(66, 986, 9.5, '#cc6b2c', `tool calls ${int(toolCalls)} · subagent sessions ${int(subagentSessions)} · codex sessions ${int(act.codex_sessions ?? 0)} · plugin signals ${int(act.plugin_signal_count ?? 0)}`)}
  </g>

  <!-- [06] geometry bay: 3D wireframes -->
  <g>
    ${panel(706, 820, 404, 180, '[06]', 'GEOMETRY BAY // 3D', '25-keyframe SMIL')}
    <ellipse cx="800" cy="962" rx="52" ry="9" fill="none" stroke="#673110" stroke-width="1" stroke-dasharray="3 4"/>
    <ellipse cx="1010" cy="962" rx="46" ry="8" fill="none" stroke="#673110" stroke-width="1" stroke-dasharray="3 4"/>
    ${wireframe({ cx: 800, cy: 912, scale: 34, tiltX: 0.36, dur: 12, ...CUBE, stroke: '#ff8a22', glowIdx: [2, 5] })}
    ${wireframe({ cx: 1010, cy: 914, scale: 30, tiltX: 0.28, dur: 9, spin: -1, ...OCTA, stroke: '#2dd4a3', width: 1.2, glowIdx: [0, 5] })}
    ${orbitRing(905, 918, 96, 20, -8, '#b779ff', 4, '2 9')}
    ${electron(905, 918, 96, 20, -8, 6.5, 0, '#b779ff', 1.8)}
    ${text(800, 986, 8.5, '#cc6b2c', 'token cube', { anchor: 'middle' })}
    ${text(1010, 986, 8.5, '#cc6b2c', 'octa relay', { anchor: 'middle' })}
  </g>

  <!-- footer: marching pulse + ticker -->
  <g>
    <path d="M50 ${H - 44} H700" stroke="#ff8a22" stroke-width="2" stroke-dasharray="26 10 8 10 44 10 18 10" filter="url(#softGlow)">
      <animate attributeName="stroke-dashoffset" values="0;-136" dur="3.2s" repeatCount="indefinite"/>
    </path>
    <rect x="716" y="${H - 58}" width="394" height="24" rx="6" fill="#0a0604" stroke="#673110" stroke-opacity="0.82"/>
    ${text(730, H - 42, 9.5, '#cc6b2c', `01010100 // token.telemetry | window=${windowDays}d | avg=${fmt(avgVal)} | cache=${pct(cacheHit)}`, { weight: 650 })}
    <circle cx="704" cy="${H - 44}" r="3" fill="#ffd08a">
      <animate attributeName="opacity" values="1;0.2;1" dur="1.1s" repeatCount="indefinite"/>
    </circle>
  </g>
</svg>
`;
  return svg;
}

// =============================================================== MOBILE ==
function mobileSVG() {
  const W = 420, H = 1210;
  const yMax = 6.4e9;
  const g = chartGeom(36, 396, 378, 444, daily, yMax);
  const peakPt = g.pts[peakIdx];

  const kpiM = (x, y, w, label, value, sub, accent, begin) => `<g>
    <rect x="${x}" y="${y}" width="${w}" height="66" rx="8" fill="#15100c" stroke="${accent}" stroke-opacity="0.7"/>
    <rect x="${x + 7}" y="${y + 8}" width="${w - 14}" height="2" fill="${accent}" opacity="0.75"/>
    <circle cx="${x + w - 11}" cy="${y + 19}" r="2" fill="${accent}"><animate attributeName="opacity" values="0.2;1;0.2" dur="2.4s" begin="${begin}s" repeatCount="indefinite"/></circle>
    ${text(x + 10, y + 22, 9, '#ffb057', `> ${label}`)}
    ${text(x + 10, y + 44, 15.5, '#fff2df', value, { weight: 850 })}
    ${text(x + w - 8, y + 58, 7.5, '#2dd4a3', sub, { anchor: 'end' })}
  </g>`;

  const kpiRows = [
    ['TOTAL', fmt(totalTokens), `${windowDays}d window`, '#ff8a22'],
    ['EST COST', usd(cost), `${usd(cost / windowDays)}/day`, '#ff4d00'],
    ['CACHE HIT', pct(cacheHit), `${fmt(T.cached_input_tokens)} cached`, '#2dd4a3'],
    ['SAVINGS', usd(savings), 'vs no-cache', '#f06d19'],
    ['SESSIONS', int(sessions), `${Math.round(sessions / windowDays)}/day`, '#ffb057'],
    ['ACTIVE', `${activeDays}/${windowDays}`, 'days on', '#b779ff'],
  ];

  const rowY0 = 878, rowH = 30, barX = 24, barW = 372;
  const modelRows = models.slice(0, 4).map((m, i) => {
    const y = rowY0 + i * rowH;
    const w = Math.max(3, r2((m.share / 100) * barW));
    return `<g>
      ${text(barX, y, 10, '#fff2df', m.name.length > 26 ? m.name.slice(0, 25) + '…' : m.name)}
      <rect x="${barX}" y="${y + 5}" width="${barW}" height="10" rx="4" fill="#24160d" stroke="#4b2a13"/>
      <rect x="${barX}" y="${y + 5}" width="${w}" height="10" rx="4" fill="url(#modelBar)">
        <animate attributeName="width" values="0;${w}" dur="0.9s" begin="${0.3 + i * 0.15}s" fill="freeze"/>
      </rect>
      ${text(396, y, 9.5, '#ffb057', `${fmt(m.tokens)} · ${pct(m.share, 1)}`, { anchor: 'end' })}
    </g>`;
  }).join('');

  const mxY = 1042; let acc = 0;
  const mixBar = mix.map((m) => {
    const w = r2((m.val / totalTokens) * barW);
    const seg = `<rect x="${r2(barX + acc)}" y="${mxY}" width="${Math.max(w, 1.2)}" height="12" fill="${m.color}"/>`;
    acc += w; return seg;
  }).join('');
  const mixLegend = mix.map((m, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = barX + col * 190, y = mxY + 28 + row * 20;
    return `<rect x="${x}" y="${y - 8}" width="8" height="8" rx="2" fill="${m.color}"/>` +
      text(x + 13, y, 9, '#fff2df', `${m.label} ${fmt(m.val)}`);
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">
  ${RENDER_MARKER}
  <title id="title">Token Usage Dashboard Mobile — telemetry</title>
  <desc id="desc">Mobile token usage telemetry: ${fmt(totalTokens)} tokens, ${pct(cacheHit)} cache hit, ${usd(cost)} estimated cost, peak ${fmt(peakVal)} on ${peakDay}. Pure SVG SMIL animation.</desc>
  <defs>
    <linearGradient id="panelBG" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#160b04"/><stop offset="64%" stop-color="#0c0806"/><stop offset="100%" stop-color="#221004"/>
    </linearGradient>
    <linearGradient id="peakArea" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#ffb057" stop-opacity="0.95"/><stop offset="35%" stop-color="#ff7a1a" stop-opacity="0.5"/><stop offset="100%" stop-color="#ff4d00" stop-opacity="0.02"/>
    </linearGradient>
    <linearGradient id="peakStroke" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#ff7a1a"/><stop offset="70%" stop-color="#ffb057"/><stop offset="100%" stop-color="#ffd08a"/>
    </linearGradient>
    <linearGradient id="modelBar" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#cc3a00"/><stop offset="100%" stop-color="#ff7a1a"/>
    </linearGradient>
    <radialGradient id="coreGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#ff7a1a" stop-opacity="0.5"/><stop offset="60%" stop-color="#ff4d00" stop-opacity="0.14"/><stop offset="100%" stop-color="#ff4d00" stop-opacity="0"/>
    </radialGradient>
    <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" rx="14" fill="#050403"/>
  <rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="14" fill="url(#panelBG)" stroke="#ff7a1a" stroke-width="2"/>
  ${Array.from({ length: 38 }, (_, i) => `<path d="M18 ${44 + i * 31} H402" stroke="#3b2111" stroke-width="1" opacity="0.26"/>`).join('')}

  ${text(24, 44, 17, '#ff8a22', ':: TOKEN_USAGE_DASHBOARD', { weight: 900 })}
  ${text(24, 62, 10.5, '#ffca88', '// TELEMETRY_FEED · reasoning visible', { weight: 750 })}
  <rect x="24" y="70" width="0" height="2" fill="#ff7a1a"><animate attributeName="width" values="0;372" dur="1.2s" begin="0.2s" fill="freeze"/></rect>
  ${text(24, 88, 9, '#cc6b2c', `${publishedAt} · window ${windowDays}d`)}
  <circle cx="376" cy="40" r="3" fill="#ff7a1a"><animate attributeName="opacity" values="0.25;1;0.25" dur="2s" repeatCount="indefinite"/></circle>
  ${text(386, 44, 9, '#ff8a22', 'LIVE', { weight: 900 })}

  ${kpiRows.map((k, i) => kpiM(24 + (i % 2) * 190, 102 + Math.floor(i / 2) * 76, 182, k[0], k[1], k[2], k[3], i * 0.5)).join('')}

  <g>
    <rect x="16" y="342" width="388" height="140" rx="10" fill="#0d0907" stroke="#ff7a1a" stroke-opacity="0.55"/>
    ${text(28, 362, 12, '#ff8a22', '[01] DAILY VOLUME', { weight: 900 })}
    ${text(392, 362, 8.5, '#ffd08a', `peak ${fmt(peakVal)} ${peakDay}`, { anchor: 'end' })}
    <path d="M36 444 H396" stroke="#6c3a16" stroke-width="1"/>
    <path d="${g.area}" fill="url(#peakArea)" opacity="0"><animate attributeName="opacity" values="0;1" dur="1s" begin="1.3s" fill="freeze"/></path>
    <path d="${g.line}" fill="none" stroke="url(#peakStroke)" stroke-width="1.8" stroke-linejoin="round" stroke-dasharray="${g.len}" stroke-dashoffset="${g.len}">
      <animate attributeName="stroke-dashoffset" values="${g.len};0" dur="2.2s" begin="0.3s" fill="freeze"/>
    </path>
    <circle r="3" fill="#fff2df" filter="url(#softGlow)"><animateMotion path="${g.line}" dur="15s" begin="2.4s" repeatCount="indefinite"/></circle>
    <circle cx="${peakPt[0]}" cy="${peakPt[1]}" r="5" fill="#ff8a22" filter="url(#softGlow)"><animate attributeName="r" values="4;6;4" dur="2.4s" repeatCount="indefinite"/></circle>
    <circle cx="${peakPt[0]}" cy="${peakPt[1]}" r="2" fill="#fff2df"/>
    ${text(28, 470, 8.5, '#cc6b2c', `avg ${fmt(avgVal)} · median ${fmt(medianVal)} · today ${fmt(todayVal)}`)}
    ${text(392, 470, 8.5, d7pct >= 0 ? '#2dd4a3' : '#ff5f56', `7d ${d7pct >= 0 ? '+' : ''}${d7pct.toFixed(0)}%`, { anchor: 'end' })}
  </g>

  <g>
    <rect x="16" y="494" width="388" height="330" rx="10" fill="#0d0907" stroke="#ff7a1a" stroke-opacity="0.55"/>
    ${text(28, 514, 12, '#ff8a22', '[02] TOKEN CORE // ATOM', { weight: 900 })}
    ${text(392, 514, 8.5, '#ffd08a', 'SMIL orbits', { anchor: 'end' })}
    <circle cx="210" cy="664" r="92" fill="url(#coreGlow)"/>
    <circle cx="210" cy="664" r="70" fill="none" stroke="#673110" stroke-width="1" stroke-dasharray="3 6">
      <animateTransform attributeName="transform" type="rotate" from="0 210 664" to="360 210 664" dur="40s" repeatCount="indefinite"/>
    </circle>
    <circle cx="210" cy="664" r="24" fill="#1b0e07" stroke="#ff8a22" stroke-width="1.6" filter="url(#softGlow)">
      <animate attributeName="r" values="23;25.5;23" dur="3.2s" repeatCount="indefinite"/>
    </circle>
    <circle cx="210" cy="664" r="34" fill="none" stroke="#ff4d00" stroke-opacity="0.5" stroke-width="1">
      <animate attributeName="r" values="28;46" dur="3.2s" repeatCount="indefinite"/>
      <animate attributeName="stroke-opacity" values="0.5;0" dur="3.2s" repeatCount="indefinite"/>
    </circle>
    ${text(210, 661, 16, '#fff2df', fmt(totalTokens), { anchor: 'middle', weight: 900 })}
    ${text(210, 674, 8, '#ffb057', 'TOKENS', { anchor: 'middle' })}
    ${orbitRing(210, 664, 150, 52, -18, '#ff8a22', 2.6)}
    ${orbitRing(210, 664, 138, 47, 46, '#2dd4a3', 3.1)}
    ${orbitRing(210, 664, 126, 42, 112, '#b779ff', 3.6)}
    ${electron(210, 664, 150, 52, -18, 7, 0, '#ffd08a')}
    ${electron(210, 664, 150, 52, -18, 7, -3.5, '#ff8a22')}
    ${electron(210, 664, 138, 47, 46, 8.5, -2, '#2dd4a3')}
    ${electron(210, 664, 138, 47, 46, 8.5, -6.2, '#9adfca')}
    ${electron(210, 664, 126, 42, 112, 6, -1.3, '#b779ff')}
    ${particles([
      [210, 636, 130, 540, 1.2, '#ffb057', 4.2, 0, 0.8],
      [210, 636, 300, 548, 1.2, '#ff8a22', 5, -1.8, 0.7],
      [210, 636, 210, 528, 1, '#2dd4a3', 5.8, -3, 0.6],
    ])}
    ${text(210, 806, 8.5, '#cc6b2c', `input ${fmt(T.input_tokens)} · cached ${fmt(T.cached_input_tokens)} · output ${fmt(T.output_tokens)}`, { anchor: 'middle' })}
  </g>

  <g>
    <rect x="16" y="836" width="388" height="176" rx="10" fill="#0d0907" stroke="#ff7a1a" stroke-opacity="0.55"/>
    ${text(28, 856, 12, '#ff8a22', '[03] MODEL SHARE', { weight: 900 })}
    ${text(392, 856, 8.5, '#ffd08a', `${DATA.model_rows.length} models`, { anchor: 'end' })}
    ${modelRows}
    ${text(barX, rowY0 + 4 * rowH + 2, 9, '#cc6b2c', `+ ${otherCount} more · ${fmt(otherTokens)}`)}
  </g>

  <g>
    <rect x="16" y="1024" width="388" height="96" rx="10" fill="#0d0907" stroke="#ff7a1a" stroke-opacity="0.55"/>
    ${text(28, 1038, 11, '#ff8a22', '[04] TOKEN MIX', { weight: 900 })}
    <g transform="translate(250,1030)">
      <rect width="146" height="16" rx="5" fill="#170d1f" stroke="#b779ff" stroke-opacity="0.6">
        <animate attributeName="stroke-opacity" values="0.3;0.9;0.3" dur="2.8s" repeatCount="indefinite"/>
      </rect>
      <circle cx="9" cy="8" r="2" fill="#b779ff"><animate attributeName="opacity" values="0.3;1;0.3" dur="1.4s" repeatCount="indefinite"/></circle>
      ${text(16, 11, 7.5, '#d9b8ff', `REASONING ${pct(reasoningShareOut)} of output`, { weight: 900 })}
    </g>
    ${mixBar}
    ${mixLegend}
  </g>

  <g>
    <rect x="16" y="1132" width="388" height="46" rx="10" fill="#0d0907" stroke="#ff7a1a" stroke-opacity="0.55"/>
    ${text(28, 1150, 10, '#ff8a22', '[05] FLEET', { weight: 900 })}
    ${text(28, 1166, 8.5, '#cc6b2c', `${agents.map((a) => `${a.name} ${fmt(a.tokens)}`).slice(0, 4).join(' · ')}`)}
    <circle r="2.2" fill="#ffd08a" filter="url(#softGlow)">
      <animateMotion path="M96,1147 L392,1147" dur="4s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur="4s" repeatCount="indefinite"/>
    </circle>
  </g>

  <path d="M24 ${H - 18} H280" stroke="#ff8a22" stroke-width="1.6" stroke-dasharray="20 8 6 8 34 8" filter="url(#softGlow)">
    <animate attributeName="stroke-dashoffset" values="0;-84" dur="3s" repeatCount="indefinite"/>
  </path>
  ${text(396, H - 14, 8, '#cc6b2c', 'token.telemetry // EOF', { anchor: 'end' })}
</svg>
`;
}

// ------------------------------------------------------------------ main --
const stamp = argValue('--stamp') ?? stampNow();

mkdirSync(ASSETS_DIR, { recursive: true });
const outDesk = join(ASSETS_DIR, `token-usage-dashboard-${stamp}.svg`);
const outMob = join(ASSETS_DIR, `token-usage-dashboard-mobile-${stamp}.svg`);
writeFileSync(outDesk, desktopSVG());
writeFileSync(outMob, mobileSVG());
copyFileSync(outDesk, join(ASSETS_DIR, 'token-usage-dashboard.svg'));
copyFileSync(outMob, join(ASSETS_DIR, 'token-usage-dashboard-mobile.svg'));
console.log(`stamp=${stamp}`);
console.log(`wrote ${outDesk}`);
console.log(`wrote ${outMob}`);
console.log('wrote stable aliases token-usage-dashboard{,-mobile}.svg');
