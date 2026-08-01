import { describe, expect, it, vi } from 'vitest';
import {
  LIB_DEFAULTS, MATERIALS_JSON_VERSION, MaterialLibrary, buildLibraryDefaults, legacyMaterials,
  normalizeMaterial,
} from './library';
import type { LibMaterialSpec } from './library';
import type { LibMaterial } from './types';

describe('normalizeMaterial', () => {
  it('fills every LIB_DEFAULTS scalar and defaults name to id', () => {
    const m = normalizeMaterial({ id: 'foo' });
    expect(m).toEqual({ ...LIB_DEFAULTS, id: 'foo', name: 'foo', maps: {} });
  });

  it('spec fields override defaults; an explicit name wins over the id fallback', () => {
    const m = normalizeMaterial({ id: 'foo', name: 'Foo Bar', color: '#123456', roughness: 0.1 });
    expect(m.name).toBe('Foo Bar');
    expect(m.color).toBe('#123456');
    expect(m.roughness).toBe(0.1);
    expect(m.metalness).toBe(LIB_DEFAULTS.metalness); // untouched field keeps the default
  });

  it('clones maps rather than aliasing the spec', () => {
    const maps = { albedo: 'a.png' };
    const m = normalizeMaterial({ id: 'foo', maps });
    expect(m.maps).toEqual({ albedo: 'a.png' });
    expect(m.maps).not.toBe(maps);
    maps.albedo = 'mutated.png';
    expect(m.maps.albedo).toBe('a.png');
  });

  it('a spec with no maps normalizes to an empty maps object', () => {
    expect(normalizeMaterial({ id: 'bare' }).maps).toEqual({});
  });
});

describe('legacyMaterials', () => {
  it('wraps every archive name id=name, sorted, legacy:true, with an albedo map', () => {
    const out = legacyMaterials(['zeta.bmp', 'alpha.png']);
    expect(out.map(m => m.id)).toEqual(['alpha.png', 'zeta.bmp']); // sorted, not input order
    for (const m of out) {
      expect(m.legacy).toBe(true);
      expect(m.maps.albedo).toBe(`textures/${m.id}.png`);
      expect(m.maps.normal).toBeUndefined();
      expect(m.maps.roughness).toBeUndefined();
    }
  });

  it('strips known extensions for the display name, leaves unrecognised ones alone', () => {
    const out = legacyMaterials(['craftHull.bmp', 'panel_tech_1.jpg', 'weird']);
    const byId = Object.fromEntries(out.map(m => [m.id, m]));
    expect(byId['craftHull.bmp'].name).toBe('craftHull');
    expect(byId['panel_tech_1.jpg'].name).toBe('panel_tech_1');
    expect(byId['weird'].name).toBe('weird');
  });

  it('adds normal/roughness maps only when PbrFlags say so, keyed by the raw name', () => {
    const out = legacyMaterials(['craftHull.bmp', 'plain.bmp'], {
      'craftHull.bmp': { n: true, r: true },
    });
    const byId = Object.fromEntries(out.map(m => [m.id, m]));
    expect(byId['craftHull.bmp'].maps.normal).toBe('textures/craftHull.bmp_n.png');
    expect(byId['craftHull.bmp'].maps.roughness).toBe('textures/craftHull.bmp_r.png');
    expect(byId['plain.bmp'].maps.normal).toBeUndefined();
    expect(byId['plain.bmp'].maps.roughness).toBeUndefined();
  });

  it('a name flagged n:false/r:false (or absent) never gets that map', () => {
    const out = legacyMaterials(['a.bmp'], { 'a.bmp': { n: false } });
    expect(out[0].maps.normal).toBeUndefined();
    expect(out[0].maps.roughness).toBeUndefined();
  });

  it('fills scalar defaults the same way normalizeMaterial does', () => {
    const [m] = legacyMaterials(['x.bmp']);
    expect(m.color).toBe(LIB_DEFAULTS.color);
    expect(m.roughness).toBe(LIB_DEFAULTS.roughness);
    expect(m.uvScale).toBe(LIB_DEFAULTS.uvScale);
  });
});

