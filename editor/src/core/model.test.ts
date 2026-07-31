import { describe, expect, it, vi } from 'vitest';
import { ShipModel } from './model';
import type { Cube, ShipDoc, Wing } from './types';

function cube(uid: number, x: number, y: number, z: number, over: Partial<Cube> = {}): Cube {
  return { uid, x, y, z, o: 0, shape: 0, comp: 8, ...over };
}
function wing(uid: number, x: number, y: number, z: number, over: Partial<Wing> = {}): Wing {
  return { uid, kind: 0, x, y, z, o: 0, ...over };
}
function emptyDoc(): ShipDoc {
  return { meta: { name: 'n', display: 'N' }, cubes: [], wings: [] };
}

describe('ShipModel queries', () => {
  it('finds cubes by cell and uid', () => {
    const doc = emptyDoc();
    doc.cubes.push(cube(1, 0, 0, 0));
    const m = new ShipModel(doc);
    expect(m.cubeAt(0, 0, 0)?.uid).toBe(1);
    expect(m.cubeAt(1, 0, 0)).toBeUndefined();
    expect(m.byUid(1)).toBe(doc.cubes[0]);
  });

  it('wingAt returns the first match when cells collide', () => {
    const doc = emptyDoc();
    doc.wings.push(wing(1, 2, 0, 0), wing(2, 2, 0, 0));
    const m = new ShipModel(doc);
    expect(m.wingAt(2, 0, 0)?.uid).toBe(1);
    expect(m.wingAt(9, 9, 9)).toBeUndefined();
  });

  it('isCube discriminates by the shape field', () => {
    const m = new ShipModel(emptyDoc());
    expect(m.isCube(cube(1, 0, 0, 0))).toBe(true);
    expect(m.isCube(wing(1, 0, 0, 0))).toBe(false);
  });

  it('bounds spans cubes and wings, one unit per cell, null when empty', () => {
    const m0 = new ShipModel(emptyDoc());
    expect(m0.bounds()).toBeNull();

    const doc = emptyDoc();
    doc.cubes.push(cube(1, 0, 0, 0), cube(2, 2, 0, 0));
    doc.wings.push(wing(3, -1, 0, 0));
    const m = new ShipModel(doc);
    expect(m.bounds()).toEqual({ min: [-1, 0, 0], max: [3, 1, 1] });
  });

  it('nextUid is monotonic and continues past the highest loaded uid', () => {
    const doc = emptyDoc();
    doc.cubes.push(cube(5, 0, 0, 0));
    const m = new ShipModel(doc);
    expect(m.nextUid()).toBe(6);
    expect(m.nextUid()).toBe(7);
  });
});

describe('ShipModel mutations', () => {
  it('addCube throws when the cell already has a cube', () => {
    const doc = emptyDoc();
    doc.cubes.push(cube(1, 0, 0, 0));
    const m = new ShipModel(doc);
    expect(() => m.addCube(cube(2, 0, 0, 0))).toThrow();
  });

  it('removeCube returns the removed cube and clears the cell', () => {
    const doc = emptyDoc();
    doc.cubes.push(cube(1, 0, 0, 0));
    const m = new ShipModel(doc);
    const removed = m.removeCube(1);
    expect(removed.uid).toBe(1);
    expect(m.cubeAt(0, 0, 0)).toBeUndefined();
    expect(m.byUid(1)).toBeUndefined();
  });

  it('patchCube returns the inverse patch of exactly the patched keys', () => {
    const doc = emptyDoc();
    doc.cubes.push(cube(1, 0, 0, 0, { comp: 2, o: 3 }));
    const m = new ShipModel(doc);
    const inverse = m.patchCube(1, { comp: 5 });
    expect(inverse).toEqual({ comp: 2 });
    expect(m.byUid(1)).toMatchObject({ comp: 5, o: 3 });
  });

  it('patchCube on x/y/z keeps the cell index consistent', () => {
    const doc = emptyDoc();
    doc.cubes.push(cube(1, 0, 0, 0));
    const m = new ShipModel(doc);
    const inverse = m.patchCube(1, { x: 4 });
    expect(inverse).toEqual({ x: 0 });
    expect(m.cubeAt(0, 0, 0)).toBeUndefined();
    expect(m.cubeAt(4, 0, 0)?.uid).toBe(1);
  });

  it('patchCube throws when the move target is occupied by a different cube', () => {
    const doc = emptyDoc();
    doc.cubes.push(cube(1, 0, 0, 0), cube(2, 1, 0, 0));
    const m = new ShipModel(doc);
    expect(() => m.patchCube(1, { x: 1 })).toThrow();
    // the failed move must not have mutated anything
    expect(m.cubeAt(0, 0, 0)?.uid).toBe(1);
    expect(m.cubeAt(1, 0, 0)?.uid).toBe(2);
  });

  it('addWing/removeWing/patchWing round-trip like their cube counterparts', () => {
    const m = new ShipModel(emptyDoc());
    m.addWing(wing(1, 0, 0, 0));
    expect(m.byUid(1)).toBeDefined();
    const inverse = m.patchWing(1, { o: 7 });
    expect(inverse).toEqual({ o: 0 });
    const removed = m.removeWing(1);
    expect(removed.o).toBe(7);
    expect(m.byUid(1)).toBeUndefined();
  });

  it('setMeta returns the inverse of exactly the patched keys', () => {
    const m = new ShipModel(emptyDoc());
    const inverse = m.setMeta({ display: 'New name' });
    expect(inverse).toEqual({ display: 'N' });
    expect(m.doc.meta.display).toBe('New name');
  });
});

describe('ShipModel lifecycle', () => {
  it('load() replaces the doc, resets indices and uid counter, and emits reset', () => {
    const m = new ShipModel(emptyDoc());
    m.addCube(cube(1, 0, 0, 0));
    const events: string[] = [];
    m.subscribe(k => events.push(k));

    const doc2 = emptyDoc();
    doc2.cubes.push(cube(9, 1, 1, 1));
    m.load(doc2);

    expect(events).toEqual(['reset']);
    expect(m.doc).toBe(doc2);
    expect(m.cubeAt(0, 0, 0)).toBeUndefined();
    expect(m.cubeAt(1, 1, 1)?.uid).toBe(9);
    expect(m.nextUid()).toBe(10);
  });

  it('batch coalesces multiple mutations into one emit per change kind', () => {
    const m = new ShipModel(emptyDoc());
    const fn = vi.fn();
    m.subscribe(fn);
    m.batch(() => {
      m.addCube(cube(1, 0, 0, 0));
      m.addCube(cube(2, 1, 0, 0));
      m.addWing(wing(3, 5, 0, 0));
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls.map(c => c[0]).sort()).toEqual(['cubes', 'wings']);
  });

  it('nested batches only flush once the outermost batch exits', () => {
    const m = new ShipModel(emptyDoc());
    const fn = vi.fn();
    m.subscribe(fn);
    m.batch(() => {
      m.batch(() => { m.addCube(cube(1, 0, 0, 0)); });
      expect(fn).not.toHaveBeenCalled();
      m.addCube(cube(2, 1, 0, 0));
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('cubes');
  });

  it('subscribe returns a working unsubscribe', () => {
    const m = new ShipModel(emptyDoc());
    const fn = vi.fn();
    const unsub = m.subscribe(fn);
    m.addCube(cube(1, 0, 0, 0));
    unsub();
    m.addCube(cube(2, 1, 0, 0));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
