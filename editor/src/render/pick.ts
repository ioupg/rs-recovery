/* Invisible pick mesh: exact shape solids + wing polygons with a
   triangle → entity map, raycast regardless of render mode. */

import type * as THREE from 'three';
import type { ShipDoc } from '../core/types';
import type { PickTri } from './geometryTypes';

export function buildPickGeometry(_doc: ShipDoc): { geometry: THREE.BufferGeometry; tris: PickTri[] } {
  throw new Error('not implemented'); // replaced by the geometry port
}
