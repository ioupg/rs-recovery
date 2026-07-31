/* Editing controller: pointer + keyboard → picks → commands → history.
   LMB belongs to tools (viewport navigation is MMB/Alt+LMB/RMB/wheel). */

import * as THREE from 'three';
import type { Cube, ShapeId, Vec3, Wing } from '../core/types';
import { COMP_NAMES, WING_NAMES, rotateOrient } from '../core/tables';
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

  constructor(o: ControllerOpts) {
    this.o = o;
    const c = o.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointerleave', () => { this.lastPointer = null; this.o.view.setGhost(null); });
    window.addEventListener('keydown', this.onKey);
    o.state.subscribe(keys => {
      if (keys.includes('tool')) { this.o.view.setGhost(null); this.cancelGesture(); }
      if (keys.includes('symmetry'))
        this.o.view.setSymmetryPlane(this.o.state.symmetry.on ? this.o.state.symmetry.planeX2 : null);
      /* rotating or re-picking from the keyboard must update the ghost without
         waiting for the mouse to move */
      if (keys.some(k => k === 'activeOrient' || k === 'activeShape'
          || k === 'activeComp' || k === 'activeWingKind' || k === 'symmetry'))
        this.refreshHover();
    });
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
    if (state.tool === 'add' || state.tool === 'wing') {
      const cell = this.targetCell(cx, cy);
      if (!cell) { view.setGhost(null); setStatus(''); return; }
      const specs = state.tool === 'add' ? this.cubeSpecsAt(cell) : null;
      const wspecs = state.tool === 'wing' ? this.wingSpecsAt(cell) : null;
      const valid = specs ? specs.every(s => this.cellFree([s.x, s.y, s.z]))
                          : wspecs!.every(s => !this.o.model.cubeAt(s.x, s.y, s.z));
      view.setGhost(state.tool === 'add'
        ? { x: cell[0], y: cell[1], z: cell[2],
            shape: state.activeShape, o: state.activeOrient, valid }
        : { x: cell[0], y: cell[1], z: cell[2], shape: 0,
            o: state.activeOrient, valid, kind: 'wing', wingKind: state.activeWingKind });
      setStatus(`${state.tool === 'add' ? 'блок' : WING_NAMES[state.activeWingKind]} → [${cell.join(', ')}]${valid ? '' : ' · занято'}`);
    } else {
      const hit = this.pickAt(cx, cy);
      if (!hit) { setStatus(''); return; }
      const ent = this.o.model.byUid(hit.tri.uid);
      if (!ent) return;
      setStatus('shape' in ent
        ? `куб [${ent.x}, ${ent.y}, ${ent.z}] · ${COMP_NAMES[(ent as Cube).comp]} · o${ent.o}`
        : `крыло ${WING_NAMES[(ent as Wing).kind]} [${ent.x}, ${ent.y}, ${ent.z}]`);
    }
  }

  /* ── LMB gestures ────────────────────────────────────────── */

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || e.altKey) return;         // navigation owns these
    const { state } = this.o;
    switch (state.tool) {
      case 'add': return this.doAdd(e);
      case 'wing': return this.doAddWing(e);
      case 'erase': return this.doErase(e);
      case 'paint': return this.doPaint(e);
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
    this.o.setStatus(`Δ [${g.delta.join(', ')}]${ok ? '' : ' · занято'}`);
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
    if (!uids.length || !this.moveTargetsFree(delta, uids)) { setStatus('перемещение отменено — занято'); return; }
    const primary = uids.filter(u => state.selection.has(u));
    const twins = uids.filter(u => !state.selection.has(u));
    const cmds: Command[] = [new MoveEntities(primary, delta)];
    if (twins.length) cmds.push(new MoveEntities(twins, [-delta[0], delta[1], delta[2]]));
    history.run(cmds.length > 1 ? new Composite('перемещение', cmds) : cmds[0]);
    setStatus(`перемещено на [${delta.join(', ')}]`);
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
    if (!specs.every(s => this.cellFree([s.x, s.y, s.z]))) { this.o.setStatus('занято'); return; }
    const cubes: Cube[] = specs.map(s => ({ ...s, uid: this.o.model.nextUid() }));
    this.o.history.run(new AddCubes(cubes));
    this.o.view.setGhost(null);
  }

  private doAddWing(e: PointerEvent): void {
    const cell = this.targetCell(e.clientX, e.clientY);
    if (!cell) return;
    const specs = this.wingSpecsAt(cell);
    if (!specs.every(s => !this.o.model.cubeAt(s.x, s.y, s.z))) { this.o.setStatus('занято'); return; }
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
    history.run(cmds.length > 1 ? new Composite('удаление', cmds) : cmds[0]);
    state.select([...state.selection].filter(u => !uids.includes(u)));
  }

  private doPaint(e: PointerEvent): void {
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
    const tools = { '1': 'select', '2': 'add', '3': 'erase', '4': 'paint', '5': 'wing' } as const;
    if (e.key in tools) { state.update({ tool: tools[e.key as keyof typeof tools] }); return; }
    switch (e.key.toLowerCase()) {
      case 'z':
        if (e.ctrlKey) { e.preventDefault(); history.undo(); }
        else this.rotateAxis(2, e.shiftKey ? -1 : 1);
        return;
      case 'y':
        if (e.ctrlKey) { e.preventDefault(); history.redo(); }
        else this.rotateAxis(1, e.shiftKey ? -1 : 1);
        return;
      case 'x':
        if (!e.ctrlKey) this.rotateAxis(0, e.shiftKey ? -1 : 1);
        return;
      case 'r': this.rotate(e.shiftKey ? -1 : 1); return;
      case 'q': state.update({ activeComp: (state.activeComp + 9) % 10 }); return;
      case 'e': state.update({ activeComp: (state.activeComp + 1) % 10 }); return;
      case 'm': this.toggleSymmetry(); return;
      case 'f': this.o.fitView(); return;
      case 'delete': case 'backspace':
        if (state.selection.size) this.removeUids([...state.selection]);
        return;
      case 'escape': state.select([]); this.cancelGesture(); this.o.view.setGhost(null); return;
      case 'tab': break;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      state.update({ layout: state.layout === 'single' ? 'quad' : 'single' });
    }
  };

  private rotate(dir: 1 | -1): void {
    this.applyOrientMap(o => ((o + dir) % 24 + 24) % 24);
  }

  /** ±90° about a world axis: composed onto the selection in place, or onto
      the active orientation used for placement */
  private rotateAxis(axis: 0 | 1 | 2, dir: 1 | -1): void {
    this.applyOrientMap(o => rotateOrient(o, axis, dir));
  }

  private applyOrientMap(map: (o: number) => number): void {
    const { state, model, history } = this.o;
    if (state.tool === 'select' && state.selection.size) {
      const cubes = [...state.selection]
        .map(u => model.byUid(u))
        .filter((en): en is Cube => !!en && 'shape' in en)
        .map(c => ({ uid: c.uid, patch: { o: map(c.o) } }));
      const wings = [...state.selection]
        .map(u => model.byUid(u))
        .filter((en): en is Wing => !!en && !('shape' in en))
        .map(w => ({ uid: w.uid, patch: { o: map(w.o) } }));
      const cmds: Command[] = [];
      if (cubes.length) cmds.push(new PatchCubes(cubes));
      if (wings.length) cmds.push(new PatchWings(wings));
      if (cmds.length === 1) history.run(cmds[0]);
      else if (cmds.length > 1) history.run(new Composite('поворот', cmds));
      return;
    }
    state.update({ activeOrient: map(state.activeOrient) });
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
