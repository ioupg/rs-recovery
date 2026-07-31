import { describe, expect, it } from 'vitest';
import {
  FACES, ORIENTATIONS, REFLECT_X_SHAPE, REFLECT_X_WING, SHAPE_CORNERS,
  WING_RING, corner, rot, rotateOrient,
} from './tables';
import type { ShapeId } from './types';

describe('tables', () => {
  it('has 24 orthonormal signed-permutation matrices', () => {
    expect(ORIENTATIONS.length).toBe(24);
    for (const m of ORIENTATIONS) {
      expect(m.filter(v => v !== 0).length).toBe(3);
      // det +1
      const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6])
        + m[2] * (m[3] * m[7] - m[4] * m[6]);
      expect(det).toBe(1);
    }
  });

  it('reflection tables are involutions that reproduce mirrored corner sets', () => {
    const key = (pts: number[][]) => pts.map(p => p.join(',')).sort().join('|');
    for (const s of Object.keys(FACES).map(Number) as ShapeId[]) {
      for (let o = 0; o < 24; o++) {
        const r = REFLECT_X_SHAPE[s][o];
        expect(REFLECT_X_SHAPE[s][r]).toBe(o);
        const mirrored = SHAPE_CORNERS[s].map(i => {
          const p = rot(o, corner(i));
          return [1 - p[0], p[1], p[2]];
        });
        const got = SHAPE_CORNERS[s].map(i => rot(r, corner(i)) as unknown as number[]);
        expect(key(got)).toBe(key(mirrored));
      }
    }
    for (const k of Object.keys(WING_RING).map(Number))
      for (let o = 0; o < 24; o++)
        expect(REFLECT_X_WING[k][REFLECT_X_WING[k][o]]).toBe(o);
  });

  it('axis rotations are 4-cycles with exact inverses', () => {
    for (const axis of [0, 1, 2] as const) {
      for (let o = 0; o < 24; o++) {
        let f = o;
        for (let i = 0; i < 4; i++) f = rotateOrient(f, axis, 1);
        expect(f).toBe(o);                                     // 90° × 4 = identity
        expect(rotateOrient(rotateOrient(o, axis, 1), axis, -1)).toBe(o);
      }
      // each step is a permutation
      const seen = new Set(Array.from({ length: 24 }, (_, o) => rotateOrient(o, axis, 1)));
      expect(seen.size).toBe(24);
    }
  });
});
