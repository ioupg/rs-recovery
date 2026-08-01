/* Turns a core LibMaterial def into a live THREE.MeshPhysicalMaterial: maps
   resolved through textureCache (with the material's own uv transform) plus
   scalars, three.js semantics throughout (a scalar multiplies its map when
   one is present). Shared by materialCache.ts (mesh-mode materials) and the
   material library preview widgets in shapePreview.ts — all of them one
   persistent instance patched in place via applyLibMaterial. */

import * as THREE from 'three';
import type { LibMaterial } from '../core/types';
import { getMapTexture } from './textureCache';

interface ResolvedMaps {
  albedo: THREE.Texture | null;
  normal: THREE.Texture | null;
  /** roughnessMap AND metalnessMap both point here when present (glTF ORM
      pack: three reads G for roughness, B for metalness) */
  orm: THREE.Texture | null;
  roughness: THREE.Texture | null;
  emissive: THREE.Texture | null;
}

function resolveMaps(mat: LibMaterial): ResolvedMaps {
  const uv = { scale: mat.uvScale, rotationDeg: mat.uvRotation };
  const { albedo, normal, orm, roughness, emissive } = mat.maps;
  return {
    albedo: albedo ? getMapTexture(albedo, THREE.SRGBColorSpace, uv) : null,
    normal: normal ? getMapTexture(normal, THREE.NoColorSpace, uv) : null,
    orm: orm ? getMapTexture(orm, THREE.NoColorSpace, uv) : null,
    /* orm wins over a plain roughness map when both are present */
    roughness: !orm && roughness ? getMapTexture(roughness, THREE.NoColorSpace, uv) : null,
    emissive: emissive ? getMapTexture(emissive, THREE.SRGBColorSpace, uv) : null,
  };
}

/** true when a map slot flips between present and absent — three recompiles
    the shader program on that transition, so it needs needsUpdate; swapping
    to a different texture in an already-mapped slot does not. */
const flips = (had: THREE.Texture | null, next: THREE.Texture | null): boolean =>
  (had === null) !== (next === null);

/** clearcoat is the one scalar we drive that is also compile-time in three
    (USE_CLEARCOAT gates on clearcoat > 0), so crossing zero needs the same
    needsUpdate treatment as a map flip */
export const clearcoatFlips = (had: number, next: number): boolean =>
  (had > 0) !== (next > 0);

/** Patch `m` in place from `mat`. Cached materials must never be recreated —
    mesh material arrays hold references to them. */
export function applyLibMaterial(m: THREE.MeshPhysicalMaterial, mat: LibMaterial): void {
  const maps = resolveMaps(mat);
  const roughnessMap = maps.orm ?? maps.roughness;

  if (flips(m.map, maps.albedo)) m.needsUpdate = true;
  m.map = maps.albedo;
  if (flips(m.normalMap, maps.normal)) m.needsUpdate = true;
  m.normalMap = maps.normal;
  if (flips(m.roughnessMap, roughnessMap)) m.needsUpdate = true;
  m.roughnessMap = roughnessMap;
  if (flips(m.metalnessMap, maps.orm)) m.needsUpdate = true;
  m.metalnessMap = maps.orm;
  if (flips(m.emissiveMap, maps.emissive)) m.needsUpdate = true;
  m.emissiveMap = maps.emissive;
  // vertex AO is baked into vertex colors — an aoMap here would double-darken

  m.normalScale.set(mat.normalScale, mat.normalScale);
  m.color.set(mat.color);
  m.roughness = mat.roughness;
  m.metalness = mat.metalness;
  m.envMapIntensity = mat.envIntensity;
  m.emissive.set(mat.emissive);
  m.emissiveIntensity = mat.emissiveIntensity;
  if (clearcoatFlips(m.clearcoat, mat.clearcoat)) m.needsUpdate = true;
  m.clearcoat = mat.clearcoat;
  m.clearcoatRoughness = mat.clearcoatRoughness;
}
