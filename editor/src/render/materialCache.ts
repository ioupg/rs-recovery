/* Wraps MaterialStore: builds and keeps live THREE.MeshPhysicalMaterial
   instances per (slot, variant). Variants: plain, procedural atlas (plate
   mode), or a real archive texture (mesh mode) — optionally untinted for
   textures that carry their own colour (system_colors.png). Mesh material
   arrays hold references to these, so store changes must patch the existing
   instances in place — never recreate — or every mesh using them would need
   rebuilding too. */

import * as THREE from 'three';
import type { MaterialDef, MaterialSlot } from '../core/types';
import type { MaterialStore } from '../core/materials';
import type { Unsubscribe } from '../core/types';
import { getAtlasTexture } from './atlas';
import { getPartMaps } from './textureCache';

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
  private readonly cache = new Map<string, { slot: MaterialSlot; v: MaterialVariant; m: THREE.MeshPhysicalMaterial }>();
  private readonly unsubscribe: Unsubscribe;

  constructor(store: MaterialStore) {
    this.store = store;
    this.unsubscribe = store.subscribe(kind => {
      if (kind === 'materials') this.refreshAll();
    });
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
        if (maps.normalMap) {
          m.normalMap = maps.normalMap;
          m.normalScale.set(0.5, 0.5);
        }
        if (maps.roughnessMap) m.roughnessMap = maps.roughnessMap;
      } else if (v.textured) m.map = getAtlasTexture();
      this.apply(m, this.store.get(slot), v);
      e = { slot, v, m };
      this.cache.set(key, e);
    }
    return e.m;
  }

  dispose(): void {
    this.unsubscribe();
    for (const e of this.cache.values()) e.m.dispose();
    this.cache.clear();
  }

  private apply(m: THREE.MeshPhysicalMaterial, def: MaterialDef, v: MaterialVariant): void {
    if (v.untinted) m.color.set('#ffffff');
    else m.color.set(def.color);
    m.roughness = def.roughness;
    m.metalness = def.metalness;
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
