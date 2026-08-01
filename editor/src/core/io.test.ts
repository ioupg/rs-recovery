import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { computeSlotDefaults } from '../data/loader';
import type { ShipEntry } from '../data/loader';
import { exportShipJson, importShip, importShipJson } from './io';
import type { PlateSlot } from './types';

const here = dirname(fileURLToPath(import.meta.url));

function loadFleet(): Record<string, ShipEntry> {
  const raw = readFileSync(resolve(here, '../../../viewer/ships.js'), 'utf8');
  const line = raw.split('\n')[0];
  const json = line.replace(/^const SHIPS = /, '').replace(/;\s*$/, '');
  return JSON.parse(json) as Record<string, ShipEntry>;
}

interface ExportedShip { cubes: unknown[]; elements: unknown[] }

describe('fleet round-trip (importShip → exportShipJson)', () => {
  const fleet = loadFleet();
  const names = Object.keys(fleet);
  const slotDefaults = computeSlotDefaults(fleet);

  it('reads all 43 ships from viewer/ships.js', () => {
    expect(names.length).toBe(43);
  });

  for (const name of names) {
    it(`reproduces every cube and element of ${name}`, () => {
      const entry = fleet[name];
      const doc = importShip(entry, name);
      const exported = exportShipJson(doc, slotDefaults) as ExportedShip;
      expect(exported.cubes).toEqual(entry.cubes);
      expect(exported.elements).toEqual(entry.elements);
    });
  }
});

describe('importShip', () => {
  const fleet = loadFleet();
  const sample = fleet[Object.keys(fleet)[0]];

  it('assigns fresh, unique uids and preserves meta', () => {
    const doc = importShip(sample);
    const uids = [...doc.cubes.map(c => c.uid), ...doc.wings.map(w => w.uid)];
    expect(new Set(uids).size).toBe(uids.length);
    expect(doc.meta.name).toBe(sample.name);
    expect(doc.meta.display).toBe(sample.display);
    expect(doc.meta.class).toBe(sample.class);
    expect(doc.meta.nation).toBe(sample.nation);
    expect(doc.meta.rank).toBe(sample.rank);
  });

  it('honours the optional name override', () => {
    const doc = importShip(sample, 'custom-name');
    expect(doc.meta.name).toBe('custom-name');
  });
});

describe('importShipJson', () => {
  it('tolerates a missing elements array', () => {
    const doc = importShipJson({ cubes: [{ o: 0, x: 0, y: 0, z: 0, shape: 0, comp: 8 }] }, 'fallback');
    expect(doc.wings).toEqual([]);
    expect(doc.cubes.length).toBe(1);
    expect(doc.meta.name).toBe('fallback');
  });

  it('rejects JSON without a cubes array', () => {
    expect(() => importShipJson({ elements: [] }, 'x')).toThrow();
    expect(() => importShipJson(null, 'x')).toThrow();
  });

  it('preserves unknown wing fields as extra and round-trips them through export', () => {
    const doc = importShipJson({
      cubes: [],
      elements: [{ o: 1, x: 2, y: 3, z: 4, kind: 0, mystery: 'keep-me' }],
    }, 'fallback');
    expect(doc.wings[0].extra).toEqual({ mystery: 'keep-me' });

    const exported = exportShipJson(doc, emptySlotDefaults()) as { elements: Record<string, unknown>[] };
    expect(exported.elements[0]).toEqual({ o: 1, x: 2, y: 3, z: 4, kind: 0, mystery: 'keep-me' });
  });

  it('reads embedded meta and materials overrides', () => {
    const doc = importShipJson({
      cubes: [],
      meta: { name: 'meta-name', display: 'Meta Display' },
      materials: { wing: { color: '#ff0000', roughness: 0.5, metalness: 0, emissive: '#000000', emissiveIntensity: 0, clearcoat: 0, clearcoatRoughness: 0 } },
    }, 'fallback');
    expect(doc.meta.name).toBe('meta-name');
    expect(doc.meta.display).toBe('Meta Display');
    expect(doc.materials?.wing?.color).toBe('#ff0000');
  });
});

