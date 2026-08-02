/* Pure plate-slot editing operations. The invariant they all maintain:
   slot index i (< 6) names the CUBE-LOCAL face [+x,−x,+y,−y,+z,−z][i], while
   slot.o is the WORLD mount — a mounted slot i must decorate world direction
   R(cube.o)·SLOT_AXES[i], i.e. plateFaceDir(slot.o) = R(cube.o)·SLOT_AXES[i].
   Slot 6 (the non-axis face) mounts by R(cube.o) alone and its stored bytes
   are untrusted (see tables.ts), so it is carried verbatim everywhere here.

   Empty slots (p = 0) carry meaningless .o — archive dumps leave stale bytes
   and editor defaults are all-zero (and plateFaceDir(0) = −z), so .o is only
   ever trusted on mounted slots. */

import type { Cube, PlateSlot, ShapeId, Vec3 } from './types';
import {
  MIRROR_SLOT_PERM, ORIENTATIONS, REFLECT_PLATE, SLOT_AXES,
  composeOrient, orientDelta, plateCanonical, plateFaceDir,
} from './tables';

/** mounted: the resolution matched a plate the renderer actually draws on
    this face — the tool's mounted/bare decision. slots[idx].p alone lies on
    legacy-corrupted docs where a mounted slot decorates a different face. */
export interface PlateSlotRes { idx: number; canonO: number; mounted: boolean }

const sameDir = (a: readonly number[], b: readonly number[]): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Resolve the slot a face click addresses. Mounted slots resolve by their
    world mount orientation — the exact frame the renderer draws them in — so
    the tool always finds the plate the user sees. A bare face resolves to its
    LOCAL axis index (the archive's slot-index frame; the old world-index
    fallback corrupted rotated cubes) with the canonical fresh-mount spin. */
export function resolvePlateSlot(cube: Cube, dir: Vec3 | null): PlateSlotRes | null {
  if (!dir) {
    if (cube.shape === 0) return null;
    const s6 = cube.slots?.[6];
    return { idx: 6, canonO: s6?.o ?? 0, mounted: !!s6 && s6.p !== 0 };
  }
  if (cube.slots) {
    for (let i = 0; i < 6 && i < cube.slots.length; i++) {
      const sl = cube.slots[i];
      if (!sl.p) continue;                    // empty slots carry garbage .o
      if (sameDir(plateFaceDir(sl.o), dir)) return { idx: i, canonO: sl.o, mounted: true };
    }
  }
  const M = ORIENTATIONS[cube.o];
  if (!M) return null;
  const local = [                              // Rᵀ·dir — world → local
    M[0] * dir[0] + M[3] * dir[1] + M[6] * dir[2],
    M[1] * dir[0] + M[4] * dir[1] + M[7] * dir[2],
    M[2] * dir[0] + M[5] * dir[1] + M[8] * dir[2],
  ];
  const idx = SLOT_AXES.findIndex(a => sameDir(a, local));
  if (idx < 0) return null;
  return {
    idx,
    canonO: plateCanonical(cube.shape as ShapeId, cube.o, dir as [number, number, number]),
    mounted: false,
  };
}

/** Slots patch keeping every plate glued to its local face when the cube
    reorients o→newO by a rotation (the X/C/V steps and the R cycle alike):
    each axis mount composes with the world delta W = R(newO)·R(o)ᵀ. Slot
    indices and plateKinds are local, so they stay put. */
export function rotateSlotsPatch(cube: Cube, newO: number): Partial<Cube> {
  if (!cube.slots?.length || newO === cube.o) return {};
  const w = orientDelta(newO, cube.o);
  const slots: PlateSlot[] = cube.slots.map((s, i) =>
    i < 6 ? { ...s, o: composeOrient(w, s.o) } : { ...s });
  return { slots };
}

/** Slots patch mirroring the decoration along with the solid across a world
    axis: local faces permute (MIRROR_SLOT_PERM) and each mount reflects
    through REFLECT_PLATE, so the mounted footprints land exactly on the
    mirrored faces. plateKinds ride their faces. Chiral relief cannot be
    mirrored by a pure rotation mount — the footprint placement is. */
export function reflectSlotsPatch(cube: Cube, axis: 0 | 1 | 2): Partial<Cube> {
  const perm = MIRROR_SLOT_PERM[axis][cube.shape as ShapeId];
  const patch: Partial<Cube> = {};
  if (cube.slots?.length) {
    const slots: PlateSlot[] = cube.slots.map(s => ({ ...s }));
    for (let i = 0; i < 6 && i < cube.slots.length; i++) {
      const j = perm[i];
      if (j < slots.length)
        slots[j] = { ...cube.slots[i], o: REFLECT_PLATE[axis][cube.slots[i].o] };
    }
    patch.slots = slots;
  }
  if (cube.plateKinds?.length) {
    const kinds: (string | null)[] = [...cube.plateKinds];
    for (let i = 0; i < 6 && i < cube.plateKinds.length; i++) {
      const j = perm[i];
      if (j < kinds.length) kinds[j] = cube.plateKinds[i] ?? null;
    }
    patch.plateKinds = kinds;
  }
  return patch;
}

/** Patch clearing EVERY mounted axis slot decorating world `dir` — duplicates
    included. Two slots pointing at one face is always corruption (the old
    presence-blind resolution and world-index writes could produce it, leaving
    an "unremovable" plate under the one the tool toggled); removal heals it.
    Returns null when nothing decorates that face. */
export function clearPlatesPatch(cube: Cube, dir: Vec3): Partial<Cube> | null {
  if (!cube.slots?.length) return null;
  const slots: PlateSlot[] = cube.slots.map(s => ({ ...s }));
  const kinds: (string | null)[] | null = cube.plateKinds ? [...cube.plateKinds] : null;
  let hit = false;
  for (let i = 0; i < 6 && i < slots.length; i++) {
    if (!slots[i].p) continue;
    if (!sameDir(plateFaceDir(slots[i].o), dir)) continue;
    slots[i] = { ...slots[i], p: 0 };
    if (kinds && i < kinds.length) kinds[i] = null;
    hit = true;
  }
  if (!hit) return null;
  const patch: Partial<Cube> = { slots };
  if (kinds) patch.plateKinds = kinds;
  return patch;
}
