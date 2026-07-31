/* Linear undo/redo stack over Command applications. */

import type { Command } from './commands';
import type { ShipModel } from './model';
import type { Unsubscribe } from './types';

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly model: ShipModel) {}

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  run(cmd: Command): void {
    cmd.apply(this.model);
    this.undoStack.push(cmd);
    this.redoStack = [];
    this.emit();
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.revert(this.model);
    this.redoStack.push(cmd);
    this.emit();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.apply(this.model);
    this.undoStack.push(cmd);
    this.emit();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  subscribe(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
