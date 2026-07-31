/* View cube overlay: a 2D-canvas navigation gizmo in the top-right corner of
   the stage. Mirrors the orbit live; click a face to snap the camera to that
   axis view (camera stays perspective), drag the cube to orbit, ⌂ fits. */

import type { Viewports } from './viewports';

const SIZE = 92;
const HALF = 0.62;                                   // cube half-side in widget units
const CORNERS: readonly [number, number, number][] = [
  [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
];
interface Face {
  normal: [number, number, number];
  corners: [number, number, number, number];         // CORNERS indices, outward CCW
  label: string;
  /** orbit angles for this view; NaN theta = keep current */
  th: number; ph: number;
}
const P = Math.PI;
const FACES: readonly Face[] = [
  { normal: [1, 0, 0],  corners: [1, 3, 7, 5], label: '+X', th: P / 2, ph: P / 2 },
  { normal: [-1, 0, 0], corners: [4, 6, 2, 0], label: '−X', th: -P / 2, ph: P / 2 },
  { normal: [0, 1, 0],  corners: [2, 6, 7, 3], label: '+Y', th: NaN, ph: 0.031 },
  { normal: [0, -1, 0], corners: [0, 1, 5, 4], label: '−Y', th: NaN, ph: P - 0.031 },
  { normal: [0, 0, 1],  corners: [5, 7, 6, 4], label: '+Z', th: 0, ph: P / 2 },
  { normal: [0, 0, -1], corners: [0, 2, 3, 1], label: '−Z', th: P, ph: P / 2 },
];

export class ViewCube {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly viewports: Viewports;
  private lastTh = NaN;
  private lastPh = NaN;
  private hover: number | null = null;
  private drag: { lastX: number; lastY: number; moved: boolean } | null = null;
  /** screen-space face polygons of the last draw, for hit-testing */
  private facePolys: { face: number; pts: [number, number][] }[] = [];

  constructor(host: HTMLElement, viewports: Viewports, onFit: () => void) {
    this.viewports = viewports;
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.canvas.className = 'viewcube';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    host.appendChild(this.canvas);

    const fit = document.createElement('button');
    fit.type = 'button';
    fit.className = 'viewcube-fit';
    fit.textContent = '⌂';
    fit.title = 'Fit view (F)';
    fit.onclick = onFit;
    host.appendChild(fit);

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.lastTh = NaN; });
  }

  /** call once per frame; redraws only when the orbit moved */
  update(): void {
    const { th, ph } = this.viewports.getOrbit();
    if (th === this.lastTh && ph === this.lastPh) return;
    this.lastTh = th; this.lastPh = ph;
    this.draw(th, ph);
  }

  private project(th: number, ph: number, v: [number, number, number]): [number, number, number] {
    /* view basis of the orbit camera looking at the origin */
    const eye = [Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th)];
    const fwd = [-eye[0], -eye[1], -eye[2]];
    const upW = [0, 1, 0];
    let rx = fwd[1] * upW[2] - fwd[2] * upW[1];
    let ry = fwd[2] * upW[0] - fwd[0] * upW[2];
    let rz = fwd[0] * upW[1] - fwd[1] * upW[0];
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fwd[2] - rz * fwd[1];
    const uy = rz * fwd[0] - rx * fwd[2];
    const uz = rx * fwd[1] - ry * fwd[0];
    return [
      v[0] * rx + v[1] * ry + v[2] * rz,
      -(v[0] * ux + v[1] * uy + v[2] * uz),
      v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2],
    ];
  }

  private draw(th: number, ph: number): void {
    const c = this.ctx;
    c.clearRect(0, 0, SIZE, SIZE);
    const scale = SIZE * 0.30;
    const cx = SIZE / 2, cy = SIZE / 2;
    this.facePolys = [];

    const pts2 = CORNERS.map(v =>
      this.project(th, ph, [v[0] * HALF, v[1] * HALF, v[2] * HALF]));

    const order = FACES
      .map((f, i) => ({ i, dot: this.project(th, ph, f.normal)[2] }))
      .filter(e => e.dot < -0.02)                    // facing the camera
      .sort((a, b) => a.dot - b.dot);

    for (const { i, dot } of order) {
      const f = FACES[i];
      const poly = f.corners.map(ci =>
        [cx + pts2[ci][0] * scale, cy + pts2[ci][1] * scale] as [number, number]);
      this.facePolys.push({ face: i, pts: poly });
      const lit = 0.55 - dot * 0.35;                 // steeper face = brighter
      c.beginPath();
      poly.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fillStyle = this.hover === i
        ? 'rgba(201, 162, 39, 0.45)'
        : `rgba(70, 88, 107, ${(lit * 0.55).toFixed(3)})`;
      c.fill();
      c.strokeStyle = 'rgba(200, 214, 224, 0.5)';
      c.lineWidth = 1;
      c.stroke();
      const mx = poly.reduce((s, p) => s + p[0], 0) / 4;
      const my = poly.reduce((s, p) => s + p[1], 0) / 4;
      c.fillStyle = this.hover === i ? '#0A0E14' : 'rgba(200, 214, 224, 0.85)';
      c.font = '10px Consolas, monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(f.label, mx, my);
    }
  }

  private faceAt(e: PointerEvent): number | null {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    /* front-most face first: facePolys is back-to-front */
    for (let i = this.facePolys.length - 1; i >= 0; i--) {
      const { face, pts } = this.facePolys[i];
      let inside = false;
      for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
        if (((pts[a][1] > y) !== (pts[b][1] > y))
          && (x < (pts[b][0] - pts[a][0]) * (y - pts[a][1]) / (pts[b][1] - pts[a][1]) + pts[a][0]))
          inside = !inside;
      }
      if (inside) return face;
    }
    return null;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    this.drag = { lastX: e.clientX, lastY: e.clientY, moved: false };
    this.canvas.setPointerCapture(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (this.drag) {
      const dx = e.clientX - this.drag.lastX, dy = e.clientY - this.drag.lastY;
      if (Math.hypot(dx, dy) > 1) this.drag.moved = true;
      this.drag.lastX = e.clientX; this.drag.lastY = e.clientY;
      if (this.drag.moved) this.viewports.orbitBy(dx, dy);
      return;
    }
    const f = this.faceAt(e);
    if (f !== this.hover) { this.hover = f; this.lastTh = NaN; }
    this.canvas.style.cursor = f !== null ? 'pointer' : 'grab';
  };

  private readonly onUp = (e: PointerEvent): void => {
    const wasDrag = this.drag?.moved;
    this.drag = null;
    if (wasDrag) return;
    const f = this.faceAt(e);
    if (f === null) return;
    const face = FACES[f];
    const th = Number.isNaN(face.th) ? this.viewports.getOrbit().th : face.th;
    this.viewports.snapTo(th, face.ph);
  };
}
