/* Loads the recovery pipeline's data (converted to JSON by the Vite plugin)
   and derives runtime tables from it. */

import type { PlateSlot } from '../core/types';
import type { SystemDef } from '../core/systems';
import { SystemsRegistry } from '../core/systems';
import type { PlateRegistry } from './plates';
import { buildPlateRegistry } from './plates';

export interface SubMesh { pos: number[]; nrm?: number[]; idx: number[]; tex?: string[]; uv?: number[] }

export interface ShapeMeshEntry {
  rid: string; tris: number; code: string;
  /** side of the open window the shell leaves on each face — informational
      only since the flush refactor: plates mount full-face, never scaled */
  window?: number;
  sub: SubMesh[];
}

export interface PlateMeshEntry {
  rid: string; tris: number;
  outline: [number, number][];
  sub: SubMesh[];
}

export interface ModuleMeshEntry { rid: string; tris: number; name?: string; sub: SubMesh[] }

/** a part identified by its resource name (CRC32 crack of 2026-07-31) */
export interface NamedMesh { rid: string; tris: number; name: string; sub: SubMesh[] }

export interface RawCube {
  o: number; x: number; y: number; z: number;
  shape: number; comp: number;
  id: number; flag: number; variant: number; counter: number;
  slots: PlateSlot[];
}
export interface RawWing { o: number; x: number; y: number; z: number; kind: number }

export interface ShipEntry {
  name: string; display: string; class: string; rank: string; nation: string;
  cubes: RawCube[];
  elements: RawWing[];
}

export interface GameData {
  ships: Record<string, ShipEntry>;
  shapeMesh: Record<string, ShapeMeshEntry>;
  plateMesh: {
    quad_all: PlateMeshEntry[];
    tri_all?: PlateMeshEntry[];
    tri?: PlateMeshEntry;
    quad?: PlateMeshEntry;
    /** the five plate types by their '=default' resource names; p2121/p222A/
        p222V are authored in the unit cell on their slanted planes */
    types?: Partial<Record<'p1111' | 'p121' | 'p2121' | 'p222A' | 'p222V', NamedMesh>>;
  };
  /** index = compartment id (name-bound); null when a cage is missing */
  moduleMesh: (ModuleMeshEntry | null)[];
  /** index = wing kind 0..4; null = no skin in the archive (w2121) */
  wingMesh: (NamedMesh | null)[];
  /** majority archive value per (cube orientation, slot index) — used to emit
      plausible slots for cubes created in the editor */
  slotDefaults: PlateSlot[][];
  /** archive systems 0..9 + any registered from data/systems.json */
  systems: SystemsRegistry;
  /** every mountable plate mesh, seeded from plateMesh */
  plates: PlateRegistry;
  /** cage lookup by resource name — how registered systems (id ≥ 10) find
      their cage mesh */
  moduleByName?: Record<string, ModuleMeshEntry>;
}

/** every archive texture the meshes reference (plus the procedural wing
    film) — the key space of the mesh-mode material assignments */
export function collectTextureNames(data: GameData): string[] {
  const names = new Set<string>(['wing_solar']);
  const walk = (subs?: { tex?: string[] }[]): void => {
    for (const s of subs ?? []) for (const t of s.tex ?? []) names.add(t);
  };
  for (const v of Object.values(data.shapeMesh)) walk(v.sub);
  for (const d of data.plates.all()) walk(d.mesh.sub);
  for (const m of data.moduleMesh) walk(m?.sub);
  for (const w of data.wingMesh) walk(w?.sub);
  return [...names].sort();
}

async function json<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`failed to load ${name}: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Default plate slots for editor-created cubes: BARE — decoration is applied
    per face with the plate tool, never draped over the whole ship. (The ships
    parameter stays for signature stability; nothing is derived from it.) */
export function computeSlotDefaults(_ships: Record<string, ShipEntry>): PlateSlot[][] {
  return Array.from({ length: 24 }, () =>
    Array.from({ length: 7 }, () => ({ o: 0, p: 0, f: 0 })));
}

/** optional user extension file — absent in a stock checkout */
async function loadExtraSystems(): Promise<SystemDef[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/systems.json`);
    if (!res.ok) return [];
    return await res.json() as SystemDef[];
  } catch {
    return [];
  }
}

export async function loadGameData(): Promise<GameData> {
  const [ships, shapeMesh, plateMesh, moduleMesh, wingMesh, extraSystems] = await Promise.all([
    json<Record<string, ShipEntry>>('ships.json'),
    json<Record<string, ShapeMeshEntry>>('shape-mesh.json'),
    json<GameData['plateMesh']>('plate-mesh.json'),
    json<(ModuleMeshEntry | null)[]>('module-mesh.json'),
    json<(NamedMesh | null)[]>('wing-mesh.json'),
    loadExtraSystems(),
  ]);
  const moduleByName: Record<string, ModuleMeshEntry> = {};
  for (const m of moduleMesh)
    if (m?.name) moduleByName[m.name] = m;
  return {
    ships, shapeMesh, plateMesh, moduleMesh, wingMesh,
    slotDefaults: computeSlotDefaults(ships),
    systems: new SystemsRegistry(extraSystems),
    plates: buildPlateRegistry(plateMesh),
    moduleByName,
  };
}
