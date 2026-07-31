/* Wraps MaterialStore: builds and keeps live THREE.MeshPhysicalMaterial
   instances per (slot, textured) pair. Mesh material arrays hold references
   to these, so store changes must patch the existing instances in place —
   never recreate — or every mesh using them would need rebuilding too. */

import * as THREE from 'three';
import type { MaterialDef, MaterialSlot } from '../core/types';
import type { MaterialStore } from '../core/materials';
import type { Unsubscribe } from '../core/types';
import { getAtlasTexture } from './atlas';

interface Entry {
  plain: THREE.MeshPhysicalMaterial;
  textured: THREE.MeshPhysicalMaterial;
}

export class MaterialCache {
  private readonly store: MaterialStore;
  private readonly cache = new Map<MaterialSlot, Entry>();
  private readonly unsubscribe: Unsubscribe;

  constructor(store: MaterialStore) {
    this.store = store;
    this.unsubscribe = store.subscribe(kind => {
      if (kind === 'materials') this.refreshAll();
    });
  }

  get(slot: MaterialSlot, o: { textured: boolean }): THREE.MeshPhysicalMaterial {
    return this.entryFor(slot)[o.textured ? 'textured' : 'plain'];
  }

  dispose(): void {
    this.unsubscribe();
    for (const entry of this.cache.values()) {
      entry.plain.dispose();
      entry.textured.dispose();
    }
    this.cache.clear();
  }

  private entryFor(slot: MaterialSlot): Entry {
    let entry = this.cache.get(slot);
    if (!entry) {
      const plain = this.build();
      const textured = this.build();
      textured.map = getAtlasTexture();
      this.apply(plain, this.store.get(slot));
      this.apply(textured, this.store.get(slot));
      entry = { plain, textured };
      this.cache.set(slot, entry);
    }
    return entry;
  }

  private build(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: false,
    });
  }

  private apply(m: THREE.MeshPhysicalMaterial, def: MaterialDef): void {
    m.color.set(def.color);
    m.roughness = def.roughness;
    m.metalness = def.metalness;
    m.emissive.set(def.emissive);
    m.emissiveIntensity = def.emissiveIntensity;
    m.clearcoat = def.clearcoat;
    m.clearcoatRoughness = def.clearcoatRoughness;
  }

  private refreshAll(): void {
    for (const [slot, entry] of this.cache) {
      const def = this.store.get(slot);
      this.apply(entry.plain, def);
      this.apply(entry.textured, def);
      // atlas may have finished building after this entry was first created
      if (!entry.textured.map) entry.textured.map = getAtlasTexture();
      entry.plain.needsUpdate = true;
      entry.textured.needsUpdate = true;
    }
  }
}
