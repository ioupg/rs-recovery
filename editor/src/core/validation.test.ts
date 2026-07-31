import { describe, expect, it } from 'vitest';
import { ShipModel } from './model';
import { validate } from './validation';
import type { Cube, ShipDoc, Wing } from './types';

function cube(uid: number, x: number, y: number, z: number, over: Partial<Cube> = {}): Cube {
  return { uid, x, y, z, o: 0, shape: 0, comp: 8, ...over };
}
function wing(uid: number, x: number, y: number, z: number, over: Partial<Wing> = {}): Wing {
  return { uid, kind: 0, x, y, z, o: 0, ...over };
}
function doc(cubes: Cube[], wings: Wing[] = []): ShipDoc {
  return { meta: { name: 'n', display: 'N' }, cubes, wings };
}
function codes(issues: { code: string }[]): string[] {
  return issues.map(i => i.code);
}

describe('validate — range', () => {
  it('flags out-of-range cube orientation/shape/compartment', () => {
    const m = new ShipModel(doc([cube(1, 0, 0, 0, { o: 99, shape: 9 as Cube['shape'], comp: 42 })]));
    const issues = validate(m);
    expect(issues.filter(i => i.code === 'range').length).toBe(3);
    for (const i of issues) expect(i.level).toBe('error');
  });

  it('flags out-of-range wing orientation/kind', () => {
    const m = new ShipModel(doc([], [wing(1, 5, 0, 0, { o: -1, kind: 8 })]));
    const issues = validate(m);
    expect(issues.filter(i => i.code === 'range').length).toBe(2);
  });

  it('passes clean cubes and wings without range issues', () => {
    const m = new ShipModel(doc(
      [cube(1, 0, 0, 0), cube(2, 1, 0, 0)],
      [wing(3, 2, 0, 0)],
    ));
    expect(codes(validate(m))).not.toContain('range');
  });
});

describe('validate — overlap', () => {
  it('flags two cubes sharing a cell as an error', () => {
    const m = new ShipModel(doc([cube(1, 0, 0, 0), cube(2, 0, 0, 0)]));
    const issues = validate(m).filter(i => i.code === 'overlap');
    expect(issues.length).toBe(1);
    expect(issues[0].level).toBe('error');
    expect(issues[0].uids?.sort()).toEqual([1, 2]);
  });

  it('flags a wing sitting in a cube-occupied cell as an error', () => {
    const m = new ShipModel(doc([cube(1, 0, 0, 0)], [wing(2, 0, 0, 0)]));
    const issues = validate(m).filter(i => i.code === 'overlap');
    expect(issues.length).toBe(1);
    expect(issues[0].level).toBe('error');
    expect(issues[0].uids).toContain(1);
    expect(issues[0].uids).toContain(2);
  });

  it('does not flag a wing in an empty cell', () => {
    const m = new ShipModel(doc([cube(1, 0, 0, 0)], [wing(2, 5, 5, 5)]));
    expect(codes(validate(m))).not.toContain('overlap');
  });
});

describe('validate — wing-anchor', () => {
  it('warns when a wing has no face-adjacent hull cube', () => {
    const m = new ShipModel(doc([cube(1, 0, 0, 0)], [wing(2, 5, 5, 5)]));
    const issues = validate(m).filter(i => i.code === 'wing-anchor');
    expect(issues.length).toBe(1);
    expect(issues[0].level).toBe('warning');
    expect(issues[0].uids).toEqual([2]);
  });

  it('does not warn when a wing is face-adjacent to a hull cube', () => {
    const m = new ShipModel(doc([cube(1, 0, 0, 0)], [wing(2, 1, 0, 0)]));
    expect(codes(validate(m))).not.toContain('wing-anchor');
  });
});

describe('validate — disconnected', () => {
  it('warns with the component count when the hull splits into separate clusters', () => {
    const m = new ShipModel(doc([
      cube(1, 0, 0, 0), cube(2, 1, 0, 0),   // cluster A
      cube(3, 10, 0, 0),                     // cluster B
      cube(4, 20, 0, 0), cube(5, 21, 0, 0),  // cluster C
    ]));
    const issues = validate(m).filter(i => i.code === 'disconnected');
    expect(issues.length).toBe(1);
    expect(issues[0].level).toBe('warning');
    expect(issues[0].message).toContain('3');
  });

  it('does not warn when all cube cells form a single face-adjacent component', () => {
    const m = new ShipModel(doc([
      cube(1, 0, 0, 0), cube(2, 1, 0, 0), cube(3, 1, 1, 0),
    ]));
    expect(codes(validate(m))).not.toContain('disconnected');
  });

  it('does not warn (and does not crash) on an empty hull', () => {
    const m = new ShipModel(doc([]));
    expect(codes(validate(m))).not.toContain('disconnected');
  });
});