describe('exportShipJson — archive field regeneration', () => {
  it('regenerates id/flag/variant/counter/slots for a cube with none, sequential after preserved values', () => {
    const doc = importShipJson({
      cubes: [
        { o: 0, x: 0, y: 0, z: 0, shape: 0, comp: 8, id: 10, flag: 1, variant: 2, counter: 500, slots: [] },
        { o: 1, x: 1, y: 0, z: 0, shape: 0, comp: 8 }, // editor-created: no archive fields
      ],
    }, 'ship');
    const slotDefaults = fullSlotDefaults();
    const exported = (exportShipJson(doc, slotDefaults) as { cubes: Array<{ id: number; flag: number; variant: number; counter: number; slots: PlateSlot[] }> }).cubes;

    expect(exported[0]).toMatchObject({ id: 10, flag: 1, variant: 2, counter: 500 });
    expect(exported[1].id).toBe(11);      // max preserved id (10) + 1
    expect(exported[1].flag).toBe(0);
    expect(exported[1].variant).toBe(0);
    expect(exported[1].counter).toBe(501); // max preserved counter (500) + 1
    expect(exported[1].slots).toEqual(slotDefaults[1]);
  });
});

describe('assignments (mesh-mode texture-name → library-material-id remaps)', () => {
  it('round-trips through importShipJson → exportShipJson → importShipJson', () => {
    const doc = importShipJson({
      cubes: [{ o: 0, x: 0, y: 0, z: 0, shape: 0, comp: 8 }],
      assignments: { 'craftHull.bmp': 'brushed-steel' },
    }, 'ship');
    expect(doc.assignments).toEqual({ 'craftHull.bmp': 'brushed-steel' });

    const exported = exportShipJson(doc, emptySlotDefaults()) as { assignments?: Record<string, string> };
    expect(exported.assignments).toEqual({ 'craftHull.bmp': 'brushed-steel' });

    const back = importShipJson(exported, 'ship');
    expect(back.assignments).toEqual({ 'craftHull.bmp': 'brushed-steel' });
  });

  it('is absent from the doc and omitted from export when the ship JSON has none', () => {
    const doc = importShipJson({ cubes: [{ o: 0, x: 0, y: 0, z: 0, shape: 0, comp: 8 }] }, 'ship');
    expect(doc.assignments).toBeUndefined();
    const exported = exportShipJson(doc, emptySlotDefaults()) as { assignments?: unknown };
    expect('assignments' in exported).toBe(false);
  });
});

describe('legacy "surfaces" tuning (pre-library era, obsolete)', () => {
  it('imports fine and yields no assignments/surfaces on the doc', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const doc = importShipJson({
      cubes: [{ o: 0, x: 0, y: 0, z: 0, shape: 0, comp: 8 }],
      surfaces: { 'craftHull.bmp': { envIntensity: 1.5, tint: false } },
    }, 'ship');
    expect(doc.assignments).toBeUndefined();
    expect('surfaces' in doc).toBe(false);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    infoSpy.mockRestore();
  });

  it('a doc carrying both legacy surfaces and new assignments keeps only assignments', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const doc = importShipJson({
      cubes: [{ o: 0, x: 0, y: 0, z: 0, shape: 0, comp: 8 }],
      surfaces: { 'craftHull.bmp': { envIntensity: 1.5 } },
      assignments: { 'craftHull.bmp': 'brushed-steel' },
    }, 'ship');
    expect(doc.assignments).toEqual({ 'craftHull.bmp': 'brushed-steel' });
    expect('surfaces' in doc).toBe(false);
    const exported = exportShipJson(doc, emptySlotDefaults()) as { surfaces?: unknown };
    expect('surfaces' in exported).toBe(false);
    infoSpy.mockRestore();
  });
});

function emptySlotDefaults(): PlateSlot[][] {
  return Array.from({ length: 24 }, () => Array.from({ length: 6 }, () => ({ o: 0, p: 1, f: 0 })));
}

function fullSlotDefaults(): PlateSlot[][] {
  return Array.from({ length: 24 }, (_, o) => Array.from({ length: 7 }, (_, i) => ({ o: (o + i) % 24, p: 1, f: 0 })));
}
