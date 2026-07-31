/* Wraps MaterialStore: builds and keeps live THREE.MeshPhysicalMaterial
   instances per (slot, variant). Variants: plain, procedural atlas (plate
   mode), or a real archive texture (mesh mode) — optionally untinted for
   textures that carry their own colour (system_colors.png). Mesh material
   arrays hold references to these, so store changes must patch the existing
   instances in place — never recreate — or every mesh using them would need
   rebuilding too. */

import * as THREE from 'three';
import type { MaterialDef, MaterialSlot } from '../core/types';
import type { MaterialStore, SurfaceStore } from '../core/materials';
import type { Unsubscribe } from '../core/types';
import { getAtlasTexture } from './atlas';
import { getPartMaps } from './textureCache';

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export interface MaterialVariant {
  /** procedural compartment atlas as .map (plate mode) */
  textured: boolean;
  /** real archive texture name (mesh mode with textures on) */
  map?: string | null;
  /** render the map at full colour, ignoring the slot tint */
  untinted?: boolean;
}

export class MaterialCache {
  private readonly store: MaterialStore;
  private readonly surfaces: SurfaceStore | null;
  private readonly cache = new Map<string, { slot: MaterialSlot; v: MaterialVariant; m: THREE.MeshPhysicalMaterial }>();
  private readonly unsubscribes: Unsubscribe[] = [];

  constructor(store: MaterialStore, surfaces?: SurfaceStore) {
    this.store = store;
    this.surfaces = surfaces ?? null;
    this.unsubscribes.push(store.subscribe(kind => {
      if (kind === 'materials') this.refreshAll();
    }));
    if (surfaces)
      this.unsubscribes.push(surfaces.subscribe(() => this.refreshAll()));
  }

  get(slot: MaterialSlot, v: MaterialVariant): THREE.MeshPhysicalMaterial {
    const key = `${slot}|${v.textured ? 'a' : ''}|${v.map ?? ''}|${v.untinted ? 'w' : ''}`;
    let e = this.cache.get(key);
    if (!e) {
      const m = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        flatShading: false,
      });
      if (v.map) {
        const maps = getPartMaps(v.map);
        m.map = maps.map;
        if (maps.normalMap) m.normalMap = maps.normalMap;
        if (maps.roughnessMap) m.roughnessMap = maps.roughnessMap;
      } else if (v.textured) m.map = getAtlasTexture();
      this.apply(m, this.store.get(slot), v);
      e = { slot, v, m };
      this.cache.set(key, e);
    }
    return e.m;
  }

  dispose(): void {
    for (const u of this.unsubscribes) u();
    for (const e of this.cache.values()) e.m.dispose();
    this.cache.clear();
  }

  private apply(m: THREE.MeshPhysicalMaterial, def: MaterialDef, v: MaterialVariant): void {
    /* per-texture surface response rides on top of the slot material */
    const surf = v.map && this.surfaces ? this.surfaces.get(v.map) : null;
    const untinted = v.untinted || (surf ? !surf.tint : false);
    if (untinted) m.color.set('#ffffff');
    else m.color.set(def.color);
    m.roughness = clamp01(def.roughness * (surf?.roughnessK ?? 1));
    m.metalness = clamp01(def.metalness * (surf?.metalnessK ?? 1));
    m.envMapIntensity = surf?.envIntensity ?? 1;
    if (m.normalMap) m.normalScale.set(surf?.normalScale ?? 0.5, surf?.normalScale ?? 0.5);
    m.emissive.set(def.emissive);
    m.emissiveIntensity = def.emissiveIntensity;
    m.clearcoat = def.clearcoat;
    m.clearcoatRoughness = def.clearcoatRoughness;
  }

  private refreshAll(): void {
    for (const e of this.cache.values()) {
      this.apply(e.m, this.store.get(e.slot), e.v);
      // atlas may have finished building after this entry was first created
      if (!e.v.map && e.v.textured && !e.m.map) e.m.map = getAtlasTexture();
      e.m.needsUpdate = true;
    }
  }
}
