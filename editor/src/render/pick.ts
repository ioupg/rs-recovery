/* Invisible pick mesh: exact shape solids + wing polygons with a
   triangle → entity map, raycast regardless of render mode. No chamfer, no
   inset, no culling — the picker must answer for every authored face, at the
   cell the entity actually occupies. */

import * as THREE from 'three';
import type { ShapeId, ShipDoc, Vec3 } from '../core/types';
import { FACES, ORIENTATIONS, SHAPE_CENTROID, WING_RING, corner, rot } from '../core/tables';
import type { PickTri } from './geometryTypes';
import { occupancyOf } from './ao';
import { centroid, facetNormal, orient, type V3 } from './facets';

/** the outward unit axis step to the adjacent cell, on axis-aligned faces */
function axisExit(n: V3): Vec3 | null {
  for (let a = 0; a < 3; a++)
    if (Math.abs(n[a]) > 0.99) {
      const e: [number, number, number] = [0, 0, 0];
      e[a] = n[a] > 0 ? 1 : -1;
      return e;
    }
  return null;
}

export function buildPickGeometry(
  doc: ShipDoc,
): { geometry: THREE.BufferGeometry; tris: PickTri[] } {
  /* only feeds orient()'s probe fallback; every facet here carries an `sc` */
  const occ = occupancyOf(doc.cubes);
  const pos: number[] = [];
  const tris: PickTri[] = [];

  const emit = (vs: readonly V3[], tri: PickTri): void => {
    for (let i = 1; i < vs.length - 1; i++) {
      pos.push(...vs[0], ...vs[i], ...vs[i + 1]);
      tris.push(tri);
    }
  };

  for (const cb of doc.cubes) {
    const loops = FACES[cb.shape as ShapeId];
    if (!loops || !ORIENTATIONS[cb.o]) continue;
    const c = rot(cb.o, SHAPE_CENTROID[cb.shape as ShapeId]);
    const sc: V3 = [c[0] + cb.x, c[1] + cb.y, c[2] + cb.z];
    loops.forEach((loop, faceIndex) => {
      if (loop.length < 3) return;
      const vs = loop.map(ci => {
        const p = rot(cb.o, corner(ci));
        return [p[0] + cb.x, p[1] + cb.y, p[2] + cb.z] as V3;
      });
      const n = orient(facetNormal(vs), centroid(vs), { sc }, occ);
      emit(vs, { kind: 'cube', uid: cb.uid, faceIndex, exit: axisExit(n) });
    });
  }

  for (const el of doc.wings) {
    const ring = WING_RING[el.kind];
    if (!ring || ring.length < 3 || !ORIENTATIONS[el.o]) continue;
    const vs = ring.map(ci => {
      const p = rot(el.o, corner(ci));
      return [p[0] + el.x, p[1] + el.y, p[2] + el.z] as V3;
    });
    emit(vs, { kind: 'wing', uid: el.uid, faceIndex: 0, exit: null });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return { geometry, tris };
}
