/* Regression suite for the two 2026-08-02 field reports:
   1. rotating a prismatic cube in place made plates appear on originally-bare
      faces (and vanish under further rotation) — slots were never rotated, so
      mounts kept decorating stale WORLD directions;
   2. a full cube carried an "unremovable" plate with a second togglable plate
      on the same face — slot resolution trusted the .o of EMPTY slots (whose
      bytes are garbage; the all-zero default reads as a −z mount), shadowing
      the genuinely mounted slot, and the fallback wrote to world-indexed
      slots on rotated cubes. */

import { describe, expect, it } from 'vitest';
import {
  AXIS_FACE_KIND, FACES, ORIENTATIONS, REFLECT_SHAPE, SLOT_AXES,
  plateFaceDir, rotDir, rotateOrient,
} from './tables';
import { clearPlatesPatch, reflectSlotsPatch, resolvePlateSlot, rotateSlotsPatch } from './plateOps';
import type { Cube, PlateSlot, ShapeId, Vec3 } from './types';

const SHAPES = Object.keys(FACES).map(Number) as ShapeId[];

const bareSlots = (): PlateSlot[] => Array.from({ length: 7 }, () => ({ o: 0, p: 0, f: 0 }));

/** the smallest mount orientation decorating world dir (any spin would do) */
const mountO = (dir: readonly number[]): number => {
  for (let o = 0; o < 24; o++) {
    const d = plateFaceDir(o);
    if (d[0] === dir[0] && d[1] === dir[1] && d[2] === dir[2]) return o;
  }
  throw new Error(`no mount decorates ${dir.join(',')}`);
};

/** world direction of local face i on a cube at orientation o */
const worldAxis = (o: number, i: number): [number, number, number] =>
  rotDir(o, SLOT_AXES[i]);

const makeCube = (p: Partial<Cube> & Pick<Cube, 'o' | 'shape'>): Cube =>
  ({ uid: 1, x: 0, y: 0, z: 0, comp: 8, ...p });

describe('resolvePlateSlot', () => {
  it('mounted slot wins over preceding empty slots with garbage .o (the "unremovable plate")', () => {
    // all-zero empty slots read as −z mounts; the real plate lives in slot 5
    const slots = bareSlots();
    slots[5] = { o: mountO([0, 0, -1]), p: 1, f: 0 };
    const c = makeCube({ o: 0, shape: 0, slots });
    const res = resolvePlateSlot(c, [0, 0, -1]);
    expect(res).toEqual({ idx: 5, canonO: slots[5].o, mounted: true });
  });

  it('a bare face resolves to its LOCAL axis slot, not the world-axis index', () => {
    // ORIENTATIONS[4] maps local +x to world +z
    expect(worldAxis(4, 0)).toEqual([0, 0, 1]);
    const c = makeCube({ o: 4, shape: 0 });          // no slots at all
    const res = resolvePlateSlot(c, [0, 0, 1]);
    expect(res?.idx).toBe(0);                        // local +x — old code said 4
    expect([...plateFaceDir(res!.canonO)]).toEqual([0, 0, 1]);
  });

  it('empty slots never capture a click even when .o happens to match', () => {
    const slots = bareSlots();                       // every .o = 0 → "decorates" −z
    const c = makeCube({ o: 0, shape: 0, slots });
    const res = resolvePlateSlot(c, [0, 0, -1]);
    expect(res?.idx).toBe(5);                        // local −z, by axis fallback
  });

  it('non-axis face: slot 6 for shaped cubes, nothing on a full cube', () => {
    expect(resolvePlateSlot(makeCube({ o: 0, shape: 0 }), null)).toBeNull();
    expect(resolvePlateSlot(makeCube({ o: 3, shape: 2 }), null))
      .toEqual({ idx: 6, canonO: 0, mounted: false });
    const slots = bareSlots();
    slots[6] = { o: 0, p: 1, f: 0 };
    expect(resolvePlateSlot(makeCube({ o: 3, shape: 2, slots }), null))
      .toEqual({ idx: 6, canonO: 0, mounted: true });
  });

  it('a mounted slot decorating ANOTHER face does not make this face read mounted', () => {
    // legacy corruption: local +x slot mounted but its .o decorates world −z
    const slots = bareSlots();
    slots[0] = { o: mountO([0, 0, -1]), p: 1, f: 0 };
    const c = makeCube({ o: 0, shape: 0, slots });
    const onX = resolvePlateSlot(c, [1, 0, 0]);      // clicked face is visually bare
    expect(onX?.idx).toBe(0);
    expect(onX?.mounted).toBe(false);
    const onZ = resolvePlateSlot(c, [0, 0, -1]);     // the plate renders here
    expect(onZ?.idx).toBe(0);
    expect(onZ?.mounted).toBe(true);
  });
});

