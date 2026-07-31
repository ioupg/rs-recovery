/* Undoable mutations over ShipModel. Every command captures whatever it needs
   for revert the first time apply() runs, and re-derives it on every apply
   (including redo) so revert always matches the model state right before it. */

import type { ShipModel } from './model';
import type { Cube, Vec3, Wing } from './types';

export interface Command {
  readonly label: string;
  apply(m: ShipModel): void;
  revert(m: ShipModel): void;
}

export class AddCubes implements Command {
  readonly label = 'Add cubes';
  constructor(private readonly cubes: readonly Cube[]) {}

  apply(m: ShipModel): void {
    m.batch(() => { for (const c of this.cubes) m.addCube(c); });
  }

  revert(m: ShipModel): void {
    m.batch(() => { for (let i = this.cubes.length - 1; i >= 0; i--) m.removeCube(this.cubes[i].uid); });
  }
}

export class RemoveCubes implements Command {
  readonly label = 'Remove cubes';
  private removed: Cube[] = [];
  constructor(private readonly uids: readonly number[]) {}

  apply(m: ShipModel): void {
    m.batch(() => { this.removed = this.uids.map(uid => m.removeCube(uid)); });
  }

  revert(m: ShipModel): void {
    m.batch(() => { for (let i = this.removed.length - 1; i >= 0; i--) m.addCube(this.removed[i]); });
  }
}

export class PatchCubes implements Command {
  readonly label = 'Patch cubes';
  private inverses: { uid: number; patch: Partial<Cube> }[] = [];
  constructor(private readonly entries: readonly { uid: number; patch: Partial<Cube> }[]) {}

  apply(m: ShipModel): void {
    m.batch(() => {
      this.inverses = this.entries.map(e => ({ uid: e.uid, patch: m.patchCube(e.uid, e.patch) }));
    });
  }

  revert(m: ShipModel): void {
    m.batch(() => {
      for (let i = this.inverses.length - 1; i >= 0; i--) {
        const e = this.inverses[i];
        m.patchCube(e.uid, e.patch);
      }
    });
  }
}

export class AddWings implements Command {
  readonly label = 'Add wings';
  constructor(private readonly wings: readonly Wing[]) {}

  apply(m: ShipModel): void {
    m.batch(() => { for (const w of this.wings) m.addWing(w); });
  }

  revert(m: ShipModel): void {
    m.batch(() => { for (let i = this.wings.length - 1; i >= 0; i--) m.removeWing(this.wings[i].uid); });
  }
}

export class RemoveWings implements Command {
  readonly label = 'Remove wings';
  private removed: Wing[] = [];
  constructor(private readonly uids: readonly number[]) {}

  apply(m: ShipModel): void {
    m.batch(() => { this.removed = this.uids.map(uid => m.removeWing(uid)); });
  }

  revert(m: ShipModel): void {
    m.batch(() => { for (let i = this.removed.length - 1; i >= 0; i--) m.addWing(this.removed[i]); });
  }
}

export class PatchWings implements Command {
  readonly label = 'Patch wings';
  private inverses: { uid: number; patch: Partial<Wing> }[] = [];
  constructor(private readonly entries: readonly { uid: number; patch: Partial<Wing> }[]) {}

  apply(m: ShipModel): void {
    m.batch(() => {
      this.inverses = this.entries.map(e => ({ uid: e.uid, patch: m.patchWing(e.uid, e.patch) }));
    });
  }

  revert(m: ShipModel): void {
    m.batch(() => {
      for (let i = this.inverses.length - 1; i >= 0; i--) {
        const e = this.inverses[i];
        m.patchWing(e.uid, e.patch);
      }
    });
  }
}

/** Patches x/y/z of cubes and wings alike by a fixed delta. The caller
    (controller) pre-validates that the destination cells are free. */
export class MoveEntities implements Command {
  readonly label = 'Move';
  private cubeInverses: { uid: number; patch: Partial<Cube> }[] = [];
  private wingInverses: { uid: number; patch: Partial<Wing> }[] = [];
  constructor(private readonly uids: readonly number[], private readonly delta: Vec3) {}

  apply(m: ShipModel): void {
    m.batch(() => {
      this.cubeInverses = [];
      this.wingInverses = [];
      for (const uid of this.uids) {
        const e = m.byUid(uid);
        if (!e) continue;
        const patch = { x: e.x + this.delta[0], y: e.y + this.delta[1], z: e.z + this.delta[2] };
        if (m.isCube(e)) this.cubeInverses.push({ uid, patch: m.patchCube(uid, patch) });
        else this.wingInverses.push({ uid, patch: m.patchWing(uid, patch) });
      }
    });
  }

  revert(m: ShipModel): void {
    m.batch(() => {
      for (let i = this.cubeInverses.length - 1; i >= 0; i--) {
        const e = this.cubeInverses[i];
        m.patchCube(e.uid, e.patch);
      }
      for (let i = this.wingInverses.length - 1; i >= 0; i--) {
        const e = this.wingInverses[i];
        m.patchWing(e.uid, e.patch);
      }
    });
  }
}

export class Composite implements Command {
  constructor(readonly label: string, private readonly commands: readonly Command[]) {}

  apply(m: ShipModel): void {
    m.batch(() => { for (const c of this.commands) c.apply(m); });
  }

  revert(m: ShipModel): void {
    m.batch(() => { for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].revert(m); });
  }
}
