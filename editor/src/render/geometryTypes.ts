/* Shared render-layer types — the contract between geometry builders (pure
   functions over ShipDoc) and the scene/view infrastructure. */

import type * as THREE from 'three';
import type { MaterialSlot, Vec3 } from '../core/types';

export type RenderMode = 'box' | 'plate' | 'mesh';

/** decoration-mesh choice per recovered plate type (the type assignment per
    face is exact data; only which archive mesh dresses each type is a choice) */
export interface PlateVariants {
  /** p1111 axis quads — index into plateMesh.quad_all */
  quad: number;
  /** p2121 slope rectangles — index into plateMesh.quad_all (sheared) */
  slope: number;
  /** p121 axis triangles — index into plateMesh.tri_all */
  tri: number;
  /** p222A/V cut faces — index into plateMesh.tri_all (sheared) */
  eq: number;
}

export interface BuildOptions {
  mode: RenderMode;
  chamfer: boolean;
  ao: boolean;
  textures: boolean;
  /** render decoration plates at all (mesh mode) */
  plates: boolean;
  plateVariants: PlateVariants;
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
