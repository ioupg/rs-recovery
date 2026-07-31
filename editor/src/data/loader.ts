/* Loads the recovery pipeline's data (converted to JSON by the Vite plugin)
   and derives runtime tables from it. */

import type { PlateSlot } from '../core/types';

export interface SubMesh { pos: number[]; nrm?: number[]; idx: number[]; tex?: string[]; uv?: number[] }

export interface ShapeMeshEntry {
  rid: string; tris: number; code: string;
  /** side of the open window the shell leaves on each face (plate scale) */
  window?: number;
  sub: SubMesh[];
}

export interface PlateMeshEntry {
  rid: string; tris: number;
  outline: [number, number][];
  sub: SubMesh[];
}

export interface ModuleMeshEntry { rid: string; tris: number; sub: SubMesh[] }

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
  };
  moduleMesh: ModuleMeshEntry[];
  /** majority archive value per (cube orientation, slot index) — used to emit
      plausible slots for cubes created in the editor */
  slotDefaults: PlateSlot[][];
}

async function json<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
  if (!res.ok) throw new Error(`failed to load ${name}: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Default plate slots for editor-created cubes: plate orientation by fleet
    majority per (cube orientation, slot index); plates PRESENT everywhere —
    presence is decoration state, and a fresh cube ships fully plated. */
export function computeSlotDefaults(ships: Record<string, ShipEntry>): PlateSlot[][] {
  const votes = new Map<string, Map<number, number>>();
  for (const ship of Object.values(ships))
    for (const c of ship.cubes)
      c.slots.forEach((s, i) => {
        const k = `${c.o},${i}`;
        const m = votes.get(k) ?? votes.set(k, new Map()).get(k)!;
        m.set(s.o, (m.get(s.o) ?? 0) + 1);
      });
  const out: PlateSlot[][] = [];
  for (let o = 0; o < 24; o++) {
    out[o] = [];
    for (let i = 0; i < 7; i++) {
      const m = votes.get(`${o},${i}`);
      const best = m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : 0;
      out[o][i] = { o: best, p: 1, f: 0 };
    }
  }
  return out;
}

export async function loadGameData(): Promise<GameData> {
  const [ships, shapeMesh, plateMesh, moduleMesh] = await Promise.all([
    json<Record<string, ShipEntry>>('ships.json'),
    json<Record<string, ShapeMeshEntry>>('shape-mesh.json'),
    json<GameData['plateMesh']>('plate-mesh.json'),
    json<ModuleMeshEntry[]>('module-mesh.json'),
  ]);
  return { ships, shapeMesh, plateMesh, moduleMesh, slotDefaults: computeSlotDefaults(ships) };
}
