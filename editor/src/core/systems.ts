/* Systems (compartment) registry. Ids 0..9 are the archive systems recovered
   from the exe — frozen, byte-exact through the binary format. New systems
   register with id ≥ 10 and exist in JSON exports only. */

import type { MaterialDef, Unsubscribe } from './types';

export interface SystemDef {
  /** the numeric value stored in Cube.comp */
  id: number;
  /** stable ascii key for data files and material slots */
  key: string;
  /** English display name (UI chrome) */
  name: string;
  /** the exe's own name — data, kept verbatim for the info stamp/tooltips */
  nameRu?: string;
  /** default material color '#rrggbb' */
  color: string;
  /** default PBR response on top of the base material */
  material?: Partial<Omit<MaterialDef, 'color'>>;
  /** module cage mesh name (resource-name form), when one exists */
  cage?: string;
  /** true for ids 0..9 — representable in the 2014 binary format */
  archive: boolean;
}

/** The ten archive systems. Cage binding is the CRC32 name crack of
    2026-07-31 (m1*power=comp0 … m1*cargo=comp9); colors are the recovered
    compartment palette; PBR tweaks are the constructor's tuned defaults. */
export const ARCHIVE_SYSTEMS: readonly SystemDef[] = [
  { id: 0, key: 'power', name: 'Power', nameRu: 'энергия', color: '#E8C34A',
    material: { metalness: 0.35, roughness: 0.55 }, cage: 'm1*power', archive: true },
  { id: 1, key: 'command', name: 'Command', nameRu: 'ЦП', color: '#8B7BD8',
    cage: 'm1*command', archive: true },
  { id: 2, key: 'habitable', name: 'Habitat', nameRu: 'обитаемый', color: '#6BA368',
    material: { roughness: 0.8, metalness: 0.08 }, cage: 'm1*habitable', archive: true },
  { id: 3, key: 'gyroscope', name: 'Gyroscope', nameRu: 'гироскоп', color: '#3FA7A3',
    material: { metalness: 0.4, roughness: 0.5 }, cage: 'm1*gyroscope', archive: true },
  { id: 4, key: 'tank', name: 'Tanks', nameRu: 'баки', color: '#4A90D9',
    material: { metalness: 0.45, roughness: 0.45 }, cage: 'm1*tank', archive: true },
  { id: 5, key: 'weapon', name: 'Weapons', nameRu: 'орудия', color: '#D64545',
    material: { roughness: 0.65 }, cage: 'm1*weapon', archive: true },
  { id: 6, key: 'engine', name: 'Engines', nameRu: 'двигатели', color: '#D65A31',
    material: { emissive: '#FF5A18', emissiveIntensity: 0.25 }, cage: 'm1*engine', archive: true },
  { id: 7, key: 'hangar', name: 'Hangar', nameRu: 'ангар', color: '#C77B9E',
    cage: 'm1*hangar', archive: true },
  { id: 8, key: 'hull', name: 'Hull', nameRu: 'корпус', color: '#46586B',
    material: { roughness: 0.78, metalness: 0.22 }, cage: 'm1*slot', archive: true },
  { id: 9, key: 'bridge', name: 'Bridge', nameRu: 'мостик', color: '#E5E9ED',
    material: { roughness: 0.35, metalness: 0.3, clearcoat: 0.4 }, cage: 'm1*cargo', archive: true },
];

export class SystemsRegistry {
  private defs: SystemDef[];
  private index = new Map<number, SystemDef>();
  private listeners = new Set<() => void>();

  constructor(extra: readonly SystemDef[] = []) {
    this.defs = [...ARCHIVE_SYSTEMS];
    for (const d of this.defs) this.index.set(d.id, d);
    for (const d of extra) this.register(d);
  }

  all(): readonly SystemDef[] { return this.defs; }
  byId(id: number): SystemDef | undefined { return this.index.get(id); }
  has(id: number): boolean { return this.index.has(id); }

  /** ids ≥ 10 only — the archive block is frozen */
  register(def: SystemDef): void {
    if (def.id < 10 || !Number.isInteger(def.id))
      throw new Error(`system id ${def.id} is reserved for the archive (0..9)`);
    if (this.index.has(def.id))
      throw new Error(`system id ${def.id} already registered`);
    if (this.defs.some(d => d.key === def.key))
      throw new Error(`system key '${def.key}' already registered`);
    const d = { ...def, archive: false };
    this.defs.push(d);
    this.index.set(d.id, d);
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
