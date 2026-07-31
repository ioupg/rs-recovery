/* UI ↔ app contract. Structurally typed (no imports from core/model or
   core/history) so the UI compiles and can be developed independently of the
   core implementation; main.ts supplies the real objects. */

import type { ChangeKind, Cube, Issue, ShipDoc, Unsubscribe, Wing } from '../core/types';
import type { MaterialStore } from '../core/materials';
import type { GameData } from '../data/loader';
import type { EditorState } from '../editor/state';

export interface HistoryLike {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): boolean;
  redo(): boolean;
  subscribe(fn: () => void): Unsubscribe;
}

export interface ModelLike {
  readonly doc: ShipDoc;
  cubeAt(x: number, y: number, z: number): Cube | undefined;
  byUid(uid: number): Cube | Wing | undefined;
  subscribe(fn: (kind: ChangeKind) => void): Unsubscribe;
}

export interface UiActions {
  newShip(): void;
  loadFleetShip(name: string): void;
  importJsonFile(file: File): void;
  exportJson(): void;
  exportGlb(): void;
  fitView(): void;
  validateNow(): Issue[];
}

export interface UiContext {
  state: EditorState;
  history: HistoryLike;
  materials: MaterialStore;
  model: ModelLike;
  data: GameData;
  actions: UiActions;
}

/** Builds the entire chrome around the given viewport container; the 3D canvas
    mounts into the element returned as `stage`. */
export interface UiRefs {
  stage: HTMLElement;
  /** transient status-line setter (hover cell, tool hints) */
  setStatus(text: string): void;
  /** canvas in the Сборка tab for the active-piece preview (render layer draws it) */
  preview: HTMLCanvasElement;
}
export type BuildUi = (root: HTMLElement, ctx: UiContext) => UiRefs;
