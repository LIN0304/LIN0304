// The hero banner's micro-atom, rebuilt with the same depth sort as the
// reactor core: two orbits that tumble in 3D and pass behind the nucleus, and
// electrons that swell as they come toward the camera.
//
// This one is emitted as a *fragment*, not a whole document — generate.mjs
// splices it into assets/hero-banner.svg between the 3d:hero-atom markers, so
// the rest of that hand-authored banner is left untouched. It reuses the
// banner's existing hb-glow filter and hb-orb2 gradient.

import {
  C, TAU, num, num2, mul3, apply3, rotX, rotY, rotZ, cross, dot, norm,
  anim, animDiscrete, animTransform, clamp,
} from './lib.mjs';

const CX = 790, CY = 92;
const L = 12;
const DUR = `${L}s`;
const KS = 24, KF = 48;
const SHELLS = [
  { R: 34, tilt: 0, T: L / 4, e: 2, dash: '3 4' },
  { R: 23, tilt: 68, T: L / 3, e: 1, dash: '2 3' },
];

const tumble = (t) => mul3(rotY((TAU * t) / L), rotX(0.25 + 0.36 * Math.sin(TAU * (t / L))));
const at = (k) => Array.from({ length: k }, (_, i) => (i * L) / k);

function basis(tiltDeg) {
  const a = (tiltDeg * Math.PI) / 180;
  const n = [Math.cos(a), Math.sin(a), 0];
  const u = norm(cross(n, [0, 0, 1]));
  return { n, u, v: cross(n, u) };
}

function gate(flags) {
  const values = [], keyTimes = [];
  flags.forEach((f, i) => {
    const val = f ? '1' : '0';
    if (i === 0 || values[values.length - 1] !== val) {
      values.push(val);
      keyTimes.push(num2(i / flags.length));
    }
  });
  if (values.length === 1) return values[0] === '1' ? '' : `<set attributeName="opacity" to="0"/>`;
  return animDiscrete('opacity', values, keyTimes, DUR);
}

function orbit(shell, layer) {
  const { n: nObj } = basis(shell.tilt);
  const psi = [], sk = [], far = [], depth = [];
  let prevU = [1, 0, 0], prevPsi = null;
  for (const t of at(KS)) {
    const nw = norm(apply3(tumble(t), nObj));
    let u = cross([0, 0, 1], nw);
    if (Math.hypot(u[0], u[1], u[2]) < 1e-6) u = prevU.slice();
    u = norm(u);
    if (dot(u, prevU) < 0) u = u.map((c) => -c);
    prevU = u;
    const v = cross(nw, u);
    let a = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
    if (prevPsi !== null) a = prevPsi + ((((a - prevPsi) % 360) + 540) % 360) - 180;
    prevPsi = a;
    const rad = (a * Math.PI) / 180;
    psi.push(num(a));
    sk.push(num2(Math.cos(rad) * v[1] - Math.sin(rad) * v[0]));
    far.push(v[2] > 0);
    depth.push(v[2]);
  }
  const R = shell.R;
  const arc = (d, ops, g) =>
    `<path d="${d}" fill="none" stroke="${layer === 'back' ? C.line : C.glow}" stroke-width="1" stroke-dasharray="${shell.dash}" vector-effect="non-scaling-stroke">${anim('stroke-opacity', ops, DUR)}${g}</path>`;
  const opA = depth.map((d) => num2(0.45 - 0.3 * d));
  const opB = depth.map((d) => num2(0.45 + 0.3 * d));
  return `<g transform="translate(${CX},${CY})"><g>${animTransform('rotate', psi, DUR, 'additive="sum"')}${animTransform('scale', sk.map((s) => `1 ${s}`), DUR, 'additive="sum"')}<g>` +
    arc(`M ${R} 0 A ${R} ${R} 0 0 1 ${-R} 0`, opA, gate(far.map((f) => (layer === 'back' ? f : !f)))) +
    arc(`M ${-R} 0 A ${R} ${R} 0 0 1 ${R} 0`, opB, gate(far.map((f) => (layer === 'back' ? !f : f)))) +
    `</g></g></g>`;
}

