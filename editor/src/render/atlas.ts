/* Procedural compartment texture atlas (port of viewer makeAtlas, 370-470).
   Abstract surface treatments, not pictograms: each compartment gets a plating
   character (seam rhythm, striation direction, grain) that reads as material at
   ship scale. Grayscale multiplies the compartment tint, so contrast stays low.
   Lazily built — requires a DOM canvas, so callers must tolerate null in
   headless environments. */

import * as THREE from 'three';

const ATLAS_N = 1024, CELL = 256, COLS = 4, PAD = 16;

type Ctx = CanvasRenderingContext2D;

function makeAtlas(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS_N;
  const g = cv.getContext('2d');
  if (!g) throw new Error('atlas: no 2d context');
  g.fillStyle = '#DEDEDE'; g.fillRect(0, 0, ATLAS_N, ATLAS_N);
  /* deterministic PRNG so the atlas is identical every load */
  let seed = 0x2F6E2B1;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF) / 0x7FFFFFFF);
  const cell = (i: number, draw: (g: Ctx) => void): void => {
    const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL;
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip();
    draw(g); g.restore();
  };
  const shade = (v: number): string => `rgb(${v},${v},${v})`;
  /* fine speckle grain — the base "material" everything sits on */
  const grain = (g: Ctx, n: number, amp: number): void => {
    for (let i = 0; i < n; i++) {
      const v = 222 + (rnd() - 0.5) * amp * 2;
      g.fillStyle = shade(Math.round(v));
      g.fillRect(rnd() * CELL, rnd() * CELL, 1 + rnd() * 3, 1 + rnd() * 3);
    }
  };
  /* parallel striations at an angle: rhythm carries the compartment's character */
  const striate = (
    g: Ctx, ang: number, gap: number, w: number, lo: number, hi: number, jitter = 0,
  ): void => {
    g.save(); g.translate(CELL / 2, CELL / 2); g.rotate(ang); g.translate(-CELL, -CELL);
    for (let x = 0; x < CELL * 2; x += gap) {
      g.fillStyle = shade(Math.round(lo + rnd() * (hi - lo)));
      g.fillRect(x + (jitter ? (rnd() - 0.5) * jitter : 0), 0, w, CELL * 2);
    }
    g.restore();
  };
  /* irregular plate seams: splits the face into a few unequal panels */
  const seams = (g: Ctx, cuts: readonly number[][], v: number): void => {
    g.strokeStyle = shade(v); g.lineWidth = 2;
    for (const [a, b, c, d] of cuts) { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); }
  };
  const plates = (g: Ctx, n: number, lo: number, hi: number): void => {  // worn plating
    for (let i = 0; i < n; i++) {
      g.fillStyle = shade(Math.round(lo + rnd() * (hi - lo)));
      const w = 40 + rnd() * 90, h = 40 + rnd() * 90;
      g.fillRect(rnd() * (CELL - w), rnd() * (CELL - h), w, h);
    }
  };
  const specks = (g: Ctx, n: number, v: number, r: number): void => {   // micro-detail
    g.fillStyle = shade(v);
    for (let i = 0; i < n; i++) { g.beginPath(); g.arc(rnd() * CELL, rnd() * CELL, r, 0, 7); g.fill(); }
  };

  /* 0 энергия — dense fine ribbing, warm even surface */
  cell(0, g => { plates(g, 3, 214, 228); striate(g, 0, 7, 3, 196, 212); grain(g, 900, 10);
    seams(g, [[0, 84, 256, 84], [0, 178, 256, 178]], 204); });
  /* 1 ЦП — orthogonal fine grid, tight and regular */
  cell(1, g => { plates(g, 2, 216, 230); striate(g, 0, 16, 2, 200, 214);
    striate(g, Math.PI / 2, 16, 2, 204, 216); grain(g, 700, 8); specks(g, 26, 196, 1.6); });
  /* 2 обитаемый — broad calm panels, minimal texture */
  cell(2, g => { plates(g, 5, 214, 232); grain(g, 500, 7);
    seams(g, [[0, 96, 256, 88], [128, 0, 132, 256], [132, 168, 256, 172]], 206); });
  /* 3 гироскоп — diagonal cross-hatch, machined feel */
  cell(3, g => { plates(g, 2, 216, 228); striate(g, Math.PI / 4, 14, 3, 198, 212);
    striate(g, -Math.PI / 4, 14, 2, 206, 218); grain(g, 600, 8); });
  /* 4 баки — wide smooth bands, pressure-vessel curvature */
  cell(4, g => { plates(g, 2, 218, 230); striate(g, Math.PI / 2, 42, 10, 204, 216);
    grain(g, 400, 6); seams(g, [[0, 40, 256, 44], [0, 212, 256, 208]], 202); specks(g, 14, 198, 2); });
  /* 5 орудия — heavy irregular armour slabs */
  cell(5, g => { plates(g, 7, 204, 228); grain(g, 1100, 13);
    seams(g, [[0, 72, 256, 60], [96, 0, 108, 256], [108, 150, 256, 164], [0, 190, 96, 196]], 196);
    specks(g, 20, 192, 2.2); });
  /* 6 двигатели — coarse vertical venting, high contrast */
  cell(6, g => { plates(g, 2, 212, 226); striate(g, 0, 13, 6, 188, 206, 2); grain(g, 900, 12);
    seams(g, [[0, 30, 256, 30], [0, 226, 256, 226]], 198); });
  /* 7 ангар — large open bay panels with a scored floor rhythm */
  cell(7, g => { plates(g, 3, 216, 232); striate(g, Math.PI / 2, 30, 3, 202, 214); grain(g, 500, 7);
    seams(g, [[0, 124, 256, 124], [64, 0, 64, 256], [192, 0, 192, 256]], 204); });
  /* 8 корпус — structural plating: seams, rivet lines, subtle wear */
  cell(8, g => { plates(g, 6, 212, 230); grain(g, 800, 10);
    seams(g, [[0, 88, 256, 80], [120, 0, 126, 256], [126, 176, 256, 182], [0, 200, 120, 206]], 200);
    g.fillStyle = shade(198);
    for (let x = 14; x < 250; x += 26) { g.beginPath(); g.arc(x, 84, 2, 0, 7); g.fill(); }
    for (let y = 14; y < 250; y += 26) { g.beginPath(); g.arc(123, y, 2, 0, 7); g.fill(); } });
  /* 9 мостик — polished, almost bare with one hairline band */
  cell(9, g => { plates(g, 2, 226, 238); grain(g, 300, 5);
    striate(g, 0, 64, 2, 214, 224); seams(g, [[0, 120, 256, 116]], 212); });

  const tex = new THREE.CanvasTexture(cv);
  /* canvas pixels are sRGB-authored; untagged, three sampled them as linear
     and plate mode read ~25% brighter than drawn (notes/09-render-path.md
     §3.5). Decoded properly the palette renders as authored — any further
     brightness taste-tuning belongs in the Render tab, not the grays. */
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

let atlas: THREE.CanvasTexture | null = null;

/** lazy singleton; null when there is no DOM (node tests, workers) */
export function getAtlasTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  if (!atlas) atlas = makeAtlas();
  return atlas;
}

/** face-local [0,1] → atlas coords for a compartment cell */
export function atlasUV(comp: number, u: number, v: number): [number, number] {
  const cx = (comp % COLS) * CELL, cy = Math.floor(comp / COLS) * CELL;
  return [
    (cx + PAD + u * (CELL - 2 * PAD)) / ATLAS_N,
    1 - (cy + PAD + v * (CELL - 2 * PAD)) / ATLAS_N,
  ];
}

/** untouched atlas region — chamfer strips sample a flat tone, no pattern stretch */
export const BLANK_UV: readonly [number, number] =
  [(3.5 * CELL) / ATLAS_N, 1 - (3.5 * CELL) / ATLAS_N];
