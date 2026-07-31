/* Camera rig + viewport layout. Single mode is one perspective camera over
   the whole canvas; quad splits it into perspective / top / front / side
   with thin gutters. Orbit feel (damped, MMB or Alt+LMB) is a direct port of
   the reference viewer's custom controller (../viewer/index.html:716-734,
   1219-1230); orthos add wheel zoom and RMB pan but no orbit. Plain LMB is
   never touched here — it belongs to the editing tools. */

import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import type { ViewportLayout } from './geometryTypes';

export type ViewportKind = 'persp' | 'top' | 'front' | 'side';

interface Rect { x: number; y: number; w: number; h: number }

interface PerspState {
  camera: THREE.PerspectiveCamera;
  th: number; ph: number; r: number;
  tgt: THREE.Vector3;
  vth: number; vph: number;
}

interface OrthoState {
  kind: 'top' | 'front' | 'side';
  camera: THREE.OrthographicCamera;
  center: THREE.Vector3;
  /** offset direction from center to camera position */
  axis: THREE.Vector3;
  /** half-height of the frustum in world units */
  viewSize: number;
  distance: number;
}

interface DragState { mode: 'orbit' | 'pan'; kind: ViewportKind; lastX: number; lastY: number }

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class Viewports {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;

  private width = 1;
  private height = 1;
  private _layout: ViewportLayout = 'single';
  private readonly rects = new Map<ViewportKind, Rect>();

  private readonly persp: PerspState;
  private readonly top: OrthoState;
  private readonly front: OrthoState;
  private readonly side: OrthoState;

  private drag: DragState | null = null;

  constructor(container: HTMLElement, renderer: THREE.WebGLRenderer) {
    this.container = container;
    this.renderer = renderer;

    this.persp = {
      camera: new THREE.PerspectiveCamera(40, 1, 0.1, 1200),
      th: 0.7, ph: 1.15, r: 20,
      tgt: new THREE.Vector3(),
      vth: 0, vph: 0,
    };
    this.top = {
      kind: 'top', camera: new THREE.OrthographicCamera(),
      center: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0),
      viewSize: 10, distance: 500,
    };
    this.top.camera.up.set(0, 0, -1);
    this.front = {
      kind: 'front', camera: new THREE.OrthographicCamera(),
      center: new THREE.Vector3(), axis: new THREE.Vector3(0, 0, 1),
      viewSize: 10, distance: 500,
    };
    this.side = {
      kind: 'side', camera: new THREE.OrthographicCamera(),
      center: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0),
      viewSize: 10, distance: 500,
    };
    for (const o of [this.top, this.front, this.side]) this.repositionOrtho(o);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);

    this.onResize();
  }

  get layout(): ViewportLayout { return this._layout; }
  set layout(v: ViewportLayout) { this._layout = v; this.onResize(); }

  render(scene: THREE.Scene): void {
    const quad = this._layout === 'quad';
    this.renderer.setScissorTest(quad);
    if (!quad) {
      const rect = this.rects.get('persp');
      if (!rect) return;
      this.renderer.setViewport(rect.x, this.toGlY(rect), rect.w, rect.h);
      this.renderer.render(scene, this.persp.camera);
      return;
    }
    for (const kind of ['persp', 'top', 'front', 'side'] as const) {
      const rect = this.rects.get(kind);
      if (!rect) continue;
      const glY = this.toGlY(rect);
      this.renderer.setViewport(rect.x, glY, rect.w, rect.h);
      this.renderer.setScissor(rect.x, glY, rect.w, rect.h);
      this.renderer.render(scene, this.cameraFor(kind));
    }
  }

  /** apply orbit damping; call once per animation frame before render() */
  update(_dt: number): void {
    const p = this.persp;
    p.th += p.vth; p.ph += p.vph;
    p.vth *= 0.88; p.vph *= 0.88;
    p.ph = clamp(p.ph, 0.08, Math.PI - 0.08);
    p.camera.position.set(
      p.tgt.x + p.r * Math.sin(p.ph) * Math.sin(p.th),
      p.tgt.y + p.r * Math.cos(p.ph),
      p.tgt.z + p.r * Math.sin(p.ph) * Math.cos(p.th),
    );
    p.camera.lookAt(p.tgt);
  }

  pickRay(clientX: number, clientY: number): { camera: THREE.Camera; ndc: THREE.Vector2 } | null {
    const local = this.toLocal(clientX, clientY);
    const kind = this.kindAt(local.x, local.y);
    if (!kind) return null;
    const rect = this.rects.get(kind);
    if (!rect) return null;
    const ndcX = ((local.x - rect.x) / rect.w) * 2 - 1;
    const ndcY = -(((local.y - rect.y) / rect.h) * 2 - 1);
    return { camera: this.cameraFor(kind), ndc: new THREE.Vector2(ndcX, ndcY) };
  }

  viewportKind(clientX: number, clientY: number): ViewportKind | null {
    const local = this.toLocal(clientX, clientY);
    return this.kindAt(local.x, local.y);
  }

  rectFor(kind: ViewportKind): Rect | null {
    return this.rects.get(kind) ?? null;
  }

  fit(bounds: { min: Vec3; max: Vec3 }): void {
    const sizeX = bounds.max[0] - bounds.min[0];
    const sizeY = bounds.max[1] - bounds.min[1];
    const sizeZ = bounds.max[2] - bounds.min[2];
    const diag = Math.hypot(sizeX, sizeY, sizeZ);
    const cx = (bounds.min[0] + bounds.max[0]) / 2;
    const cy = (bounds.min[1] + bounds.max[1]) / 2;
    const cz = (bounds.min[2] + bounds.max[2]) / 2;

    this.persp.tgt.set(cx, cy, cz);
    this.persp.r = Math.max(diag * 1.35, 8);

    const plan: [OrthoState, number][] = [
      [this.top, Math.max(sizeX, sizeZ)],
      [this.front, Math.max(sizeX, sizeY)],
      [this.side, Math.max(sizeY, sizeZ)],
    ];
    for (const [o, relevant] of plan) {
      o.center.set(cx, cy, cz);
      o.viewSize = Math.max(relevant / 2 * 1.3, 4);
      o.distance = Math.max(diag * 4, 200);
      this.repositionOrtho(o);
    }
    this.applyAllOrthoFrustums();
  }

  onResize(): void {
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(this.width, this.height, false);
    this.computeLayout();

    const perspRect = this.rects.get('persp');
    if (perspRect) {
      this.persp.camera.aspect = perspRect.w / perspRect.h;
      this.persp.camera.updateProjectionMatrix();
    }
    this.applyAllOrthoFrustums();
  }

  dispose(): void {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
  }

  private cameraFor(kind: ViewportKind): THREE.Camera {
    if (kind === 'persp') return this.persp.camera;
    return this.orthoFor(kind).camera;
  }

  private orthoFor(kind: 'top' | 'front' | 'side'): OrthoState {
    return kind === 'top' ? this.top : kind === 'front' ? this.front : this.side;
  }

  private repositionOrtho(o: OrthoState): void {
    o.camera.position.copy(o.center).addScaledVector(o.axis, o.distance);
    o.camera.up.copy(o.kind === 'top' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0));
    o.camera.lookAt(o.center);
  }

  private applyAllOrthoFrustums(): void {
    for (const o of [this.top, this.front, this.side]) {
      const rect = this.rects.get(o.kind);
      if (rect) this.updateOrthoFrustum(o, rect.w / rect.h);
    }
  }

  private updateOrthoFrustum(o: OrthoState, aspect: number): void {
    const halfH = o.viewSize;
    const halfW = halfH * aspect;
    o.camera.left = -halfW;
    o.camera.right = halfW;
    o.camera.top = halfH;
    o.camera.bottom = -halfH;
    o.camera.near = 0.1;
    o.camera.far = o.distance * 2;
    o.camera.updateProjectionMatrix();
  }

  private computeLayout(): void {
    this.rects.clear();
    const w = this.width, h = this.height;
    if (this._layout === 'single') {
      this.rects.set('persp', { x: 0, y: 0, w, h });
      return;
    }
    const gutter = 1;
    const w1 = Math.floor((w - gutter) / 2), w2 = w - gutter - w1;
    const h1 = Math.floor((h - gutter) / 2), h2 = h - gutter - h1;
    this.rects.set('persp', { x: 0, y: 0, w: w1, h: h1 });
    this.rects.set('top', { x: w1 + gutter, y: 0, w: w2, h: h1 });
    this.rects.set('front', { x: 0, y: h1 + gutter, w: w1, h: h2 });
    this.rects.set('side', { x: w1 + gutter, y: h1 + gutter, w: w2, h: h2 });
  }

  private toGlY(rect: Rect): number {
    return this.height - rect.y - rect.h;
  }

  private toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const rc = this.renderer.domElement.getBoundingClientRect();
    return { x: clientX - rc.left, y: clientY - rc.top };
  }

  private kindAt(x: number, y: number): ViewportKind | null {
    for (const [kind, rect] of this.rects) {
      if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) return kind;
    }
    return null;
  }

  private panCamera(cam: THREE.Camera, tgt: THREE.Vector3, dx: number, dy: number, worldPerPixel: number): void {
    const fwd = new THREE.Vector3().subVectors(tgt, cam.position).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    tgt.addScaledVector(right, -dx * worldPerPixel).addScaledVector(up, dy * worldPerPixel);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    const local = this.toLocal(e.clientX, e.clientY);
    const kind = this.kindAt(local.x, local.y);
    if (!kind) return;
    if (e.button === 2) {
      e.preventDefault();
      this.drag = { mode: 'pan', kind, lastX: e.clientX, lastY: e.clientY };
      this.renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    if (kind === 'persp' && (e.button === 1 || (e.button === 0 && e.altKey))) {
      e.preventDefault();
      this.drag = { mode: 'orbit', kind, lastX: e.clientX, lastY: e.clientY };
      this.renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    // plain LMB (or anything else): pass through untouched for the tool layer
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.lastX, dy = e.clientY - d.lastY;
    d.lastX = e.clientX; d.lastY = e.clientY;
    if (d.mode === 'orbit') {
      this.persp.vth = -dx * 0.005;
      this.persp.vph = -dy * 0.005;
      return;
    }
    const rect = this.rects.get(d.kind);
    if (!rect) return;
    if (d.kind === 'persp') {
      this.panCamera(this.persp.camera, this.persp.tgt, dx, dy, this.persp.r * 0.0016);
    } else {
      const o = this.orthoFor(d.kind);
      const worldPerPixel = (o.viewSize * 2) / rect.h;
      this.panCamera(o.camera, o.center, dx, dy, worldPerPixel);
      this.repositionOrtho(o);
    }
  };

  private readonly onPointerUp = (): void => { this.drag = null; };

  private readonly onWheel = (e: WheelEvent): void => {
    const local = this.toLocal(e.clientX, e.clientY);
    const kind = this.kindAt(local.x, local.y);
    if (!kind) return;
    e.preventDefault();
    const factor = 1 + Math.sign(e.deltaY) * 0.09;
    if (kind === 'persp') {
      this.persp.r = clamp(this.persp.r * factor, 3, 120);
      return;
    }
    const o = this.orthoFor(kind);
    o.viewSize = clamp(o.viewSize * factor, 0.5, 500);
    const rect = this.rects.get(kind);
    if (rect) this.updateOrthoFrustum(o, rect.w / rect.h);
  };

  private readonly onContextMenu = (e: MouseEvent): void => { e.preventDefault(); };
}
