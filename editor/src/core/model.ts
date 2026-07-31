/* The mutable ship document plus indices for fast lookup. Only commands
   (commands.ts) call the mutation methods; everything else reads. */

import type { ChangeKind, Cube, ShipDoc, ShipMeta, Unsubscribe, Vec3, Wing } from './types';

const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** captures the old values of exactly the keys present in `patch`, before it
    is applied — the inverse patch a command needs to undo the mutation */
function captureInverse<T extends object>(target: T, patch: Partial<T>): Partial<T> {
  const inverse: Partial<T> = {};
  for (const k of Object.keys(patch) as (keyof T)[]) inverse[k] = target[k];
  return inverse;
}

export class ShipModel {
  private _doc: ShipDoc;
  private readonly uidIndex = new Map<number, Cube | Wing>();
  private readonly cubeCellIndex = new Map<string, number>();
  private uidCounter = 1;
  private readonly listeners = new Set<(kind: ChangeKind) => void>();
  private batchDepth = 0;
  private readonly pending = new Set<ChangeKind>();

  constructor(doc: ShipDoc) {
    this._doc = doc;
    this.reindex();
  }

  get doc(): ShipDoc { return this._doc; }

  /* ── queries ──────────────────────────────────────────────── */

  cubeAt(x: number, y: number, z: number): Cube | undefined {
    const uid = this.cubeCellIndex.get(cellKey(x, y, z));
    return uid === undefined ? undefined : (this.uidIndex.get(uid) as Cube | undefined);
  }

  /** first match in doc order; a cell may host more than one wing */
  wingAt(x: number, y: number, z: number): Wing | undefined {
    return this._doc.wings.find(w => w.x === x && w.y === y && w.z === z);
  }

  byUid(uid: number): Cube | Wing | undefined {
    return this.uidIndex.get(uid);
  }

  isCube(e: Cube | Wing): e is Cube {
    return 'shape' in e;
  }

  bounds(): { min: Vec3; max: Vec3 } | null {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let any = false;
    const consider = (x: number, y: number, z: number): void => {
      any = true;
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
      if (x + 1 > maxX) maxX = x + 1; if (y + 1 > maxY) maxY = y + 1; if (z + 1 > maxZ) maxZ = z + 1;
    };
    for (const c of this._doc.cubes) consider(c.x, c.y, c.z);
    for (const w of this._doc.wings) consider(w.x, w.y, w.z);
    return any ? { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] } : null;
  }

  nextUid(): number {
    return this.uidCounter++;
  }

  /* ── mutations — called ONLY by commands ─────────────────── */

  addCube(c: Cube): void {
    const key = cellKey(c.x, c.y, c.z);
    if (this.cubeCellIndex.has(key)) throw new Error(`cell ${key} already occupied by a cube`);
    this._doc.cubes.push(c);
    this.cubeCellIndex.set(key, c.uid);
    this.uidIndex.set(c.uid, c);
    this.emit('cubes');
  }

  removeCube(uid: number): Cube {
    const cube = this.getCube(uid);
    this._doc.cubes.splice(this._doc.cubes.indexOf(cube), 1);
    this.cubeCellIndex.delete(cellKey(cube.x, cube.y, cube.z));
    this.uidIndex.delete(uid);
    this.emit('cubes');
    return cube;
  }

  patchCube(uid: number, patch: Partial<Cube>): Partial<Cube> {
    const cube = this.getCube(uid);
    const inverse = captureInverse(cube, patch);
    const movesCell = patch.x !== undefined || patch.y !== undefined || patch.z !== undefined;
    if (movesCell) {
      const newX = patch.x ?? cube.x, newY = patch.y ?? cube.y, newZ = patch.z ?? cube.z;
      const oldKey = cellKey(cube.x, cube.y, cube.z);
      const newKey = cellKey(newX, newY, newZ);
      if (newKey !== oldKey) {
        const occupant = this.cubeCellIndex.get(newKey);
        if (occupant !== undefined && occupant !== uid)
          throw new Error(`cell ${newKey} already occupied by cube ${occupant}`);
        this.cubeCellIndex.delete(oldKey);
        this.cubeCellIndex.set(newKey, uid);
      }
    }
    Object.assign(cube, patch);
    this.emit('cubes');
    return inverse;
  }

  addWing(w: Wing): void {
    this._doc.wings.push(w);
    this.uidIndex.set(w.uid, w);
    this.emit('wings');
  }

  removeWing(uid: number): Wing {
    const wing = this.getWing(uid);
    this._doc.wings.splice(this._doc.wings.indexOf(wing), 1);
    this.uidIndex.delete(uid);
    this.emit('wings');
    return wing;
  }

  patchWing(uid: number, patch: Partial<Wing>): Partial<Wing> {
    const wing = this.getWing(uid);
    const inverse = captureInverse(wing, patch);
    Object.assign(wing, patch);
    this.emit('wings');
    return inverse;
  }

  setMeta(patch: Partial<ShipMeta>): Partial<ShipMeta> {
    const inverse = captureInverse(this._doc.meta, patch);
    Object.assign(this._doc.meta, patch);
    this.emit('meta');
    return inverse;
  }

  /* ── lifecycle ────────────────────────────────────────────── */

  load(doc: ShipDoc): void {
    this._doc = doc;
    this.reindex();
    this.emit('reset');
  }

  subscribe(fn: (kind: ChangeKind) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) this.flush();
    }
  }

  /* ── internals ────────────────────────────────────────────── */

  private getCube(uid: number): Cube {
    const e = this.uidIndex.get(uid);
    if (!e || !this.isCube(e)) throw new Error(`no cube with uid ${uid}`);
    return e;
  }

  private getWing(uid: number): Wing {
    const e = this.uidIndex.get(uid);
    if (!e || this.isCube(e)) throw new Error(`no wing with uid ${uid}`);
    return e;
  }

  private reindex(): void {
    this.uidIndex.clear();
    this.cubeCellIndex.clear();
    let maxUid = 0;
    for (const c of this._doc.cubes) {
      this.uidIndex.set(c.uid, c);
      this.cubeCellIndex.set(cellKey(c.x, c.y, c.z), c.uid);
      if (c.uid > maxUid) maxUid = c.uid;
    }
    for (const w of this._doc.wings) {
      this.uidIndex.set(w.uid, w);
      if (w.uid > maxUid) maxUid = w.uid;
    }
    this.uidCounter = maxUid + 1;
  }

  private emit(kind: ChangeKind): void {
    if (this.batchDepth > 0) { this.pending.add(kind); return; }
    for (const fn of this.listeners) fn(kind);
  }

  private flush(): void {
    if (this.pending.size === 0) return;
    const kinds = [...this.pending];
    this.pending.clear();
    for (const kind of kinds) for (const fn of this.listeners) fn(kind);
  }
}
