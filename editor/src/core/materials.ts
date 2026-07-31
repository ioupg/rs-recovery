/* PBR material registry. Core-side only — THREE.Material instances are built
   and cached in render/materialCache.ts from these defs. Slots are derived
   from the systems registry (`comp<id>`) plus 'wing'. */

import type { ChangeKind, MaterialDef, MaterialSet, MaterialSlot, Unsubscribe } from './types';
import { WING_SLOT } from './types';
import type { SystemDef } from './systems';
import { ARCHIVE_SYSTEMS } from './systems';

const BASE: Omit<MaterialDef, 'color'> = {
  roughness: 0.72,
  metalness: 0.18,
  emissive: '#000000',
  emissiveIntensity: 0,
  clearcoat: 0,
  clearcoatRoughness: 0.3,
};

const WING_DEF: MaterialDef = { color: '#51636F', ...BASE, roughness: 0.85, metalness: 0.1 };

export const compSlot = (comp: number): MaterialSlot => `comp${comp}`;

/** default material set for a system roster: one comp slot per def + wing */
export function buildDefaultMaterials(systems: readonly SystemDef[]): MaterialSet {
  const out: MaterialSet = {};
  for (const s of systems)
    out[compSlot(s.id)] = { color: s.color, ...BASE, ...s.material };
  out[WING_SLOT] = { ...WING_DEF };
  return out;
}

/** the archive roster's defaults — the compat set tests and seeds use */
export const DEFAULT_MATERIALS: MaterialSet = buildDefaultMaterials(ARCHIVE_SYSTEMS);

/** the archive slot list, in group order (comp0..comp9, wing) */
export const ARCHIVE_SLOTS: readonly MaterialSlot[] = Object.keys(DEFAULT_MATERIALS);

const clone = (s: MaterialSet): MaterialSet =>
  Object.fromEntries(Object.keys(s).map(k => [k, { ...s[k] }]));

/** Mutable registry with change events; diff vs defaults is what gets exported. */
export class MaterialStore {
  private defaults: MaterialSet;
  private set: MaterialSet;
  private listeners = new Set<(kind: ChangeKind) => void>();

  constructor(defaults: MaterialSet = DEFAULT_MATERIALS) {
    this.defaults = clone(defaults);
    this.set = clone(defaults);
  }

  /** slot keys in registry order */
  slots(): MaterialSlot[] { return Object.keys(this.set); }

  /** slots no registered system backs render as hull */
  get(slot: MaterialSlot): MaterialDef { return this.set[slot] ?? this.set[compSlot(8)]; }
  all(): MaterialSet { return this.set; }

  patch(slot: MaterialSlot, patch: Partial<MaterialDef>): void {
    this.set[slot] = { ...this.set[slot], ...patch };
    this.emit();
  }

  resetSlot(slot: MaterialSlot): void {
    this.set[slot] = { ...this.defaults[slot] };
    this.emit();
  }

  /** swap the default set (systems registered at runtime); keeps overrides */
  setDefaults(defaults: MaterialSet): void {
    const diff = this.diff();
    this.defaults = clone(defaults);
    this.set = clone(defaults);
    if (diff)
      for (const k of Object.keys(diff))
        if (this.set[k]) this.set[k] = { ...this.set[k], ...diff[k] };
    this.emit();
  }

  /** replace everything (doc load): defaults + overrides; unknown slots kept
      verbatim so a doc from a bigger registry round-trips */
  load(overrides?: Partial<MaterialSet>): void {
    this.set = clone(this.defaults);
    if (overrides)
      for (const k of Object.keys(overrides)) {
        const o = overrides[k];
        if (o) this.set[k] = { ...(this.set[k] ?? { ...WING_DEF }), ...o };
      }
    this.emit();
  }

  /** slots that differ from the defaults — embedded in exported ship JSON */
  diff(): Partial<MaterialSet> | undefined {
    const out: Partial<MaterialSet> = {};
    let any = false;
    for (const k of Object.keys(this.set)) {
      const a = this.set[k], b = this.defaults[k];
      if (!b || JSON.stringify(a) !== JSON.stringify(b)) { out[k] = { ...a }; any = true; }
    }
    return any ? out : undefined;
  }

  subscribe(fn: (kind: ChangeKind) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void { for (const fn of this.listeners) fn('materials'); }
}
