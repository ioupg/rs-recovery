/* Shared render-layer types — the contract between geometry builders (pure
   functions over ShipDoc) and the scene/view infrastructure. */

import type * as THREE from 'three';
import type { MaterialSlot, Vec3 } from '../core/types';

export type RenderMode = 'box' | 'plate' | 'mesh';

export interface BuildOptions {
  mode: RenderMode;
  chamfer: boolean;
  ao: boolean;
  textures: boolean;
  /** index into plateMesh.quad_all (mesh mode decoration plates) */
  plateVariant: number;
}

export interface BuiltShip {
  /** non-indexed, with groups; material index i → groupSlots[i] */
  geometry: THREE.BufferGeometry;
  groupSlots: MaterialSlot[];
  /** archive texture per group (mesh mode with real textures), else null;
      parallel to groupSlots */
  groupTex: (string | null)[];
  /** source for the accent-line overlay (EdgesGeometry input), or null */
  edges: THREE.BufferGeometry | null;
  /** EdgesGeometry angle threshold (viewer used 25 plate mode, 32 mesh mode) */
  edgesThreshold: number;
}

export interface PickTri {
  kind: 'cube' | 'wing';
  uid: number;
  /** index into FACES[shape] (cubes) or 0 (wings) */
  faceIndex: number;
  /** outward axis step to the adjacent cell for placement, when the face
      normal is axis-aligned; null on slanted faces */
  exit: Vec3 | null;
}

export type ViewportLayout = 'single' | 'quad';