function electron(shell, phase, id) {
  const { u, v } = basis(shell.tilt);
  const pos = (t) => apply3(tumble(t), [0, 1, 2].map((i) =>
    shell.R * (Math.cos((TAU * t) / shell.T + phase) * u[i] + Math.sin((TAU * t) / shell.T + phase) * v[i])));
  const xs = [], ys = [], rs = [], os = [], front = [];
  for (const t of at(KF)) {
    const p = pos(t);
    xs.push(num(CX + p[0]));
    ys.push(num(CY + p[1]));
    front.push(p[2] <= 0);
  }
  for (const t of at(KS)) {
    const d = -pos(t)[2] / shell.R;
    rs.push(num2(1.4 + 0.8 * d));
    os.push(num2(clamp(0.6 + 0.4 * d, 0.25, 1)));
  }
  return {
    def: `<circle id="${id}" cx="${xs[0]}" cy="${ys[0]}" r="${rs[0]}" fill="#ffe6bd" filter="url(#hb-glow)">${anim('cx', xs, DUR)}${anim('cy', ys, DUR)}${anim('r', rs, DUR)}${anim('opacity', os, DUR)}</circle>`,
    id,
    front,
  };
}

function nucleons(count) {
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / count;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = Math.PI * (1 + Math.sqrt(5)) * i;
    const p0 = [Math.cos(th) * rr, y, Math.sin(th) * rr];
    const xs = [], ys = [], rs = [], front = [];
    for (const t of at(KS)) {
      const spin = mul3(tumble(t), rotZ((TAU * t) / (L / 3)));
      const rad = 5 + 1.1 * Math.sin((TAU * t) / (L / 4) + i);
      const p = apply3(spin, p0.map((c) => c * rad));
      xs.push(num(CX + p[0]));
      ys.push(num(CY + p[1]));
      rs.push(num2(1.8 + 0.5 * (-p[2] / 6)));
      front.push(p[2] <= 0);
    }
    return {
      id: `hb3-n${i}`,
      def: `<circle id="hb3-n${i}" cx="${xs[0]}" cy="${ys[0]}" r="${rs[0]}" fill="${i % 2 ? '#e9b183' : '#ff8f2e'}">${anim('cx', xs, DUR)}${anim('cy', ys, DUR)}${anim('r', rs, DUR)}</circle>`,
      front,
    };
  });
}

/** The spliced fragment, indented to sit inside the banner's content group. */
export function buildHeroAtom() {
  const electrons = SHELLS.flatMap((s, si) =>
    Array.from({ length: s.e }, (_, k) => electron(s, (TAU * k) / s.e, `hb3-e${si}${k}`)));
  const nucs = nucleons(5);
  const layer = (items, back) =>
    items.map((it) => `<use href="#${it.id}">${gate(back ? it.front.map((f) => !f) : it.front)}</use>`).join('');

  return `    <!-- micro reactor: 3d depth-sorted orbits, generated by tools/svg-3d -->
    <g>
      <defs>${electrons.map((e) => e.def).join('')}${nucs.map((n) => n.def).join('')}</defs>
      <circle cx="${CX}" cy="${CY}" r="24" fill="url(#hb-orb2)"><animate attributeName="r" values="21;27;21" dur="5.5s" repeatCount="indefinite"/></circle>
      ${SHELLS.map((s) => orbit(s, 'back')).join('\n      ')}
      <g>${layer(electrons, true)}</g>
      <g>${layer(nucs, true)}</g>
      <circle cx="${CX}" cy="${CY}" r="5.4" fill="#ff8a22" filter="url(#hb-glow)"><animate attributeName="opacity" values="0.6;1;0.6" dur="3.4s" repeatCount="indefinite"/></circle>
      <g>${layer(nucs, false)}</g>
      ${SHELLS.map((s) => orbit(s, 'front')).join('\n      ')}
      <g>${layer(electrons, false)}</g>
      <circle cx="${CX}" cy="${CY}" r="6" fill="none" stroke="${C.line}" stroke-width="1"><animate attributeName="r" values="6;22" dur="4s" begin="-1.5s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.5;0" dur="4s" begin="-1.5s" repeatCount="indefinite"/></circle>
    </g>`;
}
