import { describe, expect, it } from 'vitest';
import {
  AddCubes, AddWings, Composite, MoveEntities, PatchCubes, PatchWings, RemoveCubes, RemoveWings,
} from './commands';
import type { Command } from './commands';
import { History } from './history';
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

/** doc equality that ignores the array-position drift a remove+re-add can
    introduce (addCube always appends; the contract gives it no index
    parameter to restore an original slot) — everything else is byte-equal */
function canon(doc: ShipDoc): string {
  const clone = JSON.parse(JSON.stringify(doc)) as ShipDoc;
  clone.cubes.sort((a, b) => a.uid - b.uid);
  clone.wings.sort((a, b) => a.uid - b.uid);
  return JSON.stringify(clone);
}

describe('AddCubes / RemoveCubes', () => {
  it('apply adds, undo restores, redo re-adds', () => {
    const doc = emptyDoc();
    doc.cubes.push(cube(1, 0, 0, 0));
    const m = new ShipModel(doc);
    const h = new History(m);
    const before = canon(m.doc);

    const newCube = cube(m.nextUid(), 1, 0, 0);
    h.run(new AddCubes([newCube]));
    expect(m.cubeAt(1, 0, 0)).toBeDefined();
    const afterAdd = canon(m.doc);

    expect(h.undo()).toBe(true);
    expect(canon(m.doc)).toBe(before);
    expect(m.cubeAt(1, 0, 0)).toBeUndefined();

    expect(h.redo()).toBe(true);
    expect(canon(m.doc)).toBe(afterAdd);
  });

  it('RemoveCubes captures removed cubes on apply and restores them on revert', () => {
    const doc = emptyDoc();
    doc.cubes.push(cube(1, 0, 0, 0), cube(2, 1, 0, 0));
    const m = new ShipModel(doc);
    const h = new History(m);
    const before = canon(m.doc);

    h.run(new RemoveCubes([2]));
    expect(m.cubeAt(1, 0, 0)).toBeUndefined();

    expect(h.undo()).toBe(true);
    expect(canon(m.doc)).toBe(before);
    expect(m.cubeAt(1, 0, 0)?.uid).toBe(2);
  });
});

describe('PatchCubes / PatchWings', () => {
  it('captures the inverse patch and undo restores original fields', () => {
    const doc = emptyDoc();
    doc.cubes.push(cube(1, 0, 0, 0, { comp: 2 }));
    const m = new ShipModel(doc);
    const h = new History(m);
    const before = canon(m.doc);

    h.run(new PatchCubes([{ uid: 1, patch: { comp: 9 } }]));
    expect(m.byUid(1)).toMatchObject({ comp: 9 });

    expect(h.undo()).toBe(true);
    expect(canon(m.doc)).toBe(before);
    expect(m.byUid(1)).toMatchObject({ comp: 2 });

    expect(h.redo()).toBe(true);
    expect(m.byUid(1)).toMatchObject({ comp: 9 });
  });

  it('PatchWings mirrors the cube behaviour', () => {
    const doc = emptyDoc();
    doc.wings.push(wing(1, 3, 0, 0, { o: 2 }));
    const m = new ShipModel(doc);
    const h = new History(m);
    const before = canon(m.doc);

    h.run(new PatchWings([{ uid: 1, patch: { o: 7 } }]));
    expect(m.byUid(1)).toMatchObject({ o: 7 });
    expect(h.undo()).toBe(true);
    expect(canon(m.doc)).toBe(before);
  });
});

