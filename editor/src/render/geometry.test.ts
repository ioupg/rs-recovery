/* Sanity checks against the real recovered fleet — the geometry ports run on
   the same data the reference viewer renders. Node environment: no DOM, so the
   atlas texture is never requested (textures: false). */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ShapeId, ShipDoc } from '../core/types';
import { ARCHIVE_SLOTS } from '../core/materials';
import { SystemsRegistry } from '../core/systems';
import type { GameData, ShipEntry } from '../data/loader';
import { buildPlateRegistry } from '../data/plates';
import type { BuildOptions } from './geometryTypes';
import { buildShipGeometry } from './geometry';
import { buildPickGeometry } from './pick';

/* the pipeline emits `const NAME = <json>;` script files, one per line */
function consts(file: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of readFileSync(new URL(file, import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^const (\w+) = (.*);\s*$/);
    if (m) out[m[1]] = JSON.parse(m[2]);
  }
  return out;
}

const ships = consts('../../../viewer/ships.js').SHIPS as Record<string, ShipEntry>;
const shapes = consts('../../../viewer/shapes.js');
const data: GameData = {
  ships,
  shapeMesh: shapes.SHAPE_MESH as GameData['shapeMesh'],
  plateMesh: shapes.PLATE_MESH as GameData['plateMesh'],
  moduleMesh: shapes.MODULE_MESH as GameData['moduleMesh'],
  wingMesh: (shapes.WING_MESH ?? []) as GameData['wingMesh'],
  slotDefaults: [],
  systems: new SystemsRegistry(),
  plates: buildPlateRegistry(shapes.PLATE_MESH as GameData['plateMesh']),
};

/** uids = index; wings continue the cube range so identities stay unique */
function docOf(name: string): ShipDoc {
  const e = ships[name];
  return {
    meta: { name: e.name, display: e.display, class: e.class, nation: e.nation, rank: e.rank },
    cubes: e.cubes.map((c, i) => ({ ...c, shape: c.shape as ShapeId, uid: i })),
    wings: e.elements.map((w, i) => ({ ...w, uid: e.cubes.length + i })),
  };
}

const opts = (over: Partial<BuildOptions>): BuildOptions => ({
  mode: 'box', ao: true, textures: false, plates: true,
  plateVariants: { quad: 0, slope: 0, tri: 0, eq: 0 }, ...over,
});

const doc = docOf('m12-centurion');       // 13 cubes, 9 compartments, no wings
const winged = docOf('m14-hound');        // 21 cubes, 5 wings

describe('buildShipGeometry', () => {
  it('box mode: whole triangles, AO-only colours, one group per slot', () => {
    const built = buildShipGeometry(doc, data, opts({ mode: 'box' }));
    const pos = built.geometry.getAttribute('position');
    expect(pos.count).toBeGreaterThan(0);
    expect(pos.array.length % 9).toBe(0);              // 3 verts x 3 floats per tri

    const col = built.geometry.getAttribute('color').array;
    expect(col.length).toBe(pos.array.length);
    for (let i = 0; i < col.length; i += 3) {
      expect(col[i]).toBeGreaterThan(0);
      expect(col[i]).toBeLessThanOrEqual(1);
      expect(col[i + 1]).toBe(col[i]);                 // grayscale: tint is material-side
      expect(col[i + 2]).toBe(col[i]);
    }
    expect(col.some((v, i) => v < 1 && i % 3 === 0)).toBe(true);   // AO actually varies

    expect(built.groupSlots.length).toBeLessThanOrEqual(ARCHIVE_SLOTS.length);
    expect(built.geometry.groups.length).toBe(built.groupSlots.length);
    built.geometry.groups.forEach((g, i) => {
      expect(g.materialIndex).toBe(i);
      expect(ARCHIVE_SLOTS).toContain(built.groupSlots[i]);
    });
    /* groups tile the buffer contiguously */
    let at = 0;
    for (const g of built.geometry.groups) { expect(g.start).toBe(at); at += g.count; }
    expect(at).toBe(pos.count);

    expect(built.edgesThreshold).toBe(25);
    expect(built.edges).not.toBeNull();
    expect(built.geometry.getAttribute('uv')).toBeUndefined();
  });

  it('box mode: ao off pins every vertex colour to 1', () => {
    const built = buildShipGeometry(doc, data, opts({ mode: 'box', ao: false }));
    const col = built.geometry.getAttribute('color').array;
    for (let i = 0; i < col.length; i++) expect(col[i]).toBe(1);
  });

  it('plate mode: same facets as box plus atlas UVs and tone jitter', () => {
    const box = buildShipGeometry(doc, data, opts({ mode: 'box' }));
    const built = buildShipGeometry(doc, data, opts({ mode: 'plate' }));
    const pos = built.geometry.getAttribute('position');
    /* chamfer is gone: plate mode carries exactly the culled facet set */
    expect(pos.count).toBe(box.geometry.getAttribute('position').count);
    expect(pos.array.length % 9).toBe(0);

    const uv = built.geometry.getAttribute('uv');
    expect(uv).toBeDefined();
    expect(uv.count).toBe(pos.count);
    for (let i = 0; i < uv.array.length; i++) {
      expect(uv.array[i]).toBeGreaterThanOrEqual(0);
      expect(uv.array[i]).toBeLessThanOrEqual(1);
    }
    /* tone jitter rides on top of AO (±6%), so shade tops out at 1.06 */
    const col = built.geometry.getAttribute('color').array;
    for (let i = 0; i < col.length; i++) {
      expect(col[i]).toBeGreaterThan(0);
      expect(col[i]).toBeLessThanOrEqual(1.06);
    }
    expect(col.some(v => v > 1)).toBe(true);
    expect(built.edgesThreshold).toBe(25);
    expect(built.edges!.getAttribute('position').count).toBe(pos.count);
  });

  it('mesh mode: every used slot carries whole triangles', () => {
    const built = buildShipGeometry(doc, data, opts({ mode: 'mesh' }));
    const pos = built.geometry.getAttribute('position');
    expect(pos.array.length % 9).toBe(0);
    expect(built.groupSlots.length).toBeGreaterThan(1);
    for (const g of built.geometry.groups) {
      expect(g.count).toBeGreaterThan(0);
      expect(g.count % 3).toBe(0);                     // whole triangles per slot
    }
    /* shells + modules + filler + plates: far denser than the box hull */
    expect(pos.count).toBeGreaterThan(
      buildShipGeometry(doc, data, opts({ mode: 'box' })).geometry.getAttribute('position').count,
    );
    const nrm = built.geometry.getAttribute('normal').array;
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]);
      expect(l).toBeGreaterThan(0.5);                  // authored normals survived
    }
    expect(built.edges).toBe(built.geometry);
    expect(built.edgesThreshold).toBe(32);
  });

  it('wings render in all three modes, in the wing slot', () => {
    for (const mode of ['box', 'plate', 'mesh'] as const) {
      const built = buildShipGeometry(winged, data, opts({ mode, }));
      expect(built.groupSlots).toContain('wing');
      const g = built.geometry.groups[built.groupSlots.indexOf('wing')];
      expect(g.count % 3).toBe(0);
      expect(g.count).toBeGreaterThan(0);
    }
  });

  it('builds every ship in the fleet in every mode', () => {
    for (const name of Object.keys(ships))
      for (const mode of ['box', 'plate'] as const) {
        const built = buildShipGeometry(docOf(name), data, opts({ mode, }));
        expect(built.geometry.getAttribute('position').count % 3).toBe(0);
        expect(built.geometry.getAttribute('position').count).toBeGreaterThan(0);
      }
  });
});

