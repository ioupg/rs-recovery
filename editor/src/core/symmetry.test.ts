import { describe, expect, it } from 'vitest';
import { corner, REFLECT_X_SHAPE, REFLECT_X_WING, rot, SHAPE_CORNERS, WING_KINDS } from './tables';
import { detectPlaneX2, isSelfMirrored, mirrorCubeSpec, mirrorWingSpec } from './symmetry';
import { ShipModel } from './model';
import type { CubeSpec, WingSpec } from './symmetry';
import type { ShapeId, ShipDoc } from './types';

const SHAPES = Object.keys(SHAPE_CORNERS).map(Number) as ShapeId[];
const PLANES = [0, 5, 12];

function worldCornerKey(x: number, y: number, z: number, o: number, shape: ShapeId): string {
  return SHAPE_CORNERS[shape]
    .map(i => {
      const p = rot(o, corner(i));
      return [x + p[0], y + p[1], z + p[2]].join(',');
    })
    .sort()
    .join('|');
}

function reflectedWorldCornerKey(x: number, y: number, z: number, o: number, shape: ShapeId, planeX2: number): string {
  return SHAPE_CORNERS[shape]
    .map(i => {
      const p = rot(o, corner(i));
      return [planeX2 - (x + p[0]), y + p[1], z + p[2]].join(',');
    })
    .sort()
    .join('|');
}

describe('mirrorCubeSpec', () => {
  it('is an involution across shapes, orientations and mirror planes', () => {
    for (const planeX2 of PLANES)
      for (const shape of SHAPES)
        for (let o = 0; o < 24; o++) {
          const spec: CubeSpec = { x: 3, y: 1, z: 2, o, shape, comp: 4 };
          const twice = mirrorCubeSpec(mirrorCubeSpec(spec, planeX2), planeX2);
          expect(twice).toEqual(spec);
        }
  });

  it("mirrored cube's world corner set equals the geometric reflection", () => {
    for (const planeX2 of PLANES)
      for (const shape of SHAPES)
        for (let o = 0; o < 24; o += 3) {
          const spec: CubeSpec = { x: 2, y: 1, z: 0, o, shape, comp: 0 };
          const mirrored = mirrorCubeSpec(spec, planeX2);
          const gotKey = worldCornerKey(mirrored.x, mirrored.y, mirrored.z, mirrored.o, shape);
          const wantKey = reflectedWorldCornerKey(spec.x, spec.y, spec.z, spec.o, shape, planeX2);
          expect(gotKey).toBe(wantKey);
        }
  });

  it('drops archive-only fields — the mirrored spec carries only x/y/z/o/shape/comp', () => {
    const spec: CubeSpec = { x: 2, y: 0, z: 0, o: 5, shape: 1, comp: 3 };
    const mirrored = mirrorCubeSpec(spec, 6);
    expect(Object.keys(mirrored).sort()).toEqual(['comp', 'o', 'shape', 'x', 'y', 'z']);
  });
});

describe('mirrorWingSpec', () => {
  it('is an involution across kinds, orientations and mirror planes', () => {
    for (const planeX2 of PLANES)
      for (const kind of WING_KINDS)
        for (let o = 0; o < 24; o++) {
          const spec: WingSpec = { x: 3, y: 1, z: 2, o, kind };
          const twice = mirrorWingSpec(mirrorWingSpec(spec, planeX2), planeX2);
          expect(twice).toEqual(spec);
        }
  });

  it('drops archive-only fields — the mirrored spec carries only x/y/z/o/kind', () => {
    const spec: WingSpec = { x: 2, y: 0, z: 0, o: 5, kind: 2 };
    const mirrored = mirrorWingSpec(spec, 6);
    expect(Object.keys(mirrored).sort()).toEqual(['kind', 'o', 'x', 'y', 'z']);
  });
});

describe('isSelfMirrored', () => {
  it('is true only when both the cell and the orientation map to themselves (cube)', () => {
    const shape: ShapeId = 0;
    const fixedO = Array.from({ length: 24 }, (_, o) => o).find(o => REFLECT_X_SHAPE[shape][o] === o);
    expect(fixedO).toBeDefined();
    const movingO = Array.from({ length: 24 }, (_, o) => o).find(o => REFLECT_X_SHAPE[shape][o] !== o);
    expect(movingO).toBeDefined();

    // planeX2 = 7 → self-mirrored cell is x = 3 (7 - 1 - 3 = 3)
    const selfCell: CubeSpec = { x: 3, y: 0, z: 0, o: fixedO as number, shape, comp: 0 };
    expect(isSelfMirrored(selfCell, 7)).toBe(true);

    const wrongCell: CubeSpec = { ...selfCell, x: 2 };
    expect(isSelfMirrored(wrongCell, 7)).toBe(false);

    const wrongOrient: CubeSpec = { ...selfCell, o: movingO as number };
    expect(isSelfMirrored(wrongOrient, 7)).toBe(false);
  });

  it('is true only when both the cell and the orientation map to themselves (wing)', () => {
    const kind = 0;
    const fixedO = Array.from({ length: 24 }, (_, o) => o).find(o => REFLECT_X_WING[kind][o] === o);
    expect(fixedO).toBeDefined();
    const movingO = Array.from({ length: 24 }, (_, o) => o).find(o => REFLECT_X_WING[kind][o] !== o);
    expect(movingO).toBeDefined();

    const selfCell: WingSpec = { x: 3, y: 0, z: 0, o: fixedO as number, kind };
    expect(isSelfMirrored(selfCell, 7)).toBe(true);
    expect(isSelfMirrored({ ...selfCell, x: 2 }, 7)).toBe(false);
    expect(isSelfMirrored({ ...selfCell, o: movingO as number }, 7)).toBe(false);
  });
});

describe('detectPlaneX2', () => {
  it('returns 0 for an empty ship', () => {
    const doc: ShipDoc = { meta: { name: 'n', display: 'N' }, cubes: [], wings: [] };
    expect(detectPlaneX2(new ShipModel(doc))).toBe(0);
  });

  it('is min+max+1 over cube cell x', () => {
    const doc: ShipDoc = {
      meta: { name: 'n', display: 'N' },
      cubes: [
        { uid: 1, x: 2, y: 0, z: 0, o: 0, shape: 0, comp: 0 },
        { uid: 2, x: 5, y: 0, z: 0, o: 0, shape: 0, comp: 0 },
      ],
      wings: [],
    };
    expect(detectPlaneX2(new ShipModel(doc))).toBe(2 + 5 + 1);
  });
});
