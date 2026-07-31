/* Ambient occlusion baked per vertex from cell occupancy (viewer 207-249).
   For a vertex, the cells on the outward side of the facet are what a
   hemisphere of skylight has to pass through; the weighted fraction that is
   solid is the occlusion. Partial shapes (wedges, tetras) count for less than a
   full cube since they leave the cell open. */

import type { ShapeId } from '../core/types';
import { SHAPE_FILL } from '../core/tables';

/** `x,y,z` cell key → how much of the cell is solid */
export type Occupancy = Map<string, number>;

/* AO_POWER tightens the falloff the way raising a specular exponent does: high
   values keep open surfaces clean and drive the darkening deep into the
   crevices, so AO_DEPTH can be pushed hard without greying out the whole hull.
   AO_RANGE is where the raw occlusion ratio saturates — a cosine-weighted
   sample of this neighbourhood tops out near 0.7 in the deepest corners
   (measured across the fleet), and normalising by it puts the whole curve to
   work instead of its toe. */
export const AO_POWER = 1.8;
export const AO_DEPTH = 0.86;
export const AO_RANGE = 0.42;

export function occupancyOf(
  cubes: readonly { x: number; y: number; z: number; shape: number }[],
): Occupancy {
  const occ: Occupancy = new Map();
  for (const c of cubes) {
    const k = `${c.x},${c.y},${c.z}`;
    occ.set(k, Math.max(occ.get(k) ?? 0, SHAPE_FILL[c.shape as ShapeId] ?? 1));
  }
  return occ;
}

/** occlusion factor in (0,1] — multiply into the vertex colour.
    `ownKey` excludes the vertex's own cell so a wedge never occludes its slope. */
export function vertexAO(
  v: readonly number[],
  n: readonly number[],
  occ: Occupancy,
  ownKey: string | null,
): number {
  const cx = Math.round(v[0]), cy = Math.round(v[1]), cz = Math.round(v[2]);
  let solid = 0, total = 0;
  /* Cosine-weighted obscurance over a 4x4x4 neighbourhood. A single ring of
     eight cells is too coarse for slanted facets — a 45-degree plane admits
     only two of them, so the result quantises into blotches. Sampling wider and
     weighting by cos(theta)/d^2 resolves the hemisphere smoothly at any
     orientation. */
  for (let i = -2; i < 2; i++)
    for (let j = -2; j < 2; j++)
      for (let k = -2; k < 2; k++) {
        const dx = i + 0.5, dy = j + 0.5, dz = k + 0.5;   // cell centre rel. vertex
        const d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2);
        const cos = (dx * n[0] + dy * n[1] + dz * n[2]) / d;
        if (cos <= 0) continue;                            // behind the facet
        const key = `${cx + i},${cy + j},${cz + k}`;
        if (key === ownKey) continue;
        const w = cos / d2;
        total += w;
        solid += w * (occ.get(key) ?? 0);
      }
  if (!total) return 1;
  return 1 - AO_DEPTH * Math.pow(Math.min(1, solid / total / AO_RANGE), AO_POWER);
}
