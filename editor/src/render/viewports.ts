/* Camera rig: one perspective viewport over the whole canvas. Orbit feel
   (damped, MMB or Alt+LMB) is a direct port of the reference viewer's custom
   controller (../viewer/index.html:716-734, 1219-1230); RMB pans, wheel
   zooms. Plain LMB is never touched here — it belongs to the editing tools.
   snapTo() eases the orbit onto a canonical axis view (driven by the view
   cube overlay). The old quad/ortho layout was removed in editor v2. */

import * as THREE from 'three';
import type { Vec3 } from '../core/types';

interface PerspState {
  camera: THREE.PerspectiveCamera;
  th: number; ph: number; r: number;
  tgt: THREE.Vector3;
  vth: number; vph: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const PH_MIN = 0.03, PH_MAX = Math.PI - 0.03;

export class Viewports {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;

  private width = 1;
  private height = 1;

  private readonly persp: PerspState;
  private drag: { mode: 'orbit' | 'pan'; lastX: number; lastY: number } | null = null;
  private snap: { th: number; ph: number } | null = null;

  constructor(container: HTMLElement, renderer: THREE.WebGLRenderer) {
    this.container = container;
    this.renderer = renderer;

    this.persp = {
      camera: new THREE.PerspectiveCamera(40, 1, 0.1, 1200),
      th: 0.7, ph: 1.15, r: 20,
      tgt: new THREE.Vector3(),
      vth: 0, vph: 0,
    };

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);

    this.onResize();
  }

  render(scene: THREE.Scene): void {
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.render(scene, this.persp.camera);
  }

  /** apply orbit damping / snap easing; call once per frame before render() */
  update(_dt: number): void {
    const p = this.persp;
    if (this.snap) {
      const s = this.snap;
      p.th += (s.th - p.th) * 0.22;
      p.ph += (s.ph - p.ph) * 0.22;
      if (Math.abs(s.th - p.th) < 1e-3 && Math.abs(s.ph - p.ph) < 1e-3) {
        p.th = s.th; p.ph = s.ph;
        this.snap = null;
      }
    } else {
      p.th += p.vth; p.ph += p.vph;
      p.vth *= 0.88; p.vph *= 0.88;
    }
    p.ph = clamp(p.ph, PH_MIN, PH_MAX);
    p.camera.position.set(
      p.tgt.x + p.r * Math.sin(p.ph) * Math.sin(p.th),
      p.tgt.y + p.r * Math.cos(p.ph),
      p.tgt.z + p.r * Math.sin(p.ph) * Math.cos(p.th),
    );
    p.camera.lookAt(p.tgt);
  }

  /** the perspective camera — the SSAO prepass renders through it */
  get camera(): THREE.PerspectiveCamera {
    return this.persp.camera;
  }

  /** current orbit angles — the view cube draws from these */
  getOrbit(): { th: number; ph: number } {
    return { th: this.persp.th, ph: this.persp.ph };
  }

  /** ease the orbit to the given angles (canonical views); unwinds theta so
      the rotation takes the short way round */
  snapTo(th: number, ph: number): void {
    const p = this.persp;
    const twoPi = Math.PI * 2;
    let d = (th - p.th) % twoPi;
    if (d > Math.PI) d -= twoPi;
    if (d < -Math.PI) d += twoPi;
    this.snap = { th: p.th + d, ph: clamp(ph, PH_MIN, PH_MAX) };
    p.vth = 0; p.vph = 0;
  }

  /** nudge the orbit by pixel deltas (view-cube drag) */
  orbitBy(dx: number, dy: number): void {
    this.snap = null;
    this.persp.vth = -dx * 0.005;
    this.persp.vph = -dy * 0.005;
  }

  pickRay(clientX: number, clientY: number): { camera: THREE.Camera; ndc: THREE.Vector2 } | null {
    const local = this.toLocal(clientX, clientY);
    if (local.x < 0 || local.y < 0 || local.x >= this.width || local.y >= this.height) return null;
    const ndcX = (local.x / this.width) * 2 - 1;
    const ndcY = -((local.y / this.height) * 2 - 1);
    return { camera: this.persp.camera, ndc: new THREE.Vector2(ndcX, ndcY) };
  }

  fit(bounds: { min: Vec3; max: Vec3 }): void {
    const sizeX = bounds.max[0] - bounds.min[0];
    const sizeY = bounds.max[1] - bounds.min[1];
    const sizeZ = bounds.max[2] - bounds.min[2];
    const diag = Math.hypot(sizeX, sizeY, sizeZ);
    this.persp.tgt.set(
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    );
    this.persp.r = Math.max(diag * 1.35, 8);
  }

  onResize(): void {
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(this.width, this.height, false);
    this.persp.camera.aspect = this.width / this.height;
    this.persp.camera.updateProjectionMatrix();
  }

  dispose(): void {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
  }

  private toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const rc = this.renderer.domElement.getBoundingClientRect();
    return { x: clientX - rc.left, y: clientY - rc.top };
  }

  private panCamera(dx: number, dy: number): void {
    const p = this.persp;
    const cam = p.camera;
    const fwd = new THREE.Vector3().subVectors(p.tgt, cam.position).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const worldPerPixel = p.r * 0.0016;
    p.tgt.addScaledVector(right, -dx * worldPerPixel).addScaledVector(up, dy * worldPerPixel);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button === 2) {
      e.preventDefault();
      this.drag = { mode: 'pan', lastX: e.clientX, lastY: e.clientY };
      this.renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      this.drag = { mode: 'orbit', lastX: e.clientX, lastY: e.clientY };
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
      this.snap = null;
      this.persp.vth = -dx * 0.005;
      this.persp.vph = -dy * 0.005;
      return;
    }
    this.panCamera(dx, dy);
  };

  private readonly onPointerUp = (): void => { this.drag = null; };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = 1 + Math.sign(e.deltaY) * 0.09;
    this.persp.r = clamp(this.persp.r * factor, 3, 120);
  };

  private readonly onContextMenu = (e: MouseEvent): void => { e.preventDefault(); };
}
