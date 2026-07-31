/* Mirror across the grid plane x = planeX2 / 2. Cell map for CELLS:
   x′ = planeX2 − 1 − x (cell [x, x+1) reflects to [planeX2−1−x, planeX2−x)).
   Orientation maps come from REFLECT_X_SHAPE / REFLECT_X_WING (tables.ts),
   which are involutions by construction. Archive-only fields (slots/id/
   counter/flag/variant on cubes, extra on wings) never survive a mirror —
   the mirrored entity is always freshly created by the controller. */

import { REFLECT_X_SHAPE, REFLECT_X_WING } from './tables';
import type { ShipModel } from './model';
import type { Cube, Wing } from './types';

export type CubeSpec = Pick<Cube, 'x' | 'y' | 'z' | 'o' | 'shape' | 'comp'>;
export type WingSpec = Pick<Wing, 'x' | 'y' | 'z' | 'o' | 'kind'>;

/** min+max+1 over cube cell x → planeX2; 0 for an empty ship */
export function detectPlaneX2(model: ShipModel): number {
  const cubes = model.doc.cubes;
  if (cubes.length === 0) return 0;
  let min = Infinity, max = -Infinity;
  for (const c of cubes) {
    if (c.x < min) min = c.x;
    if (c.x > max) max = c.x;
  }
  return min + max + 1;
}

export function mirrorCubeSpec(c: CubeSpec, planeX2: number): CubeSpec {
  return {
    x: planeX2 - 1 - c.x,
    y: c.y,
    z: c.z,
    o: REFLECT_X_SHAPE[c.shape][c.o],
    shape: c.shape,
    comp: c.comp,
  };
}

export function mirrorWingSpec(w: WingSpec, planeX2: number): WingSpec {
  return {
    x: planeX2 - 1 - w.x,
    y: w.y,
    z: w.z,
    o: REFLECT_X_WING[w.kind][w.o],
    kind: w.kind,
  };
}

/** a spec is self-mirrored when its cell AND orientation map to themselves
    (shape/kind never change under an x-mirror, so those are not checked) */
export function isSelfMirrored(spec: CubeSpec | WingSpec, planeX2: number): boolean {
  const mirrored = 'shape' in spec ? mirrorCubeSpec(spec, planeX2) : mirrorWingSpec(spec, planeX2);
  return mirrored.x === spec.x && mirrored.o === spec.o;
}
