/* Single mutable editor state with change notification. UI and controller
   read/write through update() so every panel stays in sync. */

import type { ShapeId, Unsubscribe } from '../core/types';
import type { BuildOptions, ViewportLayout } from '../render/geometryTypes';

export type Tool = 'select' | 'add' | 'erase' | 'paint' | 'wing' | 'plate';

export interface RenderSettings extends BuildOptions {
  edges: boolean;
  compColors: boolean;
}

export interface SymmetrySettings {
  on: boolean;
  /** mirror plane at x = planeX2 / 2; cell map x′ = planeX2 − 1 − x */
  planeX2: number;
}

export class EditorState {
  tool: Tool = 'add';
  activeShape: ShapeId = 0;
  activeOrient = 0;
  activeComp = 8;
  activeWingKind = 0;
  selection = new Set<number>();
  symmetry: SymmetrySettings = { on: false, planeX2: 0 };
  render: RenderSettings = {
    mode: 'box', chamfer: true, ao: true, textures: true, plates: true,
    plateVariants: { quad: 0, slope: 0, tri: 0, eq: 0 }, edges: true, compColors: true,
  };
  layout: ViewportLayout = 'single';

  private listeners = new Set<(keys: (keyof EditorState)[]) => void>();

  /** shallow-assign and notify; nested objects must be replaced, not mutated */
  update(patch: Partial<EditorState>): void {
    Object.assign(this, patch);
    this.emit(Object.keys(patch) as (keyof EditorState)[]);
  }

  /** replace the selection set and notify */
  select(uids: Iterable<number>): void {
    this.selection = new Set(uids);
    this.emit(['selection']);
  }

  subscribe(fn: (keys: (keyof EditorState)[]) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(keys: (keyof EditorState)[]): void {
    for (const fn of this.listeners) fn(keys);
  }
}
