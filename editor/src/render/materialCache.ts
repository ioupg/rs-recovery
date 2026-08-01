/* Wraps MaterialStore + MaterialLibrary + AssignmentStore: builds and keeps
   live THREE.MeshPhysicalMaterial instances per (slot, variant). Variants:
   plain slot color, procedural atlas (plate mode), or a real archive texture
   name resolved through the library (mesh mode — fully library-driven, no
   slot tint). Mesh material arrays hold references to these, so store/
   library/assignment changes must patch the existing instances in place —
   never recreate — or every mesh using them would need rebuilding too. */

import * as THREE from 'three';
import type { MaterialSlot, Unsubscribe } from '../core/types';
import type { AssignmentStore, MaterialStore } from '../core/materials';
import type { MaterialLibrary } from '../core/library';
import { getAtlasTexture } from './atlas';
import { applyLibMaterial } from './libMaterial';

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export interface MaterialVariant {
  /** procedural compartment atlas as .map (plate mode) */
  textured: boolean;
  /** archive texture name — looked up through AssignmentStore → MaterialLibrary
      (mesh mode). null/undefined renders the plain slot def instead. */
  map?: string | null;
  /** backface-culled — mesh mode's flush composition relies on coincident
      opposite-facing surfaces resolving by winding, the engine's own scheme.
      Facet modes keep DoubleSide (fan winding is not settled outward), as
      does the wing slot (w2121 has no skin and stays a zero-thickness
      polygon). */
  frontSide?: boolean;
}

export class MaterialCache {
  private readonly cache = new Map<string, { slot: MaterialSlot; v: MaterialVariant; m: THREE.MeshPhysicalMaterial }>();
  private readonly unsubscribes: Unsubscribe[] = [];

  constructor(
    private readonly store: MaterialStore,
    private readonly library: MaterialLibrary,
    private readonly assignments: AssignmentStore,
  ) {
    this.unsubscribes.push(store.subscribe(() => this.refreshAll()));
    this.unsubscribes.push(library.subscribe(() => this.refreshAll()));
    this.unsubscribes.push(assignments.subscribe(() => this.refreshAll()));
  }

  get(slot: MaterialSlot, v: MaterialVariant): THREE.MeshPhysicalMaterial {
    const key = `${slot}|${v.textured ? 'a' : ''}|${v.map ?? ''}|${v.frontSide ? 'f' : ''}`;
    let e = this.cache.get(key);
    if (!e) {
      const m = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        side: v.frontSide ? THREE.FrontSide : THREE.DoubleSide,
        flatShading: false,
      });
      if (!v.map && v.textured) m.map = getAtlasTexture();
      this.apply(m, slot, v);
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

  private apply(m: THREE.MeshPhysicalMaterial, slot: MaterialSlot, v: MaterialVariant): void {
    if (v.map) {
      const id = this.assignments.get(v.map);
      const resolved = this.library.byId(id) ?? this.library.byId(v.map);
      if (resolved) {
        applyLibMaterial(m, resolved);
        return;
      }
      /* defensive: the assignment points at a dropped id and even the
         texture's own legacy wrap is missing — should not happen (every
         archive texture gets a legacy wrap at startup) but fall through to
         the plain slot def below rather than crash */
    }
    const def = this.store.get(slot);
    m.color.set(def.color);
    m.roughness = clamp01(def.roughness);
    m.metalness = clamp01(def.metalness);
    m.envMapIntensity = 1;
    m.emissive.set(def.emissive);
    m.emissiveIntensity = def.emissiveIntensity;
    m.clearcoat = def.clearcoat;
    m.clearcoatRoughness = def.clearcoatRoughness;
  }

  private refreshAll(): void {
    for (const e of this.cache.values()) {
      this.apply(e.m, e.slot, e.v);
      // atlas may have finished building after this entry was first created
      if (!e.v.map && e.v.textured && !e.m.map) e.m.map = getAtlasTexture();
      e.m.needsUpdate = true;
    }
  }
}
