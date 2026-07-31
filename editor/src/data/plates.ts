/* Plate-mesh registry: every mountable decoration mesh behind one interface,
   seeded from the archive data and open to registered additions (decoded
   archive meshes now, imported GLB later). The picker UI and the geometry
   builder resolve plates through this registry only. */

import type { GameData, PlateMeshEntry, NamedMesh } from './loader';

/** which hull face geometry a plate is authored for */
export type PlateFaceType = 'quad' | 'tri' | 'slope' | 'diag' | 'cut';

export interface PlateDef {
  /** stable key, e.g. 'p1111/1550655785' or a custom name */
  id: string;
  /** display name for the picker */
  name: string;
  faceType: PlateFaceType;
  source: 'archive' | 'custom';
  rid?: string;
  tris: number;
  mesh: PlateMeshEntry | NamedMesh;
}

export class PlateRegistry {
  private defs: PlateDef[] = [];
  private index = new Map<string, PlateDef>();

  register(def: PlateDef): void {
    if (this.index.has(def.id)) throw new Error(`plate '${def.id}' already registered`);
    this.defs.push(def);
    this.index.set(def.id, def);
  }

  get(id: string): PlateDef | undefined { return this.index.get(id); }
  all(): readonly PlateDef[] { return this.defs; }
  byFaceType(t: PlateFaceType): PlateDef[] { return this.defs.filter(d => d.faceType === t); }

  /** the default plate for a face type — first registered entry */
  defaultFor(t: PlateFaceType): PlateDef | undefined { return this.defs.find(d => d.faceType === t); }
}

/** Seed from the archive data. Order matters: defaultFor() returns the first
    entry per face type — the simplest flat panel leads the quads (the user's
    preferred default), the archive '=default' meshes lead the other types. */
export function buildPlateRegistry(plateMesh: GameData['plateMesh']): PlateRegistry {
  const reg = new PlateRegistry();
  const quads = plateMesh.quad_all ?? [];

  /* quad variants: index 1 is the 12-tri flat panel — registered first */
  const label = (p: PlateMeshEntry, i: number): string =>
    i === 0 ? 'hazard (=default)' : i === 1 ? 'flat panel' : `greeble ${p.tris} tris`;
  const order = quads.length > 1 ? [1, ...quads.map((_, i) => i).filter(i => i !== 1)] : quads.map((_, i) => i);
  for (const i of order) {
    const p = quads[i];
    reg.register({
      id: `p1111/${p.rid}`, name: label(p, i), faceType: 'quad',
      source: 'archive', rid: p.rid, tris: p.tris, mesh: p,
    });
  }

  for (const p of plateMesh.tri_all ?? [])
    reg.register({
      id: `p121/${p.rid}`, name: `tri ${p.tris} tris`, faceType: 'tri',
      source: 'archive', rid: p.rid, tris: p.tris, mesh: p,
    });

  const named: readonly [PlateFaceType, keyof NonNullable<GameData['plateMesh']['types']>][] = [
    ['slope', 'p2121'], ['diag', 'p222A'], ['cut', 'p222V'],
  ];
  for (const [face, key] of named) {
    const m = plateMesh.types?.[key];
    if (m) reg.register({
      id: `${key}/${m.rid}`, name: `${key} (=default)`, faceType: face,
      source: 'archive', rid: m.rid, tris: m.tris, mesh: m,
    });
  }
  return reg;
}