describe('rotateSlotsPatch', () => {
  it('keeps every mounted plate glued to its local face across all ±90° steps', () => {
    for (const s of SHAPES) {
      for (let o = 0; o < 24; o++) {
        for (const axis of [0, 1, 2] as const) {
          for (const dir of [1, -1] as const) {
            const newO = rotateOrient(o, axis, dir);
            for (let i = 0; i < 6; i++) {
              if (!AXIS_FACE_KIND[s][i]) continue;
              const slots = bareSlots();
              slots[i] = { o: mountO(worldAxis(o, i)), p: 1, f: 3 };
              const patch = rotateSlotsPatch(makeCube({ o, shape: s, slots }), newO);
              const got = patch.slots![i];
              expect([...plateFaceDir(got.o)]).toEqual(worldAxis(newO, i));
              expect(got.p).toBe(1);
              expect(got.f).toBe(3);
            }
          }
        }
      }
    }
  });

  it('reproduces field report 1: a stale wedge mount lands on a bare face — the patch prevents it', () => {
    // k6 wedge at o=0, plate on its local +z quad (slot 4)
    const slots = bareSlots();
    slots[4] = { o: mountO([0, 0, 1]), p: 1, f: 0 };
    const c = makeCube({ o: 0, shape: 2, slots });

    // rotate three times +90° about x WITHOUT touching slots (the old bug):
    // the stale world dir +z maps onto local −y — a real quad face that was
    // never plated (the phantom); the two intermediate steps map onto the
    // wedge's faceless axes (the plate "disappears")
    let o = c.o;
    const staleDir = plateFaceDir(slots[4].o);
    const localOf = (cubeO: number, d: readonly number[]): number => {
      const M = ORIENTATIONS[cubeO];
      const l = [
        M[0] * d[0] + M[3] * d[1] + M[6] * d[2],
        M[1] * d[0] + M[4] * d[1] + M[7] * d[2],
        M[2] * d[0] + M[5] * d[1] + M[8] * d[2],
      ];
      return SLOT_AXES.findIndex(a => a[0] === l[0] && a[1] === l[1] && a[2] === l[2]);
    };
    const hits: (string | null)[] = [];
    for (let step = 0; step < 3; step++) {
      o = rotateOrient(o, 0, 1);
      hits.push(AXIS_FACE_KIND[2][localOf(o, staleDir)]);
    }
    expect(hits).toEqual([null, null, 'quad']);      // vanish, vanish, phantom

    // WITH the patch the mount follows the solid: still local +z every step
    let cur = c;
    for (let step = 0; step < 3; step++) {
      const newO = rotateOrient(cur.o, 0, 1);
      cur = { ...cur, o: newO, ...rotateSlotsPatch(cur, newO) };
      expect([...plateFaceDir(cur.slots![4].o)]).toEqual(worldAxis(cur.o, 4));
    }
  });

  it('four quarter-turns restore the slots byte-exactly; slot 6 rides verbatim', () => {
    const slots = bareSlots();
    slots[0] = { o: mountO(worldAxis(7, 0)), p: 1, f: 1 };
    slots[3] = { o: mountO(worldAxis(7, 3)), p: 1, f: 0 };
    slots[6] = { o: 13, p: 1, f: 2 };                // untrusted archive bytes
    let cur = makeCube({ o: 7, shape: 0, slots });
    for (let step = 0; step < 4; step++) {
      const newO = rotateOrient(cur.o, 1, 1);
      const patch = rotateSlotsPatch(cur, newO);
      expect(patch.slots![6]).toEqual(slots[6]);
      cur = { ...cur, o: newO, ...patch };
    }
    expect(cur.o).toBe(7);
    expect(cur.slots).toEqual(slots);
  });

  it('is a no-op without slots or without a reorientation', () => {
    expect(rotateSlotsPatch(makeCube({ o: 2, shape: 0 }), 5)).toEqual({});
    const slots = bareSlots();
    expect(rotateSlotsPatch(makeCube({ o: 2, shape: 0, slots }), 2)).toEqual({});
  });
});