describe('buildLibraryDefaults', () => {
  const legacy = legacyMaterials(['a.bmp', 'b.bmp']);

  it('merges shipped fields over a matching legacy id, field-wise, maps merged not replaced', () => {
    const shipped: LibMaterialSpec[] = [
      { id: 'a.bmp', color: '#222222', maps: { normal: 'textures/a.bmp_n.png' } },
    ];
    const out = buildLibraryDefaults(legacy, shipped);
    const a = out.find(m => m.id === 'a.bmp')!;
    expect(a.color).toBe('#222222');                     // shipped field wins
    expect(a.legacy).toBe(true);                         // field not in shipped spec kept from legacy base
    expect(a.maps.albedo).toBe('textures/a.bmp.png');     // legacy map kept
    expect(a.maps.normal).toBe('textures/a.bmp_n.png');   // shipped map merged in
  });

  it('appends shipped ids that have no legacy match, normalized fresh', () => {
    const shipped: LibMaterialSpec[] = [{ id: 'curated-1', color: '#abcdef' }];
    const out = buildLibraryDefaults(legacy, shipped);
    const c = out.find(m => m.id === 'curated-1')!;
    expect(c.color).toBe('#abcdef');
    expect(c.legacy).toBeUndefined();
    expect(c.roughness).toBe(LIB_DEFAULTS.roughness);
  });

  it('keeps legacy seed order; updated ids stay put, new ids append at the end', () => {
    const shipped: LibMaterialSpec[] = [
      { id: 'b.bmp', color: '#000001' },   // updates an existing id, must not move it
      { id: 'new-1', color: '#000002' },
    ];
    const out = buildLibraryDefaults(legacy, shipped);
    expect(out.map(m => m.id)).toEqual(['a.bmp', 'b.bmp', 'new-1']);
  });

  it('with no shipped defs, returns the legacy set unchanged', () => {
    const out = buildLibraryDefaults(legacy, []);
    expect(out).toEqual(legacy);
  });
});

