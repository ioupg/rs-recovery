/* Editing controller: pointer + keyboard → picks → commands → history.
   LMB belongs to tools (viewport navigation is MMB/Alt+LMB/RMB/wheel). */

import * as THREE from 'three';
import type { Cube, ShapeId, Vec3, Wing } from '../core/types';
import {
  REFLECT_SHAPE, REFLECT_WING, SLOT_AXES, WING_NAMES, plateCanonical, plateFaceDir, rotateOrient,
} from '../core/tables';
import type { PlateSlot } from '../core/types';
import type { RenderMode } from '../render/geometryTypes';
import { MODE_DEFS, TOOL_DEFS, toolDef } from './tools';
import { mountedPlatePositions } from '../render/geometry';
import type { GameData } from '../data/loader';
import type { ShipModel } from '../core/model';
import type { History } from '../core/history';
import {
  AddCubes, AddWings, Composite, MoveEntities, PatchCubes, PatchWings, RemoveCubes, RemoveWings,
} from '../core/commands';
import type { Command } from '../core/commands';
import { detectPlaneX2 } from '../core/symmetry';
import type { EditorState } from './state';
import { expandCubeSpecs, expandWingSpecs, mirrorTwinUids, type CubeSpec, type WingSpec } from './symmetryExpand';
import type { ShipView } from '../render/shipView';
import type { Viewports } from '../render/viewports';
import type { PickTri } from '../render/geometryTypes';

interface ControllerOpts {
  state: EditorState;
  model: ShipModel;
  history: History;
  view: ShipView;
  viewports: Viewports;
  canvas: HTMLElement;
  overlay: THREE.Group;
  data: GameData;
  setStatus(text: string): void;
  fitView(): void;
}

interface Hit { tri: PickTri; point: THREE.Vector3 }

const DRAG_PX = 5;

export class EditorController {
  private o: ControllerOpts;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** LMB gesture in progress */
  private gesture: {
    startX: number; startY: number;
    uid: number | null;
    additive: boolean;
    dragging: boolean;
    plane: THREE.Plane;
    startPoint: THREE.Vector3;
    delta: Vec3;
  } | null = null;
  private dragPreview: THREE.Group | null = null;

  private lastPointer: { x: number; y: number } | null = null;

  /** render mode saved before a tool auto-switched the view */
  private autoMode: RenderMode | null = null;
  private applyingAutoMode = false;

