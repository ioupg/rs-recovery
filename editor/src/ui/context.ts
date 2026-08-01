/* UI ↔ app contract. Structurally typed (no imports from core/model or
   core/history) so the UI compiles and can be developed independently of the
   core implementation; main.ts supplies the real objects. */

import type { ChangeKind, Cube, Issue, ShipDoc, Unsubscribe, Wing } from '../core/types';
import type { AssignmentStore, MaterialStore } from '../core/materials';
import type { MaterialLibrary } from '../core/library';
import type { GameData } from '../data/loader';
import type { SavedDesign } from '../data/localDesigns';
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
  /** save the current design into browser localStorage (named, persistent) */
  saveLocal(): void;
  loadLocalDesign(name: string): void;
  deleteLocalDesign(name: string): void;
  listLocalDesigns(): SavedDesign[];
  fitView(): void;
  validateNow(): Issue[];
  /** open the "Load template design" modal */
  openLoadDialog(): void;
  /** rotate the active piece / selection ±90° about a world axis */
  rotateActive(axis: 0 | 1 | 2, dir: 1 | -1): void;
  /** mirror the active piece / selection along a world axis */
  mirrorActive(axis: 0 | 1 | 2): void;
  deleteSelection(): void;
}

export interface UiContext {
  state: EditorState;
  history: HistoryLike;
  materials: MaterialStore;
  /** app-level PBR material library (mesh mode) */
  library: MaterialLibrary;
  /** archive texture → library material mapping (per-ship, exported) */
  assignments: AssignmentStore;
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
  /** canvas in the Build page for the active-piece preview (render layer draws it) */
  preview: HTMLCanvasElement;
  /** opens the load-template modal (actions.openLoadDialog binds to this) */
  openLoadDialog(): void;
}
export type BuildUi = (root: HTMLElement, ctx: UiContext) => UiRefs;
