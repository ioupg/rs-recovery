/* App-level PBR material library. Core-side and three.js-free: entries are
   plain LibMaterial defs; render/libMaterial.ts turns them into THREE
   materials. The registry is seeded from the recovered archive textures
   (legacy wraps) plus the curated materials/materials.json, with the user's
   browser-local tweaks applied as an overlay on top (persisted by main.ts,
   committed back into materials.json via exportJson when they should ship). */

import type { ChangeKind, LibMaterial, LibMaterialMaps, Unsubscribe } from './types';

/** every scalar default; legacy wraps and json entries both normalize over this */
export const LIB_DEFAULTS: Omit<LibMaterial, 'id' | 'name' | 'maps'> = {
  color: '#ffffff',
  roughness: 0.72,
  metalness: 0.18,
  normalScale: 0.5,
  envIntensity: 1,
  emissive: '#000000',
  emissiveIntensity: 0,
  clearcoat: 0,
  clearcoatRoughness: 0.3,
  uvScale: 1,
  uvRotation: 0,
};

/** materials.json format version, stamped by exportJson and checked on load;
    bump only on breaking shape changes — loaders tolerate same-or-older */
export const MATERIALS_JSON_VERSION = 1;

export type LibMaterialSpec = Partial<LibMaterial> & { id: string };

/** fill a sparse def (materials.json entry) up to a complete LibMaterial */
export function normalizeMaterial(spec: LibMaterialSpec): LibMaterial {
  const { maps, ...rest } = spec;
  return { ...LIB_DEFAULTS, name: spec.id, ...rest, maps: { ...(maps ?? {}) } };
}

/** which enhanced PBR layers exist per archive texture (textures/manifest.json) */
export type PbrFlags = Record<string, { d?: boolean; n?: boolean; r?: boolean }>;

/** wrap the recovered archive textures as library entries: id = the archive
    reference name, maps point at the decoded/enhanced files the vite plugin
    copies into public/textures/ */
export function legacyMaterials(names: readonly string[], pbr: PbrFlags = {}): LibMaterial[] {
  return [...names].sort().map(name => {
    const maps: LibMaterialMaps = { albedo: `textures/${name}.png` };
    if (pbr[name]?.n) maps.normal = `textures/${name}_n.png`;
    if (pbr[name]?.r) maps.roughness = `textures/${name}_r.png`;
    return normalizeMaterial({
      id: name,
      name: name.replace(/\.(bmp|png|jpg)$/i, ''),
      legacy: true,
      maps,
    });
  });
}

/** legacy wraps + shipped json defs, merged by id (json wins field-wise so
    materials.json can also re-tune a legacy entry) */
export function buildLibraryDefaults(
  legacy: readonly LibMaterial[], shipped: readonly LibMaterialSpec[],
): LibMaterial[] {
  const out = new Map<string, LibMaterial>(legacy.map(m => [m.id, m]));
  for (const spec of shipped) {
    const base = out.get(spec.id);
    out.set(spec.id, base
      ? { ...base, ...spec, maps: { ...base.maps, ...(spec.maps ?? {}) } }
      : normalizeMaterial(spec));
  }
  return [...out.values()];
}

const clone = (m: LibMaterial): LibMaterial => ({ ...m, maps: { ...m.maps } });

/** field-wise inequality, maps compared by content (same idiom as diff()) */
const differs = (a: LibMaterial, b: LibMaterial): boolean => {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof LibMaterial>)
    if (k !== 'maps' && a[k] !== b[k]) return true;
  return JSON.stringify(a.maps) !== JSON.stringify(b.maps);
};

export type LibraryOverlay = Record<string, Partial<LibMaterial>>;

/** Mutable registry with change events. Tweaks are app-level (they edit the
    library, not the ship); diff() vs the shipped defaults is what the browser
    persists locally and what exportJson turns into a materials.json. */
export class MaterialLibrary {
  private readonly defaults = new Map<string, LibMaterial>();
  private readonly set = new Map<string, LibMaterial>();
  /** the PURE generated legacy wraps, before materials.json re-tuned any of
      them — the baseline exportJson keeps legacy entries against. Diffing
      against `defaults` instead would drop a committed tuning on the next
      export cycle: once it ships in materials.json it becomes the default,
      stops diffing, and gets filtered as "untouched". */
  private readonly legacyBaselines = new Map<string, LibMaterial>();
  private listeners = new Set<(kind: ChangeKind) => void>();

  constructor(defaults: readonly LibMaterial[], legacyBaselines: readonly LibMaterial[] = []) {
    for (const m of defaults) {
      this.defaults.set(m.id, clone(m));
      this.set.set(m.id, clone(m));
    }
    for (const m of legacyBaselines) this.legacyBaselines.set(m.id, clone(m));
  }

  /** registry order: legacy wraps first (seed order), curated entries after */
  all(): LibMaterial[] { return [...this.set.values()]; }

  byId(id: string): LibMaterial | undefined { return this.set.get(id); }

  patch(id: string, patch: Partial<Omit<LibMaterial, 'id'>>): void {
    const cur = this.set.get(id);
    if (!cur) return;
    this.set.set(id, { ...cur, ...patch, maps: { ...cur.maps, ...(patch.maps ?? {}) }, id });
    this.emit();
  }

  reset(id: string): void {
    const def = this.defaults.get(id);
    if (!def) return;
    this.set.set(id, clone(def));
    this.emit();
  }

  /** per-id field patches differing from the shipped defaults */
  diff(): LibraryOverlay | undefined {
    const out: LibraryOverlay = {};
    let any = false;
    for (const [id, cur] of this.set) {
      const def = this.defaults.get(id);
      if (!def) continue;
      const d: Partial<LibMaterial> = {};
      for (const k of Object.keys(cur) as (keyof LibMaterial)[]) {
        if (k === 'maps') continue;
        if (cur[k] !== def[k]) (d as Record<string, unknown>)[k] = cur[k];
      }
      if (JSON.stringify(cur.maps) !== JSON.stringify(def.maps)) d.maps = { ...cur.maps };
      if (Object.keys(d).length) { out[id] = d; any = true; }
    }
    return any ? out : undefined;
  }

  /** browser-local tweaks, applied over the shipped defaults at startup */
  applyOverlay(overlay?: LibraryOverlay): void {
    if (!overlay) return;
    for (const [id, patch] of Object.entries(overlay)) {
      const cur = this.set.get(id);
      if (cur) this.set.set(id, { ...cur, ...patch, maps: { ...cur.maps, ...(patch.maps ?? {}) }, id });
    }
    this.emit();
  }

  /** the current library as a committable materials.json. Legacy wraps that
      match their pure generated form are omitted (they regenerate); anything
      tuned away from it — whether tweaked this session or committed in a
      previous materials.json — is included so the tuning keeps shipping. */
  exportJson(): string {
    const mats = this.all()
      .filter(m => {
        if (!m.legacy) return true;
        const base = this.legacyBaselines.get(m.id) ?? this.defaults.get(m.id);
        return !base || differs(m, base);
      })
      .map(m => ({ ...m, maps: { ...m.maps } }));
    return JSON.stringify({ version: MATERIALS_JSON_VERSION, materials: mats }, null, 2);
  }

  subscribe(fn: (kind: ChangeKind) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void { for (const fn of this.listeners) fn('materials'); }
}
