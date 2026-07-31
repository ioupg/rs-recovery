/* PBR material registry. Core-side only — THREE.Material instances are built
   and cached in render/materialCache.ts from these defs. */

import type { ChangeKind, MaterialDef, MaterialSet, MaterialSlot, Unsubscribe } from './types';
import { MATERIAL_SLOTS } from './types';

const def = (color: string, over: Partial<MaterialDef> = {}): MaterialDef => ({
  color,
  roughness: 0.72,
  metalness: 0.18,
  emissive: '#000000',
  emissiveIntensity: 0,
  clearcoat: 0,
  clearcoatRoughness: 0.3,
  ...over,
});

/** Default set — colors are the recovered compartment palette of the viewer;
    responses tuned so metalness reads against the environment map. */
export const DEFAULT_MATERIALS: MaterialSet = {
  comp0: def('#E8C34A', { metalness: 0.35, roughness: 0.55 }),           // энергия
  comp1: def('#8B7BD8'),                                                 // ЦП
  comp2: def('#6BA368', { roughness: 0.8, metalness: 0.08 }),            // обитаемый
  comp3: def('#3FA7A3', { metalness: 0.4, roughness: 0.5 }),             // гироскоп
  comp4: def('#4A90D9', { metalness: 0.45, roughness: 0.45 }),           // баки
  comp5: def('#D64545', { roughness: 0.65 }),                            // орудия
  comp6: def('#D65A31', { emissive: '#FF5A18', emissiveIntensity: 0.25 }), // двигатели
  comp7: def('#C77B9E'),                                                 // ангар
  comp8: def('#46586B', { roughness: 0.78, metalness: 0.22 }),           // корпус
  comp9: def('#E5E9ED', { roughness: 0.35, metalness: 0.3, clearcoat: 0.4 }), // мостик
  wing:  def('#51636F', { roughness: 0.85, metalness: 0.1 }),
};

export const MATERIAL_SLOT_NAMES: Record<MaterialSlot, string> = {
  comp0: 'энергия', comp1: 'ЦП', comp2: 'обитаемый', comp3: 'гироскоп',
  comp4: 'баки', comp5: 'орудия', comp6: 'двигатели', comp7: 'ангар',
  comp8: 'корпус', comp9: 'мостик', wing: 'крыло',
};

export const compSlot = (comp: number): MaterialSlot => `comp${comp}` as MaterialSlot;

const clone = (s: MaterialSet): MaterialSet =>
  Object.fromEntries(MATERIAL_SLOTS.map(k => [k, { ...s[k] }])) as MaterialSet;

/** Mutable registry with change events; diff vs defaults is what gets exported. */
export class MaterialStore {
  private set: MaterialSet = clone(DEFAULT_MATERIALS);
  private listeners = new Set<(kind: ChangeKind) => void>();

  get(slot: MaterialSlot): MaterialDef { return this.set[slot]; }
  all(): MaterialSet { return this.set; }

  patch(slot: MaterialSlot, patch: Partial<MaterialDef>): void {
    this.set[slot] = { ...this.set[slot], ...patch };
    this.emit();
  }

  resetSlot(slot: MaterialSlot): void {
    this.set[slot] = { ...DEFAULT_MATERIALS[slot] };
    this.emit();
  }

  /** replace everything (doc load): defaults + overrides */
  load(overrides?: Partial<MaterialSet>): void {
    this.set = clone(DEFAULT_MATERIALS);
    if (overrides)
      for (const k of MATERIAL_SLOTS)
        if (overrides[k]) this.set[k] = { ...this.set[k], ...overrides[k] };
    this.emit();
  }

  /** slots that differ from the defaults — embedded in exported ship JSON */
  diff(): Partial<MaterialSet> | undefined {
    const out: Partial<MaterialSet> = {};
    let any = false;
    for (const k of MATERIAL_SLOTS) {
      const a = this.set[k], b = DEFAULT_MATERIALS[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) { out[k] = { ...a }; any = true; }
    }
    return any ? out : undefined;
  }

  subscribe(fn: (kind: ChangeKind) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void { for (const fn of this.listeners) fn('materials'); }
}
