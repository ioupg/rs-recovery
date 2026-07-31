/* Structural checks over a ShipModel's document. Pure inspection — never
   mutates, never throws; every problem becomes an Issue. */

import type { ShipModel } from './model';
import type { Cube, Issue } from './types';
import type { SystemsRegistry } from './systems';

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

const NEIGHBORS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

export function validate(model: ShipModel, systems?: SystemsRegistry): Issue[] {
  const issues: Issue[] = [];
  const doc = model.doc;

  const knownComp = (comp: number): boolean =>
    systems ? systems.has(comp) : comp >= 0 && comp <= 9;

  for (const c of doc.cubes) {
    if (!(c.o >= 0 && c.o <= 23))
      issues.push({ level: 'error', code: 'range', message: `cube ${c.uid}: orientation ${c.o} out of range 0..23`, uids: [c.uid] });
    if (!(c.shape >= 0 && c.shape <= 3))
      issues.push({ level: 'error', code: 'range', message: `cube ${c.uid}: shape ${c.shape} out of range 0..3`, uids: [c.uid] });
    if (!knownComp(c.comp))
      issues.push({ level: 'error', code: 'range', message: `cube ${c.uid}: unknown system ${c.comp}`, uids: [c.uid] });
    else if (c.comp > 9)
      issues.push({ level: 'warning', code: 'json-only', message: `cube ${c.uid}: system ${c.comp} is not representable in the 2014 binary format`, uids: [c.uid] });
  }
  for (const w of doc.wings) {
    if (!(w.o >= 0 && w.o <= 23))
      issues.push({ level: 'error', code: 'range', message: `wing ${w.uid}: orientation ${w.o} out of range 0..23`, uids: [w.uid] });
    if (!(w.kind >= 0 && w.kind <= 4))
      issues.push({ level: 'error', code: 'range', message: `wing ${w.uid}: kind ${w.kind} out of range 0..4`, uids: [w.uid] });
  }

  const cellToCubes = new Map<string, Cube[]>();
  for (const c of doc.cubes) {
    const k = key(c.x, c.y, c.z);
    const arr = cellToCubes.get(k);
    if (arr) arr.push(c); else cellToCubes.set(k, [c]);
  }
  for (const [k, arr] of cellToCubes)
    if (arr.length > 1)
      issues.push({
        level: 'error', code: 'overlap',
        message: `${arr.length} cubes occupy cell ${k}`,
        uids: arr.map(c => c.uid),
      });

  for (const w of doc.wings) {
    const cubesHere = cellToCubes.get(key(w.x, w.y, w.z));
    if (cubesHere && cubesHere.length > 0)
      issues.push({
        level: 'error', code: 'overlap',
        message: `wing ${w.uid} occupies cube cell ${key(w.x, w.y, w.z)}`,
        uids: [w.uid, ...cubesHere.map(c => c.uid)],
      });
  }

  for (const w of doc.wings) {
    const anchored = NEIGHBORS.some(([dx, dy, dz]) => cellToCubes.has(key(w.x + dx, w.y + dy, w.z + dz)));
    if (!anchored)
      issues.push({
        level: 'warning', code: 'wing-anchor',
        message: `wing ${w.uid} has no face-adjacent hull cube`,
        uids: [w.uid],
      });
  }

  const cellKeys = [...cellToCubes.keys()];
  if (cellKeys.length > 0) {
    const visited = new Set<string>();
    let components = 0;
    for (const start of cellKeys) {
      if (visited.has(start)) continue;
      components++;
      const stack = [start];
      visited.add(start);
      while (stack.length > 0) {
        const cur = stack.pop() as string;
        const [x, y, z] = cur.split(',').map(Number) as [number, number, number];
        for (const [dx, dy, dz] of NEIGHBORS) {
          const nk = key(x + dx, y + dy, z + dz);
          if (cellToCubes.has(nk) && !visited.has(nk)) {
            visited.add(nk);
            stack.push(nk);
          }
        }
      }
    }
    if (components > 1)
      issues.push({
        level: 'warning', code: 'disconnected',
        message: `hull forms ${components} disconnected components`,
        uids: doc.cubes.map(c => c.uid),
      });
  }

  for (const e of doc.extras ?? []) {
    const bad = (msg: string): void => {
      issues.push({ level: 'error', code: 'range', message: `${e.kind} ${e.uid}: ${msg}`, uids: [e.uid] });
    };
    if (e.kind === 'lattice') {
      const d = [0, 1, 2].filter(i => e.from[i] !== e.to[i]);
      if (d.length > 1) bad('run is not axis-aligned');
      if (e.chord <= 0 || e.brace < 0) bad('non-positive strut thickness');
    } else if (e.kind === 'deco') {
      if (!(e.anchor.face >= 0 && e.anchor.face <= 5)) bad(`face ${e.anchor.face} out of range 0..5`);
      if (!(e.o >= 0 && e.o <= 23)) bad(`orientation ${e.o} out of range 0..23`);
    } else if (e.kind === 'guy') {
      for (const end of [e.a, e.b])
        if (!(end.corner >= 0 && end.corner <= 7)) bad(`corner ${end.corner} out of range 0..7`);
      if (e.sag < 0) bad('negative sag');
    }
  }

  return issues;
}