describe('MaterialLibrary', () => {
  function defs(): LibMaterial[] {
    return [
      normalizeMaterial({ id: 'legacy-1', legacy: true, maps: { albedo: 'textures/legacy-1.png' } }),
      normalizeMaterial({ id: 'curated-1', color: '#336699' }),
    ];
  }

  it('seeds set and defaults as clones independent of the input array', () => {
    const input = defs();
    const lib = new MaterialLibrary(input);
    input[0].color = '#000000';
    expect(lib.byId('legacy-1')!.color).toBe(LIB_DEFAULTS.color);
  });

  it('all() reflects seed order; byId() is undefined for unknown ids', () => {
    const lib = new MaterialLibrary(defs());
    expect(lib.all().map(m => m.id)).toEqual(['legacy-1', 'curated-1']);
    expect(lib.byId('curated-1')?.color).toBe('#336699');
    expect(lib.byId('nope')).toBeUndefined();
  });

  it('patch merges scalar fields, keeps untouched ones, and emits', () => {
    const lib = new MaterialLibrary(defs());
    const fn = vi.fn();
    lib.subscribe(fn);
    lib.patch('curated-1', { roughness: 0.2 });
    const m = lib.byId('curated-1')!;
    expect(m.roughness).toBe(0.2);
    expect(m.color).toBe('#336699');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('materials');
  });

  it('patch merges maps rather than replacing the whole maps object', () => {
    const lib = new MaterialLibrary(defs());
    lib.patch('legacy-1', { maps: { normal: 'textures/legacy-1_n.png' } });
    expect(lib.byId('legacy-1')!.maps).toEqual({
      albedo: 'textures/legacy-1.png',
      normal: 'textures/legacy-1_n.png',
    });
  });

  it('patch on an unknown id is a no-op and does not emit', () => {
    const lib = new MaterialLibrary(defs());
    const fn = vi.fn();
    lib.subscribe(fn);
    lib.patch('nope', { color: '#000000' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('reset reverts scalar fields and maps to the original default, discarding tweaks', () => {
    const lib = new MaterialLibrary(defs());
    lib.patch('curated-1', { roughness: 0.9, maps: { albedo: 'x.png' } });
    lib.reset('curated-1');
    const m = lib.byId('curated-1')!;
    expect(m.roughness).toBe(LIB_DEFAULTS.roughness);
    expect(m.maps).toEqual({});
  });

  it('reset on an unknown id is a no-op and does not emit', () => {
    const lib = new MaterialLibrary(defs());
    const fn = vi.fn();
    lib.subscribe(fn);
    lib.reset('nope');
    expect(fn).not.toHaveBeenCalled();
  });

  it('diff is undefined for a pristine library', () => {
    const lib = new MaterialLibrary(defs());
    expect(lib.diff()).toBeUndefined();
  });

  it('diff reports only the fields that differ per id; maps only when their content changed', () => {
    const lib = new MaterialLibrary(defs());
    lib.patch('curated-1', { roughness: 0.4 });
    expect(lib.diff()).toEqual({ 'curated-1': { roughness: 0.4 } });

    lib.patch('curated-1', { maps: { albedo: 'materials/curated-1/albedo.png' } });
    expect(lib.diff()).toEqual({
      'curated-1': { roughness: 0.4, maps: { albedo: 'materials/curated-1/albedo.png' } },
    });
  });

  it('reset makes an id disappear from diff again', () => {
    const lib = new MaterialLibrary(defs());
    lib.patch('legacy-1', { color: '#111111' });
    expect(lib.diff()).toBeDefined();
    lib.reset('legacy-1');
    expect(lib.diff()).toBeUndefined();
  });

  it('applyOverlay patches every listed id in a single emit and ignores unknown ids', () => {
    const lib = new MaterialLibrary(defs());
    const fn = vi.fn();
    lib.subscribe(fn);
    lib.applyOverlay({
      'curated-1': { roughness: 0.15 },
      'legacy-1': { color: '#abcabc' },
      'nope': { color: '#ffffff' },
    });
    expect(lib.byId('curated-1')!.roughness).toBe(0.15);
    expect(lib.byId('legacy-1')!.color).toBe('#abcabc');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('applyOverlay(undefined) is a no-op and does not emit', () => {
    const lib = new MaterialLibrary(defs());
    const fn = vi.fn();
    lib.subscribe(fn);
    lib.applyOverlay(undefined);
    expect(fn).not.toHaveBeenCalled();
    expect(lib.diff()).toBeUndefined();
  });

  it('subscribe returns a working unsubscribe', () => {
    const lib = new MaterialLibrary(defs());
    const fn = vi.fn();
    const unsub = lib.subscribe(fn);
    lib.patch('curated-1', { roughness: 0.1 });
    unsub();
    lib.patch('curated-1', { roughness: 0.2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  describe('exportJson', () => {
    it('stamps the format version', () => {
      const lib = new MaterialLibrary(defs());
      const { version } = JSON.parse(lib.exportJson()) as { version: number };
      expect(version).toBe(MATERIALS_JSON_VERSION);
    });

    it('omits untouched legacy wraps but always includes curated entries', () => {
      const lib = new MaterialLibrary(defs());
      const { materials } = JSON.parse(lib.exportJson()) as { materials: LibMaterial[] };
      expect(materials.map(m => m.id)).toEqual(['curated-1']);
    });

    it('includes a legacy wrap once it has been tweaked, alongside curated entries', () => {
      const lib = new MaterialLibrary(defs());
      lib.patch('legacy-1', { color: '#ff00ff' });
      const { materials } = JSON.parse(lib.exportJson()) as { materials: LibMaterial[] };
      expect(materials.map(m => m.id).sort()).toEqual(['curated-1', 'legacy-1']);
      expect(materials.find(m => m.id === 'legacy-1')!.color).toBe('#ff00ff');
    });

    /* the documented workflow: tweak → export → commit as materials.json →
       next session ships it. The tuning must survive the SECOND export, when
       it has become part of the defaults and no longer diffs against them. */
    it('keeps a committed legacy tuning across a second export cycle', () => {
      const legacy = legacyMaterials(['a.bmp']);
      const lib1 = new MaterialLibrary(buildLibraryDefaults(legacy, []), legacy);
      lib1.patch('a.bmp', { color: '#ff0000' });
      const shipped = (JSON.parse(lib1.exportJson()) as { materials: LibMaterialSpec[] }).materials;
      expect(shipped.find(m => m.id === 'a.bmp')?.color).toBe('#ff0000');

      const lib2 = new MaterialLibrary(buildLibraryDefaults(legacy, shipped), legacy);
      const again = (JSON.parse(lib2.exportJson()) as { materials: LibMaterial[] }).materials;
      expect(again.find(m => m.id === 'a.bmp')?.color).toBe('#ff0000');
    });

    it('export is a fixed point: re-shipping an export and exporting again is identical', () => {
      const legacy = legacyMaterials(['a.bmp', 'b.bmp']);
      const lib1 = new MaterialLibrary(buildLibraryDefaults(legacy, []), legacy);
      lib1.patch('a.bmp', { roughness: 0.33, maps: { normal: 'textures/a.bmp_n.png' } });
      const first = lib1.exportJson();

      const shipped = (JSON.parse(first) as { materials: LibMaterialSpec[] }).materials;
      const lib2 = new MaterialLibrary(buildLibraryDefaults(legacy, shipped), legacy);
      expect(lib2.exportJson()).toBe(first);
    });

    it('a pristine legacy wrap stays omitted even when baselines are supplied', () => {
      const legacy = legacyMaterials(['a.bmp']);
      const lib = new MaterialLibrary(buildLibraryDefaults(legacy, []), legacy);
      const { materials } = JSON.parse(lib.exportJson()) as { materials: LibMaterial[] };
      expect(materials).toEqual([]);
    });
  });
});
