/* Symmetry expansion: tools produce primitive specs, the controller expands
   them with their mirror twins before building commands. Self-mirrored specs
   (on-plane cubes that map to themselves) are never duplicated. */

import type { Cube, Wing } from '../core/types';
import { isSelfMirrored, mirrorCubeSpec, mirrorWingSpec } from '../core/symmetry';

export type CubeSpec = Omit<Cube, 'uid' | 'slots' | 'id' | 'counter' | 'flag' | 'variant'>;
export type WingSpec = Omit<Wing, 'uid' | 'extra'>;

export function expandCubeSpecs(specs: CubeSpec[], on: boolean, planeX2: number): CubeSpec[] {
  if (!on) return specs;
  const out: CubeSpec[] = [];
  const seen = new Set<string>();
  for (const s of specs) {
    const cellKey = `${s.x},${s.y},${s.z}`;
    if (!seen.has(cellKey)) { seen.add(cellKey); out.push(s); }
    const m = mirrorCubeSpec(s, planeX2);
    const mKey = `${m.x},${m.y},${m.z}`;
    if (!isSelfMirrored(s, planeX2) && !seen.has(mKey)) { seen.add(mKey); out.push(m); }
  }
  return out;
}

export function expandWingSpecs(specs: WingSpec[], on: boolean, planeX2: number): WingSpec[] {
  if (!on) return specs;
  const out: WingSpec[] = [];
  const seen = new Set<string>();
  for (const s of specs) {
    const k = `${s.x},${s.y},${s.z},${s.kind},${s.o}`;
    if (!seen.has(k)) { seen.add(k); out.push(s); }
    const m = mirrorWingSpec(s, planeX2);
    const mk = `${m.x},${m.y},${m.z},${m.kind},${m.o}`;
    if (!seen.has(mk)) { seen.add(mk); out.push(m); }
  }
  return out;
}

/** uids of the mirror twins of the given entities (for erase/paint/move with
    symmetry on): a cube twin is whatever cube occupies the mirrored cell; a
    wing twin is a wing at the mirrored cell with the mirrored kind+orientation. */
export function mirrorTwinUids(
  uids: Iterable<number>,
  planeX2: number,
  byUid: (uid: number) => Cube | Wing | undefined,
  cubeAt: (x: number, y: number, z: number) => Cube | undefined,
  wings: () => readonly Wing[],
): number[] {
  const out = new Set<number>();
  const input = new Set(uids);
  for (const uid of input) {
    const e = byUid(uid);
    if (!e) continue;
    if ('shape' in e) {
      const m = mirrorCubeSpec(e, planeX2);
      const twin = cubeAt(m.x, m.y, m.z);
      if (twin && !input.has(twin.uid)) out.add(twin.uid);
    } else {
      const m = mirrorWingSpec(e, planeX2);
      const twin = wings().find(w =>
        w.x === m.x && w.y === m.y && w.z === m.z && w.kind === m.kind && w.o === m.o);
      if (twin && !input.has(twin.uid)) out.add(twin.uid);
    }
  }
  return [...out];
}