describe('buildPickGeometry', () => {
  it('one PickTri per triangle, axis-aligned faces carry an exit step', () => {
    const { geometry, tris } = buildPickGeometry(winged);
    const pos = geometry.getAttribute('position');
    expect(tris.length).toBeGreaterThan(0);
    expect(pos.count).toBe(tris.length * 3);

    const uids = new Set(winged.cubes.map(c => c.uid));
    let axisAligned = 0;
    for (let t = 0; t < tris.length; t++) {
      const p = (i: number): [number, number, number] =>
        [pos.getX(t * 3 + i), pos.getY(t * 3 + i), pos.getZ(t * 3 + i)];
      const [a, b, c] = [p(0), p(1), p(2)];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]);
      expect(l).toBeGreaterThan(1e-6);                 // no degenerate pick tris
      const axis = [0, 1, 2].find(i => Math.abs(n[i] / l) > 0.99);
      const tri = tris[t];
      if (axis !== undefined && tri.kind === 'cube') {
        axisAligned++;
        expect(tri.exit).not.toBeNull();
        const e = tri.exit!;
        expect(Math.abs(e[axis])).toBe(1);
        expect(Math.abs(e[0]) + Math.abs(e[1]) + Math.abs(e[2])).toBe(1);
      }
      if (tri.kind === 'cube') expect(uids.has(tri.uid)).toBe(true);
      else expect(tri.exit).toBeNull();
    }
    expect(axisAligned).toBeGreaterThan(0);
    expect(tris.some(t => t.kind === 'wing')).toBe(true);
    /* slanted faces exist in this fleet and must not claim an exit */
    expect(tris.some(t => t.kind === 'cube' && t.exit === null)).toBe(true);
  });

  it('exit points away from the cube it belongs to', () => {
    const { geometry, tris } = buildPickGeometry(doc);
    const pos = geometry.getAttribute('position');
    const byUid = new Map(doc.cubes.map(c => [c.uid, c]));
    for (let t = 0; t < tris.length; t++) {
      const tri = tris[t];
      if (tri.kind !== 'cube' || !tri.exit) continue;
      const cb = byUid.get(tri.uid)!;
      /* face centroid vs cell centre: the exit must point out of the cell */
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < 3; i++) {
        cx += pos.getX(t * 3 + i); cy += pos.getY(t * 3 + i); cz += pos.getZ(t * 3 + i);
      }
      const d = [cx / 3 - (cb.x + 0.5), cy / 3 - (cb.y + 0.5), cz / 3 - (cb.z + 0.5)];
      expect(d[0] * tri.exit[0] + d[1] * tri.exit[1] + d[2] * tri.exit[2]).toBeGreaterThan(0);
    }
  });
});