describe('AddWings / RemoveWings', () => {
  it('AddWings apply+undo+redo round-trips', () => {
    const m = new ShipModel(emptyDoc());
    const h = new History(m);
    const before = canon(m.doc);

    const w = wing(m.nextUid(), 2, 0, 0);
    h.run(new AddWings([w]));
    expect(m.wingAt(2, 0, 0)).toBeDefined();
    const afterAdd = canon(m.doc);

    expect(h.undo()).toBe(true);
    expect(canon(m.doc)).toBe(before);

    expect(h.redo()).toBe(true);
    expect(canon(m.doc)).toBe(afterAdd);
  });

  it('RemoveWings captures removed wings on apply and restores them on revert', () => {
    const doc = emptyDoc();
    doc.wings.push(wing(1, 2, 0, 0), wing(2, 3, 0, 0));
    const m = new ShipModel(doc);
    const h = new History(m);
    const before = canon(m.doc);

    h.run(new RemoveWings([2]));
    expect(m.wingAt(3, 0, 0)).toBeUndefined();

    expect(h.undo()).toBe(true);
    expect(canon(m.doc)).toBe(before);
    expect(m.wingAt(3, 0, 0)?.uid).toBe(2);
  });
});

describe('MoveEntities', () => {
  it('moves a cube and a wing together and undo restores both positions exactly', () => {
    const doc = emptyDoc();
    doc.cubes.push(cube(1, 0, 0, 0));
    doc.wings.push(wing(2, 1, 0, 0));
    const m = new ShipModel(doc);
    const h = new History(m);
    const before = canon(m.doc);

    h.run(new MoveEntities([1, 2], [0, 1, 2]));
    expect(m.cubeAt(0, 1, 2)?.uid).toBe(1);
    expect(m.wingAt(1, 1, 2)?.uid).toBe(2);
    expect(m.cubeAt(0, 0, 0)).toBeUndefined();

    expect(h.undo()).toBe(true);
    expect(canon(m.doc)).toBe(before);
    expect(m.cubeAt(0, 0, 0)?.uid).toBe(1);
    expect(m.wingAt(1, 0, 0)?.uid).toBe(2);

    expect(h.redo()).toBe(true);
    expect(m.cubeAt(0, 1, 2)?.uid).toBe(1);
    expect(m.wingAt(1, 1, 2)?.uid).toBe(2);
  });
});

describe('Composite', () => {
  it('applies sub-commands in order and reverts them in reverse order', () => {
    const order: string[] = [];
    const fake = (label: string): Command => ({
      label,
      apply: () => order.push(`apply:${label}`),
      revert: () => order.push(`revert:${label}`),
    });
    const m = new ShipModel(emptyDoc());
    const composite = new Composite('multi', [fake('a'), fake('b'), fake('c')]);

    composite.apply(m);
    expect(order).toEqual(['apply:a', 'apply:b', 'apply:c']);

    order.length = 0;
    composite.revert(m);
    expect(order).toEqual(['revert:c', 'revert:b', 'revert:a']);
  });

  it('composes real commands (add cube then patch it) and undoes as one unit', () => {
    const m = new ShipModel(emptyDoc());
    const h = new History(m);
    const before = canon(m.doc);

    const uid = m.nextUid();
    const composite = new Composite('add+patch', [
      new AddCubes([cube(uid, 3, 0, 0, { comp: 1 })]),
      new PatchCubes([{ uid, patch: { comp: 6 } }]),
    ]);
    h.run(composite);
    expect(m.byUid(uid)).toMatchObject({ comp: 6 });

    expect(h.undo()).toBe(true);
    expect(canon(m.doc)).toBe(before);
    expect(m.byUid(uid)).toBeUndefined();
  });
});

describe('History', () => {
  it('canUndo/canRedo track stack state and clear() resets both', () => {
    const m = new ShipModel(emptyDoc());
    const h = new History(m);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(false);

    h.run(new AddCubes([cube(m.nextUid(), 0, 0, 0)]));
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);

    h.undo();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);

    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('running a new command after undo truncates the redo stack', () => {
    const m = new ShipModel(emptyDoc());
    const h = new History(m);
    h.run(new AddCubes([cube(m.nextUid(), 0, 0, 0)]));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.run(new AddCubes([cube(m.nextUid(), 5, 0, 0)]));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it('subscribe notifies on run/undo/redo/clear', () => {
    const m = new ShipModel(emptyDoc());
    const h = new History(m);
    let calls = 0;
    h.subscribe(() => { calls++; });
    h.run(new AddCubes([cube(m.nextUid(), 0, 0, 0)]));
    h.undo();
    h.redo();
    h.clear();
    expect(calls).toBe(4);
  });
});
