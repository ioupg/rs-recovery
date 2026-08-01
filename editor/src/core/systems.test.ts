import { describe, expect, it } from 'vitest';
import { ARCHIVE_SYSTEMS, SystemsRegistry } from './systems';
import { buildDefaultMaterials, compSlot, DEFAULT_MATERIALS, MaterialStore } from './materials';
import { ShipModel } from './model';
import { validate } from './validation';
import { exportShipJson, importShipJson, type ExtraSpec } from './io';
import type { ShipDoc } from './types';

describe('SystemsRegistry', () => {
  it('seeds the ten frozen archive systems', () => {
    const reg = new SystemsRegistry();
    expect(reg.all().length).toBe(10);
    expect(reg.byId(0)?.key).toBe('power');
    expect(reg.byId(9)?.cage).toBe('m1*cargo');   // the non-cognate pair
    expect(reg.all().every(d => d.archive)).toBe(true);
  });

  it('registers new systems at id ≥ 10 only', () => {
    const reg = new SystemsRegistry();
    reg.register({ id: 10, key: 'sensors', name: 'Sensors', color: '#7FD0FF', archive: false });
    expect(reg.has(10)).toBe(true);
    expect(reg.byId(10)?.archive).toBe(false);
    expect(() => reg.register({ id: 5, key: 'x', name: 'X', color: '#fff', archive: false })).toThrow();
    expect(() => reg.register({ id: 10, key: 'y', name: 'Y', color: '#fff', archive: false })).toThrow();
    expect(() => reg.register({ id: 11, key: 'sensors', name: 'Z', color: '#fff', archive: false })).toThrow();
  });

  it('constructor extras are registered', () => {
    const reg = new SystemsRegistry([{ id: 12, key: 'ecm', name: 'ECM', color: '#abc', archive: false }]);
    expect(reg.has(12)).toBe(true);
  });
});

describe('materials from the registry', () => {
  it('archive defaults are unchanged by the refactor', () => {
    expect(Object.keys(DEFAULT_MATERIALS)).toEqual(
      [...ARCHIVE_SYSTEMS.map(s => `comp${s.id}`), 'wing']);
    expect(DEFAULT_MATERIALS.comp0.color).toBe('#E8C34A');
    expect(DEFAULT_MATERIALS.comp0.metalness).toBe(0.35);
    expect(DEFAULT_MATERIALS.comp6.emissive).toBe('#FF5A18');
    expect(DEFAULT_MATERIALS.wing.roughness).toBe(0.85);
  });

  it('a registered system gets a slot; unknown slots fall back to hull', () => {
    const reg = new SystemsRegistry([{ id: 10, key: 'sensors', name: 'Sensors', color: '#7FD0FF', archive: false }]);
    const store = new MaterialStore(buildDefaultMaterials(reg.all()));
    expect(store.get(compSlot(10)).color).toBe('#7FD0FF');
    expect(store.get(compSlot(77))).toEqual(store.get(compSlot(8)));
  });

  it('setDefaults keeps user overrides on surviving slots', () => {
    const store = new MaterialStore();
    store.patch('comp0', { color: '#123456' });
    const reg = new SystemsRegistry([{ id: 10, key: 'sensors', name: 'Sensors', color: '#7FD0FF', archive: false }]);
    store.setDefaults(buildDefaultMaterials(reg.all()));
    expect(store.get('comp0').color).toBe('#123456');
    expect(store.get(compSlot(10)).color).toBe('#7FD0FF');
  });
});

describe('validation with an extended registry', () => {
  const docWith = (comp: number): ShipDoc => ({
    meta: { name: 't', display: 't' },
    cubes: [{ uid: 1, x: 0, y: 0, z: 0, o: 0, shape: 0, comp }],
    wings: [],
  });

  it('flags unknown systems as errors, registered ones as json-only warnings', () => {
    const reg = new SystemsRegistry([{ id: 10, key: 'sensors', name: 'Sensors', color: '#7FD0FF', archive: false }]);
    const bad = validate(new ShipModel(docWith(11)), reg);
    expect(bad.some(i => i.level === 'error' && i.code === 'range')).toBe(true);
    const ext = validate(new ShipModel(docWith(10)), reg);
    expect(ext.some(i => i.level === 'error')).toBe(false);
    expect(ext.some(i => i.code === 'json-only')).toBe(true);
    const arch = validate(new ShipModel(docWith(3)), reg);
    expect(arch.length).toBe(0);
  });
});

/* SurfaceStore's per-texture response coverage moved with the store itself:
   mesh-mode materials are library-driven now — see materials.test.ts
   (AssignmentStore) and library.test.ts (MaterialLibrary). */

describe('extras round-trip', () => {
  const extras: ExtraSpec[] = [
    { kind: 'lattice', from: [0, 0, 0], to: [0, 0, 4], profile: 'square', chord: 0.08, brace: 0.04 },
    { kind: 'deco', meshId: 'antenna_a', anchor: { cell: [1, 0, 0], face: 2, offset: [0.5, 0.5] }, o: 3 },
    { kind: 'guy', a: { cell: [0, 0, 0], corner: 7 }, b: { cell: [0, 0, 4], corner: 1 }, sag: 0.15 },
  ];

  it('import assigns uids, export strips them, payload survives byte-exact', () => {
    const json = {
      cubes: [{ o: 0, x: 0, y: 0, z: 0, shape: 0, comp: 8,
        plateKinds: [null, 'p1111/3322175542', null, null, null, null, null] }],
      elements: [],
      extras,
    };
    const doc = importShipJson(json, 'test');
    expect(doc.extras?.length).toBe(3);
    expect(new Set(doc.extras!.map(e => e.uid)).size).toBe(3);
    expect(doc.cubes[0].plateKinds?.[1]).toBe('p1111/3322175542');
    const out = exportShipJson(doc, Array.from({ length: 24 }, () =>
      Array.from({ length: 7 }, () => ({ o: 0, p: 0, f: 0 })))) as {
        extras?: unknown[]; cubes: { plateKinds?: (string | null)[] }[] };
    expect(out.extras).toEqual(extras);
    expect(out.cubes[0].plateKinds).toEqual([null, 'p1111/3322175542', null, null, null, null, null]);
  });

  it('extras validation catches malformed elements', () => {
    const doc: ShipDoc = {
      meta: { name: 't', display: 't' },
      cubes: [{ uid: 1, x: 0, y: 0, z: 0, o: 0, shape: 0, comp: 8 }],
      wings: [],
      extras: [
        { uid: 2, kind: 'lattice', from: [0, 0, 0], to: [1, 2, 0], profile: 'tri', chord: 0.1, brace: 0.05 },
        { uid: 3, kind: 'guy', a: { cell: [0, 0, 0], corner: 9 }, b: { cell: [0, 0, 1], corner: 0 }, sag: 0 },
        { uid: 4, kind: 'deco', meshId: 'x', anchor: { cell: [0, 0, 0], face: 6, offset: [0, 0] }, o: 0 },
      ],
    };
    const issues = validate(new ShipModel(doc));
    expect(issues.filter(i => i.code === 'range').map(i => i.uids?.[0]).sort()).toEqual([2, 3, 4]);
  });
});