describe('reflectSlotsPatch', () => {
  it('moves each plate to the mirrored face and keeps the slot-index invariant', () => {
    for (const s of SHAPES) {
      for (const axis of [0, 1, 2] as const) {
        for (let o = 0; o < 24; o++) {
          const newO = REFLECT_SHAPE[axis][s][o];
          for (let i = 0; i < 6; i++) {
            if (!AXIS_FACE_KIND[s][i]) continue;
            const slots = bareSlots();
            slots[i] = { o: mountO(worldAxis(o, i)), p: 1, f: 2 };
            const kinds: (string | null)[] = Array.from({ length: 7 }, () => null);
            kinds[i] = 'panel';
            const patch = reflectSlotsPatch(
              makeCube({ o, shape: s, slots, plateKinds: kinds }), axis);
            const mounted = patch.slots!
              .map((sl, j) => ({ sl, j }))
              .filter(e => e.j < 6 && e.sl.p);
            expect(mounted.length).toBe(1);
            const { sl, j } = mounted[0];
            const want = worldAxis(o, i);
            want[axis] = -want[axis] + 0;            // S_axis · old world dir (-0 → +0)
            expect([...plateFaceDir(sl.o)]).toEqual(want);
            // invariant: slot j decorates the local face j of the new solid
            expect(worldAxis(newO, j)).toEqual(want);
            expect(sl.f).toBe(2);
            expect(patch.plateKinds![j]).toBe('panel');
          }
        }
      }
    }
  });

  it('is an involution on slots and plateKinds', () => {
    const slots = bareSlots();
    slots[0] = { o: mountO(worldAxis(5, 0)), p: 1, f: 1 };
    slots[3] = { o: mountO(worldAxis(5, 3)), p: 1, f: 0 };
    slots[6] = { o: 9, p: 1, f: 4 };
    const kinds: (string | null)[] = [null, 'a', null, 'b', null, null, 'c'];
    for (const axis of [0, 1, 2] as const) {
      const c = makeCube({ o: 5, shape: 1, slots, plateKinds: kinds });
      const p1 = reflectSlotsPatch(c, axis);
      const p2 = reflectSlotsPatch(
        { ...c, o: REFLECT_SHAPE[axis][1][c.o], ...p1 }, axis);
      expect(p2.slots).toEqual(slots);
      expect(p2.plateKinds).toEqual(kinds);
    }
  });
});

describe('clearPlatesPatch', () => {
  it('clears every mounted slot decorating the face — healing duplicates', () => {
    const slots = bareSlots();
    const dir: Vec3 = [0, 0, -1];
    slots[5] = { o: mountO(dir), p: 1, f: 0 };       // the legitimate plate
    slots[0] = { o: mountO(dir), p: 1, f: 0 };       // corrupted duplicate
    slots[2] = { o: mountO([0, 1, 0]), p: 1, f: 0 }; // unrelated face
    const kinds: (string | null)[] = ['dup', null, 'top', null, null, 'real', null];
    const patch = clearPlatesPatch(makeCube({ o: 0, shape: 0, slots, plateKinds: kinds }), dir);
    expect(patch!.slots![0].p).toBe(0);
    expect(patch!.slots![5].p).toBe(0);
    expect(patch!.slots![2]).toEqual(slots[2]);      // untouched
    expect(patch!.plateKinds).toEqual([null, null, 'top', null, null, null, null]);
  });

  it('returns null when nothing decorates the face', () => {
    const c = makeCube({ o: 0, shape: 0, slots: bareSlots() });
    expect(clearPlatesPatch(c, [1, 0, 0])).toBeNull();
    expect(clearPlatesPatch(makeCube({ o: 0, shape: 0 }), [1, 0, 0])).toBeNull();
  });
});