  constructor(o: ControllerOpts) {
    this.o = o;
    const c = o.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointerleave', () => {
      this.lastPointer = null;
      this.o.view.setGhost(null);
      this.o.view.setPlateGhost(null, true);
    });
    window.addEventListener('keydown', this.onKey);
    o.model.subscribe(() => this.refreshHover());
    o.state.subscribe(keys => {
      if (keys.includes('tool')) {
        this.o.view.setGhost(null);
        this.o.view.setPlateGhost(null, true);
        this.cancelGesture();
        this.applyAutoViewMode();
      }
      /* a render change we didn't make = the user took manual control */
      if (keys.includes('render') && !this.applyingAutoMode) this.autoMode = null;
      if (keys.includes('symmetry'))
        this.o.view.setSymmetryPlane(this.o.state.symmetry.on ? this.o.state.symmetry.planeX2 : null);
      /* rotating or re-picking from the keyboard must update the ghost without
         waiting for the mouse to move */
      if (keys.some(k => k === 'activeOrient' || k === 'activeShape' || k === 'buildKind'
          || k === 'activeComp' || k === 'activeWingKind' || k === 'symmetry'))
        this.refreshHover();
    });
  }

  /** tools that edit state invisible in the current view switch the view and
      restore it (unless the user changed modes themselves meanwhile) */
  private applyAutoViewMode(): void {
    const { state } = this.o;
    const need = toolDef(state.tool).needsMode;
    const setMode = (mode: RenderMode): void => {
      this.applyingAutoMode = true;
      state.update({ render: { ...state.render, mode } });
      this.applyingAutoMode = false;
    };
    if (need && state.render.mode !== need) {
      if (this.autoMode === null) this.autoMode = state.render.mode;
      setMode(need);
    } else if (!need && this.autoMode !== null) {
      setMode(this.autoMode);
      this.autoMode = null;
    }
  }

  /* ── picking ─────────────────────────────────────────────── */

  private pickAt(cx: number, cy: number): Hit | null {
    const pr = this.o.viewports.pickRay(cx, cy);
    if (!pr) return null;
    this.ray.setFromCamera(pr.ndc, pr.camera);
    const mesh = this.o.view.pickMesh;
    if (mesh) {
      const hits = this.ray.intersectObject(mesh, false);
      if (hits.length && hits[0].faceIndex != null) {
        const tri = this.o.view.pickTris[hits[0].faceIndex];
        if (tri) return { tri, point: hits[0].point };
      }
    }
    return null;
  }

  private groundCell(cx: number, cy: number): Vec3 | null {
    const pr = this.o.viewports.pickRay(cx, cy);
    if (!pr) return null;
    this.ray.setFromCamera(pr.ndc, pr.camera);
    const p = this.ray.ray.intersectPlane(this.ground, new THREE.Vector3());
    return p ? [Math.floor(p.x), 0, Math.floor(p.z)] : null;
  }

  /** cell a new entity would land in: adjacent to a picked axis face, or the
      ground plane when pointing at empty space */
  private targetCell(cx: number, cy: number): Vec3 | null {
    const hit = this.pickAt(cx, cy);
    if (hit && hit.tri.kind === 'cube' && hit.tri.exit) {
      const c = this.o.model.byUid(hit.tri.uid) as Cube | undefined;
      if (!c) return null;
      return [c.x + hit.tri.exit[0], c.y + hit.tri.exit[1], c.z + hit.tri.exit[2]];
    }
    if (hit) return null;                 // slanted face or wing — no placement
    return this.groundCell(cx, cy);
  }

  private cellFree(v: Vec3): boolean {
    return !this.o.model.cubeAt(v[0], v[1], v[2])
      && !this.o.model.doc.wings.some(w => w.x === v[0] && w.y === v[1] && w.z === v[2]);
  }

  /* ── hover ───────────────────────────────────────────────── */

  private onMove = (e: PointerEvent): void => {
    if (this.gesture) { this.updateDrag(e); return; }
    if (e.buttons) return;                // navigating
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.refreshHover();
  };

  private refreshHover(): void {
    if (!this.lastPointer || this.gesture) return;
    const { x: cx, y: cy } = this.lastPointer;
    const { state, view, setStatus } = this.o;
    if (state.tool === 'build') {
      const wing = state.buildKind === 'wing';
      const cell = this.targetCell(cx, cy);
      if (!cell) { view.setGhost(null); setStatus(''); return; }
      const valid = wing
        ? this.wingSpecsAt(cell).every(s => !this.o.model.cubeAt(s.x, s.y, s.z))
        : this.cubeSpecsAt(cell).every(s => this.cellFree([s.x, s.y, s.z]));
      view.setGhost(wing
        ? { x: cell[0], y: cell[1], z: cell[2], shape: 0,
            o: state.activeOrient, valid, kind: 'wing', wingKind: state.activeWingKind }
        : { x: cell[0], y: cell[1], z: cell[2],
            shape: state.activeShape, o: state.activeOrient, valid });
      setStatus(`${wing ? WING_NAMES[state.activeWingKind] : 'block'} → [${cell.join(', ')}]${valid ? '' : ' · occupied'}`);
    } else {
      const hit = this.pickAt(cx, cy);
      if (!hit) { setStatus(''); return; }
      const ent = this.o.model.byUid(hit.tri.uid);
      if (!ent) return;
      if (state.tool === 'plate' && 'shape' in ent) {
        const res = this.plateSlotFor(ent as Cube, hit.tri.exit);
        if (!res) { view.setPlateGhost(null, true); setStatus('no plate mounts here'); return; }
        const on = this.plateState(ent as Cube, res);
        const ghostO = on ? (ent as Cube).slots![res.idx].o : res.canonO;
        const pos = hit.tri.exit
          ? mountedPlatePositions(ent as Cube, ghostO, this.o.data, state.render.plateVariants)
          : null;
        view.setPlateGhost(pos, !on);
        setStatus(`face [${ent.x}, ${ent.y}, ${ent.z}] · plate ${on ? 'mounted — click removes · R spins' : 'absent — click mounts'}`);
        return;
      }
      view.setPlateGhost(null, true);
      setStatus('shape' in ent
        ? `block [${ent.x}, ${ent.y}, ${ent.z}] · ${this.o.data.systems.byId((ent as Cube).comp)?.name ?? `system ${(ent as Cube).comp}`} · o${ent.o}`
        : `wing ${WING_NAMES[(ent as Wing).kind]} [${ent.x}, ${ent.y}, ${ent.z}]`);
    }
  }

  /* ── LMB gestures ────────────────────────────────────────── */

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || e.altKey) return;         // navigation owns these
    const { state } = this.o;
    switch (state.tool) {
      case 'build': return state.buildKind === 'wing' ? this.doAddWing(e) : this.doAdd(e);
      case 'erase': return this.doErase(e);
      case 'systems': return this.doAssignSystem(e);
      case 'plate': return this.doPlate(e);
      case 'select': return this.beginSelect(e);
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.gesture) return;
    const g = this.gesture;
    this.gesture = null;
    this.clearDragPreview();
    if (g.dragging) { this.commitMove(g.delta); return; }
    // plain click: (re)select
    const { state } = this.o;
    if (g.uid == null) { if (!g.additive) state.select([]); return; }
    if (g.additive) {
      const s = new Set(state.selection);
      if (s.has(g.uid)) s.delete(g.uid); else s.add(g.uid);
      state.select(s);
    } else state.select([g.uid]);
  };

  private beginSelect(e: PointerEvent): void {
    const hit = this.pickAt(e.clientX, e.clientY);
    const uid = hit?.tri.uid ?? null;
    const { state } = this.o;
    // pressing on an already-selected entity begins a move of the whole selection
    if (uid != null && !state.selection.has(uid) && !e.shiftKey) state.select([uid]);
    const pr = this.o.viewports.pickRay(e.clientX, e.clientY);
    const point = hit?.point
      ?? (pr ? this.ray.ray.intersectPlane(this.ground, new THREE.Vector3()) : null);
    if (!point) { state.select([]); return; }
    const plane = e.shiftKey && pr
      ? this.verticalPlane(point, pr.camera)
      : new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.y);
    this.gesture = {
      startX: e.clientX, startY: e.clientY, uid, additive: e.shiftKey,
      dragging: false, plane, startPoint: point.clone(), delta: [0, 0, 0],
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  private verticalPlane(through: THREE.Vector3, camera: THREE.Camera): THREE.Plane {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    fwd.normalize();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(fwd, through);
  }

  private updateDrag(e: PointerEvent): void {
    const g = this.gesture!;
    if (!g.dragging) {
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_PX) return;
      if (!this.o.state.selection.size) return;
      g.dragging = true;
    }
    const pr = this.o.viewports.pickRay(e.clientX, e.clientY);
    if (!pr) return;
    this.ray.setFromCamera(pr.ndc, pr.camera);
    const p = this.ray.ray.intersectPlane(g.plane, new THREE.Vector3());
    if (!p) return;
    const d = p.sub(g.startPoint);
    g.delta = [Math.round(d.x), Math.round(d.y), Math.round(d.z)];
    this.showDragPreview(g.delta);
    const ok = this.moveTargetsFree(g.delta);
    this.o.setStatus(`Δ [${g.delta.join(', ')}]${ok ? '' : ' · occupied'}`);
  }

  private movedUids(): number[] {
    const { state, model } = this.o;
    const uids = [...state.selection];
    if (!state.symmetry.on) return uids;
    return uids.concat(mirrorTwinUids(
      uids, state.symmetry.planeX2,
      u => model.byUid(u), (x, y, z) => model.cubeAt(x, y, z), () => model.doc.wings));
  }

  private moveTargetsFree(delta: Vec3, uids = this.movedUids()): boolean {
    const { state, model } = this.o;
    const moving = new Set(uids);
    const mirrored: Vec3 = [-delta[0], delta[1], delta[2]];
    for (const uid of uids) {
      const ent = model.byUid(uid);
      if (!ent) return false;
      const d = state.symmetry.on && !state.selection.has(uid) ? mirrored : delta;
      const t = { x: ent.x + d[0], y: ent.y + d[1], z: ent.z + d[2] };
      const occ = model.cubeAt(t.x, t.y, t.z);
      if ('shape' in ent) { if (occ && !moving.has(occ.uid)) return false; }
      else if (occ && !moving.has(occ.uid)) return false;
    }
    return true;
  }

  private commitMove(delta: Vec3): void {
    if (!delta[0] && !delta[1] && !delta[2]) return;
    const { state, history, setStatus } = this.o;
    const uids = this.movedUids();
    if (!uids.length || !this.moveTargetsFree(delta, uids)) { setStatus('move cancelled — target occupied'); return; }
    const primary = uids.filter(u => state.selection.has(u));
    const twins = uids.filter(u => !state.selection.has(u));
    const cmds: Command[] = [new MoveEntities(primary, delta)];
    if (twins.length) cmds.push(new MoveEntities(twins, [-delta[0], delta[1], delta[2]]));
    history.run(cmds.length > 1 ? new Composite('move', cmds) : cmds[0]);
    setStatus(`moved by [${delta.join(', ')}]`);
  }

  private showDragPreview(delta: Vec3): void {
    this.clearDragPreview();
    const g = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: 0xC9A227, transparent: true, opacity: 0.9 });
    const box = new THREE.BoxGeometry(1.02, 1.02, 1.02);
    const edges = new THREE.EdgesGeometry(box);
    const mirrored: Vec3 = [-delta[0], delta[1], delta[2]];
    for (const uid of this.movedUids()) {
      const ent = this.o.model.byUid(uid);
      if (!ent) continue;
      const d = this.o.state.symmetry.on && !this.o.state.selection.has(uid) ? mirrored : delta;
      const l = new THREE.LineSegments(edges, mat);
      l.position.set(ent.x + d[0] + 0.5, ent.y + d[1] + 0.5, ent.z + d[2] + 0.5);
      g.add(l);
    }
    box.dispose();
    this.dragPreview = g;
    this.o.overlay.add(g);
  }

  private clearDragPreview(): void {
    if (!this.dragPreview) return;
    this.o.overlay.remove(this.dragPreview);
    this.dragPreview.traverse(o3 => {
      if (o3 instanceof THREE.LineSegments) o3.geometry.dispose();
    });
    this.dragPreview = null;
  }

  private cancelGesture(): void {
    this.gesture = null;
    this.clearDragPreview();
  }

  /* ── tool actions ────────────────────────────────────────── */

  private cubeSpecsAt(cell: Vec3): CubeSpec[] {
    const s = this.o.state;
    return expandCubeSpecs(
      [{ x: cell[0], y: cell[1], z: cell[2], o: s.activeOrient, shape: s.activeShape, comp: s.activeComp }],
      s.symmetry.on, s.symmetry.planeX2);
  }

  private wingSpecsAt(cell: Vec3): WingSpec[] {
    const s = this.o.state;
    return expandWingSpecs(
      [{ x: cell[0], y: cell[1], z: cell[2], o: s.activeOrient, kind: s.activeWingKind }],
      s.symmetry.on, s.symmetry.planeX2);
  }

  private doAdd(e: PointerEvent): void {
    const cell = this.targetCell(e.clientX, e.clientY);
    if (!cell) return;
    const specs = this.cubeSpecsAt(cell);
    if (!specs.every(s => this.cellFree([s.x, s.y, s.z]))) { this.o.setStatus('occupied'); return; }
    const cubes: Cube[] = specs.map(s => ({ ...s, uid: this.o.model.nextUid() }));
    this.o.history.run(new AddCubes(cubes));
    this.o.view.setGhost(null);
  }

  private doAddWing(e: PointerEvent): void {
    const cell = this.targetCell(e.clientX, e.clientY);
    if (!cell) return;
    const specs = this.wingSpecsAt(cell);
    if (!specs.every(s => !this.o.model.cubeAt(s.x, s.y, s.z))) { this.o.setStatus('occupied'); return; }
    const wings: Wing[] = specs.map(s => ({ ...s, uid: this.o.model.nextUid() }));
    this.o.history.run(new AddWings(wings));
    this.o.view.setGhost(null);
  }

  private doErase(e: PointerEvent): void {
    const hit = this.pickAt(e.clientX, e.clientY);
    if (!hit) return;
    this.removeUids([hit.tri.uid]);
  }

  private removeUids(base: number[]): void {
    const { state, model, history } = this.o;
    const uids = state.symmetry.on
      ? base.concat(mirrorTwinUids(base, state.symmetry.planeX2,
          u => model.byUid(u), (x, y, z) => model.cubeAt(x, y, z), () => model.doc.wings))
      : base;
    const cubes = uids.filter(u => { const en = model.byUid(u); return en && 'shape' in en; });
    const wings = uids.filter(u => { const en = model.byUid(u); return en && !('shape' in en); });
    const cmds: Command[] = [];
    if (cubes.length) cmds.push(new RemoveCubes(cubes));
    if (wings.length) cmds.push(new RemoveWings(wings));
    if (!cmds.length) return;
    history.run(cmds.length > 1 ? new Composite('delete', cmds) : cmds[0]);
    state.select([...state.selection].filter(u => !uids.includes(u)));
  }

  /* ── plate tool: per-face decoration on recovered slot data. The face a
        mounted axis plate decorates is R(slot.o)·(0,0,−1) in world (fleet-
        verified), so slots are resolved by orientation, not by index; the
        non-axis face (cut/slope/diagonal) is always slot 6. ── */

  /** resolve the slot for a face given its outward world direction; when no
      existing slot maps there, fall back to the world-axis-ordered index */
  private plateSlotFor(cube: Cube, dir: Vec3 | null): { idx: number; canonO: number } | null {
    if (!dir) return cube.shape === 0 ? null : { idx: 6, canonO: cube.slots?.[6]?.o ?? 0 };
    const axisIdx = SLOT_AXES.findIndex(a =>
      a[0] === dir[0] && a[1] === dir[1] && a[2] === dir[2]);
    if (axisIdx < 0) return null;
    if (cube.slots) {
      for (let i = 0; i < 6 && i < cube.slots.length; i++) {
        const d = plateFaceDir(cube.slots[i].o);
        if (d[0] === dir[0] && d[1] === dir[1] && d[2] === dir[2])
          return { idx: i, canonO: cube.slots[i].o };
      }
    }
    return { idx: axisIdx, canonO: plateCanonical(cube.shape as ShapeId, cube.o, dir as [number, number, number]) };
  }

  private plateState(cube: Cube, res: { idx: number }): boolean {
    return cube.slots?.[res.idx] ? cube.slots[res.idx].p !== 0 : false;
  }

  private platePatch(cube: Cube, res: { idx: number; canonO: number },
    change: { p?: number; o?: number }): { uid: number; patch: Partial<Cube> } {
    const slots: PlateSlot[] = cube.slots && cube.slots.length === 7
      ? cube.slots.map(s => ({ ...s }))
      : Array.from({ length: 7 }, () => ({ o: 0, p: 0, f: 0 }));
    const cur = slots[res.idx];
    slots[res.idx] = {
      o: change.o ?? (change.p ? res.canonO : cur.o),
      p: change.p ?? cur.p,
      f: cur.f,
    };
    return { uid: cube.uid, patch: { slots } };
  }

  /** the same face on the symmetry twin, as (cube, resolution) pairs */
  private plateTargets(cube: Cube, dir: Vec3 | null): { cube: Cube; res: { idx: number; canonO: number } }[] {
    const { state, model } = this.o;
    const out: { cube: Cube; res: { idx: number; canonO: number } }[] = [];
    const res = this.plateSlotFor(cube, dir);
    if (res) out.push({ cube, res });
    if (state.symmetry.on) {
      const twins = mirrorTwinUids([cube.uid], state.symmetry.planeX2,
        u => model.byUid(u), (x, y, z) => model.cubeAt(x, y, z), () => model.doc.wings);
      for (const tu of twins) {
        const twin = model.byUid(tu);
        if (!twin || !('shape' in twin)) continue;
        const mdir: Vec3 | null = dir ? [-dir[0], dir[1], dir[2]] : null;
        const tres = this.plateSlotFor(twin as Cube, mdir);
        if (tres) out.push({ cube: twin as Cube, res: tres });
      }
    }
    return out;
  }

  private doPlate(e: PointerEvent): void {
    const hit = this.pickAt(e.clientX, e.clientY);
    if (!hit || hit.tri.kind !== 'cube') return;
    const { model, history, setStatus } = this.o;
    const cube = model.byUid(hit.tri.uid);
    if (!cube || !('shape' in cube)) return;
    const targets = this.plateTargets(cube as Cube, hit.tri.exit);
    if (!targets.length) return;
    const on = this.plateState(cube as Cube, targets[0].res) ? 0 : 1;
    const entries = targets.map(t => this.platePatch(t.cube, t.res, { p: on }));
    history.run(new PatchCubes(entries));
    this.refreshHover();
    setStatus(`plate ${on ? 'mounted' : 'removed'}`);
  }

  /** R with the plate tool: spin the hovered plate 90° about its face normal —
      composing about the face's own axis keeps the plate on its face */
  private rotateHoveredPlate(dir: 1 | -1): boolean {
    if (this.o.state.tool !== 'plate' || !this.lastPointer) return false;
    const hit = this.pickAt(this.lastPointer.x, this.lastPointer.y);
    if (!hit || hit.tri.kind !== 'cube' || !hit.tri.exit) return false;
    const { model, history, setStatus } = this.o;
    const cube = model.byUid(hit.tri.uid);
    if (!cube || !('shape' in cube)) return false;
    const targets = this.plateTargets(cube as Cube, hit.tri.exit);
    const entries: { uid: number; patch: Partial<Cube> }[] = [];
    for (const t of targets) {
      if (!this.plateState(t.cube, t.res)) continue;
      const cur = t.cube.slots![t.res.idx];
      const d = plateFaceDir(cur.o);
      const axis = (d[0] !== 0 ? 0 : d[1] !== 0 ? 1 : 2) as 0 | 1 | 2;
      const sign = (d[axis] > 0 ? 1 : -1) * dir as 1 | -1;
      entries.push(this.platePatch(t.cube, t.res, { o: rotateOrient(cur.o, axis, sign) }));
    }
    if (!entries.length) return true;              // handled, nothing to rotate
    history.run(new PatchCubes(entries));
    this.refreshHover();
    setStatus('plate rotated');
    return true;
  }

  private doAssignSystem(e: PointerEvent): void {
    const hit = this.pickAt(e.clientX, e.clientY);
    if (!hit || hit.tri.kind !== 'cube') return;
    const { state, model, history } = this.o;
    const base = [hit.tri.uid];
    const uids = state.symmetry.on
      ? base.concat(mirrorTwinUids(base, state.symmetry.planeX2,
          u => model.byUid(u), (x, y, z) => model.cubeAt(x, y, z), () => model.doc.wings))
      : base;
    const entries = uids
      .filter(u => { const en = model.byUid(u); return en && 'shape' in en && (en as Cube).comp !== state.activeComp; })
      .map(u => ({ uid: u, patch: { comp: state.activeComp } }));
    if (entries.length) history.run(new PatchCubes(entries));
  }

  /* ── keyboard ────────────────────────────────────────────── */

  private onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const { state, history } = this.o;
    const tool = TOOL_DEFS.find(td => td.key === e.key);
    if (tool && !e.ctrlKey && !e.altKey) { state.update({ tool: tool.id }); return; }
    const mode = MODE_DEFS.find(md => md.key === e.key);
    if (mode && !e.ctrlKey && !e.altKey) {
      state.update({ render: { ...state.render, mode: mode.id } });
      return;
    }
    switch (e.key.toLowerCase()) {
      case 'z':
        if (e.ctrlKey) { e.preventDefault(); history.undo(); }
        return;
      case 'y':
        if (e.ctrlKey) { e.preventDefault(); history.redo(); }
        return;
      /* X/C/V — three adjacent keys for the three world axes, X anchors */
      case 'x':
        if (e.ctrlKey) return;
        if (e.altKey) { e.preventDefault(); this.mirrorAxis(0); return; }
        this.rotateAxis(0, e.shiftKey ? -1 : 1);
        return;
      case 'c':
        if (e.ctrlKey) return;
        if (e.altKey) { e.preventDefault(); this.mirrorAxis(1); return; }
        this.rotateAxis(1, e.shiftKey ? -1 : 1);
        return;
      case 'v':
        if (e.ctrlKey) return;
        if (e.altKey) { e.preventDefault(); this.mirrorAxis(2); return; }
        this.rotateAxis(2, e.shiftKey ? -1 : 1);
        return;
      case 'r': this.rotate(e.shiftKey ? -1 : 1); return;
      case 'q': this.cycleActive(-1); return;
      case 'e': this.cycleActive(1); return;
      case 'm': this.toggleSymmetry(); return;
      case 'f': this.o.fitView(); return;
      case 'p': state.update({ render: { ...state.render, plates: !state.render.plates } }); return;
      case 'g': state.update({ render: { ...state.render, edges: !state.render.edges } }); return;
      case 'delete': case 'backspace':
        if (state.selection.size) this.removeUids([...state.selection]);
        return;
      case 'escape': state.select([]); this.cancelGesture(); this.o.view.setGhost(null); return;
    }
  };

  /** Q/E — cycle what the active tool works with */
  private cycleActive(dir: 1 | -1): void {
    const { state, data } = this.o;
    if (state.tool === 'systems') {
      const ids = data.systems.all().map(s => s.id);
      const at = Math.max(0, ids.indexOf(state.activeComp));
      state.update({ activeComp: ids[(at + dir + ids.length) % ids.length] });
      return;
    }
    if (state.tool === 'plate') {
      const n = data.plateMesh.quad_all.length;
      if (!n) return;
      const v = state.render.plateVariants;
      state.update({ render: { ...state.render,
        plateVariants: { ...v, quad: (v.quad + dir + n) % n } } });
      return;
    }
    /* build: one list — 4 shapes then 5 wings */
    const items = 4 + 5;
    const at = state.buildKind === 'shape' ? state.activeShape : 4 + state.activeWingKind;
    const next = (at + dir + items) % items;
    if (next < 4) state.update({ buildKind: 'shape', activeShape: next as ShapeId });
    else state.update({ buildKind: 'wing', activeWingKind: next - 4 });
  }

  private rotate(dir: 1 | -1): void {
    if (this.rotateHoveredPlate(dir)) return;
    this.applyOrientMap(o => ((o + dir) % 24 + 24) % 24);
  }

  /** ±90° about a world axis: composed onto the selection in place, or onto
      the active orientation used for placement */
  rotateAxis(axis: 0 | 1 | 2, dir: 1 | -1): void {
    this.applyOrientMap(o => rotateOrient(o, axis, dir));
  }

  /** delete the current selection (symmetry-aware) — panel button / Del */
  deleteSelection(): void {
    if (this.o.state.selection.size) this.removeUids([...this.o.state.selection]);
  }

  /** mirror across a world axis in one keystroke — orientation flips through
      the shape's reflection table (positions stay put) */
  mirrorAxis(axis: 0 | 1 | 2): void {
    this.applyOrientMap(
      (o, shape) => REFLECT_SHAPE[axis][shape][o],
      (o, kind) => REFLECT_WING[axis][kind][o]);
  }

  private applyOrientMap(
    map: (o: number, shape: ShapeId) => number,
    wingMap: (o: number, kind: number) => number = o => map(o, 0),
  ): void {
    const { state, model, history } = this.o;
    if (state.tool === 'select' && state.selection.size) {
      const cubes = [...state.selection]
        .map(u => model.byUid(u))
        .filter((en): en is Cube => !!en && 'shape' in en)
        .map(c => ({ uid: c.uid, patch: { o: map(c.o, c.shape) } }));
      const wings = [...state.selection]
        .map(u => model.byUid(u))
        .filter((en): en is Wing => !!en && !('shape' in en))
        .map(w => ({ uid: w.uid, patch: { o: wingMap(w.o, w.kind) } }));
      const cmds: Command[] = [];
      if (cubes.length) cmds.push(new PatchCubes(cubes));
      if (wings.length) cmds.push(new PatchWings(wings));
      if (cmds.length === 1) history.run(cmds[0]);
      else if (cmds.length > 1) history.run(new Composite('rotate', cmds));
      return;
    }
    state.update({
      activeOrient: state.buildKind === 'wing'
        ? wingMap(state.activeOrient, state.activeWingKind)
        : map(state.activeOrient, state.activeShape),
    });
  }

  private toggleSymmetry(): void {
    const { state, model } = this.o;
    const on = !state.symmetry.on;
    const planeX2 = on && !model.doc.cubes.length ? state.symmetry.planeX2
      : on ? detectPlaneX2(model) : state.symmetry.planeX2;
    state.update({ symmetry: { on, planeX2 } });
  }

  dispose(): void {
    const c = this.o.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
  }
}

/** rotate helper reused by UI (R button etc.) */
export const nextOrient = (o: number, dir: 1 | -1): number => ((o + dir) % 24 + 24) % 24;
