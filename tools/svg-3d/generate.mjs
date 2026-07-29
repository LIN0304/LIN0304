#!/usr/bin/env node
// 3D asset generator for the profile README.
//
// Emits the three hand-built 3D panels — reactor core, geometry bay and the
// ASCII bay — as pure SMIL SVG (no JavaScript, no CSS in the output). Every
// frame is precomputed here so the artwork stays a plain <img> on GitHub.
//
// Usage: node tools/svg-3d/generate.mjs [--assets <dir>] [--only atom|geometry|ascii]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAtomCore } from './atom-core.mjs';
import { buildGeometryBay } from './wireframe-geometry.mjs';
import { buildAsciiBay } from './ascii-3d.mjs';
import { buildHeroAtom } from './hero-atom.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const ASSETS = argValue('--assets') ?? join(ROOT, 'assets');
const only = argValue('--only');

const TARGETS = [
  { key: 'atom', file: 'atom-core.svg', build: buildAtomCore },
  { key: 'geometry', file: 'wireframe-geometry.svg', build: buildGeometryBay },
  { key: 'ascii', file: 'ascii-3d.svg', build: buildAsciiBay },
];

mkdirSync(ASSETS, { recursive: true });
for (const t of TARGETS) {
  if (only && only !== t.key) continue;
  const svg = t.build();
  const out = join(ASSETS, t.file);
  writeFileSync(out, svg);
  console.log(`${t.file.padEnd(24)} ${(svg.length / 1024).toFixed(1)} KB`);
}

// The hero banner stays hand-authored; only the micro-atom between the markers
// is generated, so re-running this never disturbs the rest of that file.
if (!only || only === 'hero') {
  const heroPath = join(ASSETS, 'hero-banner.svg');
  const markers = /( *)<!-- 3d:hero-atom:start -->[\s\S]*?<!-- 3d:hero-atom:end -->/;
  if (!existsSync(heroPath)) {
    console.warn('hero-banner.svg not found — skipped');
  } else {
    const hero = readFileSync(heroPath, 'utf8');
    if (!markers.test(hero)) {
      console.warn('hero-banner.svg has no 3d:hero-atom markers — skipped');
    } else {
      const patched = hero.replace(
        markers,
        `$1<!-- 3d:hero-atom:start -->\n${buildHeroAtom()}\n$1<!-- 3d:hero-atom:end -->`,
      );
      writeFileSync(heroPath, patched);
      console.log(`${'hero-banner.svg'.padEnd(24)} ${(patched.length / 1024).toFixed(1)} KB (spliced)`);
    }
  }
}
