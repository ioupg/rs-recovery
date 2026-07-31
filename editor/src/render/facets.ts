/* Facet collection, interior culling and the outward-normal rule — the shared
   front half of every render mode (viewer index.html 763-798, orient 258-264).
   Three.js-free on purpose: the same facets feed geometry, chamfer and pick. */

import type { Cube, ShapeId } from '../core/types';
import { FACES, ORIENTATIONS, SHAPE_CENTROID, corner, rot } from '../core/tables';
import type { Occupancy } from './ao';

export type V3 = [number, number, number];

export const sub = (a: readonly number[], b: readonly number[]): V3 =>
  [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: readonly number[], b: readonly number[]): V3 =>
  [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: readonly number[], s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a: readonly number[], b: readonly number[]): V3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: readonly number[], b: readonly number[]): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: readonly number[]): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** quantised vertex identity — chamfer edge/corner incidence keys */
export const vkey = (v: readonly number[]): string =>
  v.map(x => Math.round(x * 1000)).join(',');

export const centroid = (vs: readonly V3[]): V3 =>
  mul(vs.reduce<V3>((s, v) => add(s, v), [0, 0, 0]), 1 / vs.length);

/** winding normal of a planar loop (unit) — not reliably outward, see orient() */
export const facetNormal = (vs: readonly V3[]): V3 =>
  norm(cross(norm(sub(vs[1], vs[0])), sub(vs[2], vs[0])));

export interface Facet {
  /** world-space loop, in FACES order (defines the plate-mapping frame) */
  verts: V3[];
  comp: number;
  shape: ShapeId;
  /** centroid of the source solid: outward is away from it */
  sc?: V3;
  /** vertex-set identity — cull key and seed of the per-facet tone jitter */
  k: string;
  /** chamfer strip or corner patch: flat atlas tone, no edge overlay */
  plain?: boolean;
}

const keyOf = (vs: readonly V3[]): string => vs.map(v => v.join(',')).sort().join('|');

/** every shape facet of every cube, in world space (viewer 770-786) */
export function collectFacets(cubes: readonly Cube[]): Facet[] {
  const faces: Facet[] = [];
  for (const cb of cubes) {
    const loops = FACES[cb.shape as ShapeId];
    if (!loops || !ORIENTATIONS[cb.o]) continue;
    const c = rot(cb.o, SHAPE_CENTROID[cb.shape as ShapeId]);
    const sc: V3 = [c[0] + cb.x, c[1] + cb.y, c[2] + cb.z];
    for (const loop of loops) {
      const verts = loop.map(ci => {
        const p = rot(cb.o, corner(ci));
        return [p[0] + cb.x, p[1] + cb.y, p[2] + cb.z] as V3;
      });
      faces.push({ verts, comp: cb.comp, shape: cb.shape as ShapeId, sc, k: keyOf(verts) });
    }
  }
  return faces;
}

/** drop coincident facet pairs (interior) and triangles hidden under a quad
    (a wedge slope sharing its plane with a neighbour's plate) — viewer 783-798 */
export function cullFacets(faces: readonly Facet[]): Facet[] {
  const cnt = new Map<string, number>();
  for (const f of faces) cnt.set(f.k, (cnt.get(f.k) ?? 0) + 1);
  const quadVertSets: Set<string>[] = [];
  for (const f of faces)
    if (f.verts.length === 4 && cnt.get(f.k) === 1)
      quadVertSets.push(new Set(f.verts.map(v => v.join(','))));
  return faces.filter(f => {
    if ((cnt.get(f.k) ?? 0) > 1) return false;
    if (f.verts.length === 3) {
      const vk = f.verts.map(v => v.join(','));
      for (const qs of quadVertSets) if (vk.every(v => qs.has(v))) return false;
    }
    return true;
  });
}

/* Point a facet normal outward. Winding is not reliably outward (the k6 slope
   loop winds inward), and the occupancy probe ties on slanted facets — a slope
   runs through the middle of its own cell, so a quarter-step either side of its
   centre floors into the same cell and no flip happens. Facets therefore carry
   the centroid of their source solid: outward is away from it. Chamfer strips
   inherit an averaged centroid; anything without one falls back to the probe. */
export function orient(n: V3, cen: V3, f: { sc?: V3 }, occ: Occupancy): V3 {
  if (f.sc)
    return n[0] * (cen[0] - f.sc[0]) + n[1] * (cen[1] - f.sc[1]) + n[2] * (cen[2] - f.sc[2]) < 0
      ? [-n[0], -n[1], -n[2]]
      : n;
  const at = (s: number): number =>
    occ.get(
      `${Math.floor(cen[0] + s * 0.25 * n[0])},${Math.floor(cen[1] + s * 0.25 * n[1])},${Math.floor(cen[2] + s * 0.25 * n[2])}`,
    ) ?? 0;
  return at(+1) > at(-1) ? [-n[0], -n[1], -n[2]] : n;
}
