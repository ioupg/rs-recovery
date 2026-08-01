/* Import/export between the archive/recovery JSON shapes and ShipDoc.
   Type-only imports from data/loader keep this module free of the fetch-based
   loadGameData() side effects, so it stays safe to import under vitest/node. */

import type { Cube, ExtraElement, MaterialSet, PlateSlot, ShipDoc, ShipMeta, Wing } from './types';
import type { RawCube, RawWing, ShipEntry } from '../data/loader';

/** cube shape as it appears in parsed archive/recovery JSON — the known
    fields are typed, an index signature tolerates (and ignores) the rest */
interface JsonCube {
  [key: string]: unknown;
  o: number; x: number; y: number; z: number; shape: number; comp: number;
  id?: number; flag?: number; variant?: number; counter?: number; slots?: PlateSlot[];
  plateKinds?: (string | null)[];
}

/** wing shape as it appears in parsed JSON — unknown extra keys are kept in
    Wing.extra so a round trip can reproduce them */
interface JsonWing {
  [key: string]: unknown;
  o: number; x: number; y: number; z: number; kind: number;
}

/** distributive Omit — plain Omit over a union keeps only common members */
export type ExtraSpec = ExtraElement extends infer T
  ? T extends ExtraElement ? Omit<T, 'uid'> : never : never;

interface ImportJsonShape {
  cubes: JsonCube[];
  elements?: JsonWing[];
  meta?: Partial<ShipMeta>;
  materials?: Partial<MaterialSet>;
  /** archive texture name → library material id */
  assignments?: Record<string, string>;
  /** pre-library per-texture tuning (2026-07 era docs) — obsolete, ignored */
  surfaces?: unknown;
  /** lattice/deco/guy prototypes, notes/07-authoring.md §4.3 (uids reassigned) */
  extras?: (ExtraSpec & { uid?: number })[];
}

function isImportJsonShape(json: unknown): json is ImportJsonShape {
  if (typeof json !== 'object' || json === null) return false;
  return Array.isArray((json as { cubes?: unknown }).cubes);
}

/** ShipEntry's RawCube already carries every archive field required by
    ImportJsonShape's cubes, so both import paths share this mapping. */
function toCube(uid: number, rc: RawCube | JsonCube): Cube {
  const pk = (rc as JsonCube).plateKinds;
  const c: Cube = {
    uid, x: rc.x, y: rc.y, z: rc.z, o: rc.o, shape: rc.shape as Cube['shape'], comp: rc.comp,
    id: rc.id, flag: rc.flag, variant: rc.variant, counter: rc.counter,
    slots: rc.slots ? rc.slots.map(s => ({ ...s })) : undefined,
  };
  if (pk?.some(k => k != null)) c.plateKinds = [...pk];
  return c;
}

/** takes an entry straight out of the fleet data (ships.js/ships.json) */
export function importShip(entry: ShipEntry, name?: string): ShipDoc {
  let uid = 1;
  const cubes: Cube[] = entry.cubes.map((rc: RawCube) => toCube(uid++, rc));
  const wings: Wing[] = entry.elements.map((rw: RawWing) => ({
    uid: uid++, kind: rw.kind, x: rw.x, y: rw.y, z: rw.z, o: rw.o,
  }));
  const meta: ShipMeta = {
    name: name ?? entry.name,
    display: entry.display,
    class: entry.class,
    rank: entry.rank,
    nation: entry.nation,
  };
  return { meta, cubes, wings };
}

/** takes unknown parsed JSON of the recovered/*.json shape: {cubes, elements}
    plus an optional {meta, materials} extension; elements may be absent */
export function importShipJson(json: unknown, fallbackName: string): ShipDoc {
  if (!isImportJsonShape(json))
    throw new Error('invalid ship JSON: expected an object with a cubes array');
  let uid = 1;
  const cubes: Cube[] = json.cubes.map(rc => toCube(uid++, rc));
  const wings: Wing[] = (json.elements ?? []).map(rw => {
    const { o, x, y, z, kind, ...rest } = rw;
    const wing: Wing = { uid: uid++, kind, x, y, z, o };
    if (Object.keys(rest).length > 0) wing.extra = rest;
    return wing;
  });
  const meta: ShipMeta = {
    name: json.meta?.name ?? fallbackName,
    display: json.meta?.display ?? fallbackName,
    class: json.meta?.class,
    nation: json.meta?.nation,
    rank: json.meta?.rank,
  };
  const doc: ShipDoc = { meta, cubes, wings };
  if (json.materials) doc.materials = json.materials;
  if (json.assignments) doc.assignments = json.assignments;
  if (json.surfaces)
    console.info('ship JSON carries pre-library "surfaces" tuning — ignored '
      + '(mesh materials are library-driven now; reassign via the material browser)');
  if (json.extras?.length)
    doc.extras = json.extras.map(e => ({ ...e, uid: uid++ }) as ExtraElement);
  return doc;
}

/** Emits {cubes, elements, meta, materials?} with cubes in RawCube shape.
    Archive fields preserved verbatim when present; regenerated when absent:
    id sequential from (max preserved id)+1, flag 0, variant 0, counter
    sequential from (max preserved counter)+1, slots = slotDefaults[o]. */
export function exportShipJson(doc: ShipDoc, slotDefaults: PlateSlot[][]): unknown {
  let maxId = 0, maxCounter = 0;
  for (const c of doc.cubes) {
    if (c.id !== undefined && c.id > maxId) maxId = c.id;
    if (c.counter !== undefined && c.counter > maxCounter) maxCounter = c.counter;
  }
  let nextId = maxId + 1;
  let nextCounter = maxCounter + 1;

  const cubes: (RawCube & { plateKinds?: (string | null)[] })[] = doc.cubes.map(c => ({
    o: c.o, x: c.x, y: c.y, z: c.z, shape: c.shape, comp: c.comp,
    id: c.id ?? nextId++,
    flag: c.flag ?? 0,
    variant: c.variant ?? 0,
    counter: c.counter ?? nextCounter++,
    slots: c.slots ? c.slots.map(s => ({ ...s })) : slotDefaults[c.o].map(s => ({ ...s })),
    ...(c.plateKinds?.some(k => k != null) ? { plateKinds: [...c.plateKinds] } : {}),
  }));

  const elements = doc.wings.map(w => ({ o: w.o, x: w.x, y: w.y, z: w.z, kind: w.kind, ...(w.extra ?? {}) }));

  const out: {
    cubes: RawCube[]; elements: unknown[]; meta: ShipMeta;
    materials?: Partial<MaterialSet>;
    assignments?: Record<string, string>; extras?: unknown[];
  } = { cubes, elements, meta: { ...doc.meta } };
  if (doc.materials) out.materials = doc.materials;
  if (doc.assignments) out.assignments = doc.assignments;
  if (doc.extras?.length)
    out.extras = doc.extras.map(({ uid: _uid, ...rest }) => rest);
  return out;
}
