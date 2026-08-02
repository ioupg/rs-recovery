/* Small always-on preview of the piece about to be placed: current shape (or
   wing ring) at the current orientation, with fixed world axes (dim) and the
   piece's rotated local axes (bright) so the orientation reads at a glance.
   Renders on demand only — no animation loop. */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  PREVIEW_ENV_INTENSITY, applyEnvironment, environmentTexture, subscribeEnvironment,
} from './environment';
import type { LibMaterial, ShapeId } from '../core/types';
import { FACES, WING_RING, corner, rotDir } from '../core/tables';
import { applyLibMaterial } from './libMaterial';

export interface PreviewSpec {
  kind: 'cube' | 'wing';
  shape: ShapeId;
  wingKind: number;
  o: number;
  color: string;
}

const AXIS_COLORS = [0xd64545, 0x6ba368, 0x4a90d9];   // x red · y green · z blue

function axisLines(len: number, opacity: number, o?: number): THREE.Group {
  const g = new THREE.Group();
  for (let a = 0; a < 3; a++) {
    const dir: [number, number, number] = [0, 0, 0];
    dir[a] = 1;
    const d = o === undefined ? dir : rotDir(o, dir);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',
      new THREE.Float32BufferAttribute([0, 0, 0, d[0] * len, d[1] * len, d[2] * len], 3));
    /* toneMapped false everywhere a material carries a UI hue: the axis
       red/green/blue must render exactly, not through the PBR output curve */
    g.add(new THREE.Line(geo,
      new THREE.LineBasicMaterial({ color: AXIS_COLORS[a], transparent: true, opacity, toneMapped: false })));
    /* arrow head as a small cone */
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.045 * len, 0.14 * len, 6),
      new THREE.MeshBasicMaterial({ color: AXIS_COLORS[a], transparent: true, opacity, toneMapped: false }));
    cone.position.set(d[0] * len, d[1] * len, d[2] * len);
    cone.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(d[0], d[1], d[2]));
    g.add(cone);
  }
  return g;
}

export class ShapePreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private content = new THREE.Group();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    /* same output transform as the main viewport (scene.ts) or the preview
       stops matching what gets placed */
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    this.camera.position.set(1.9, 1.5, 2.4);
    this.camera.lookAt(0, -0.05, 0);
    this.scene.add(new THREE.HemisphereLight(0x9fb6c9, 0x2a3542, 1.1));
    const key = new THREE.DirectionalLight(0xfff2dc, 1.2);
    key.position.set(3, 5, 2);
    this.scene.add(key);
    this.scene.add(this.content);
    /* fixed world axes, dim, from the cell's min corner */
    const world = axisLines(0.75, 0.35);
    world.position.set(-0.62, -0.62, -0.62);
    this.scene.add(world);
  }

  /** re-render at current canvas CSS size */
  update(spec: PreviewSpec): void {
    for (const child of this.content.children.slice()) {
      this.content.remove(child);
      child.traverse(o3 => {
        const d = o3 as THREE.Mesh;
        if (d.geometry) d.geometry.dispose();
        if (d.material) (Array.isArray(d.material) ? d.material : [d.material]).forEach(m => m.dispose());
      });
    }

    const loops: (readonly number[])[] = spec.kind === 'wing'
      ? (WING_RING[spec.wingKind] ? [WING_RING[spec.wingKind]] : [])
      : [...FACES[spec.shape]];
    const pos: number[] = [];
    const outline: number[] = [];
    for (const loop of loops) {
      const verts = loop.map(ci => {
        const c = corner(ci);
        return rotDir(spec.o, [c[0] - 0.5, c[1] - 0.5, c[2] - 0.5]);
      });
      for (let i = 1; i < verts.length - 1; i++)
        pos.push(...verts[0], ...verts[i], ...verts[i + 1]);
      for (let i = 0; i < verts.length; i++)
        outline.push(...verts[i], ...verts[(i + 1) % verts.length]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();          // non-indexed → flat per-face normals
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: spec.color, roughness: 0.7, metalness: 0.15,
      side: THREE.DoubleSide, flatShading: true,
      transparent: spec.kind === 'wing', opacity: spec.kind === 'wing' ? 0.8 : 1,
    }));
    this.content.add(mesh);
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
    this.content.add(new THREE.LineSegments(lgeo,
      new THREE.LineBasicMaterial({ color: 0xb8cbd9, transparent: true, opacity: 0.5, toneMapped: false })));
    /* the piece's own axes, rotated with it — this IS the orientation display */
    this.content.add(axisLines(0.95, 0.95, spec.o));

    const w = this.canvas.clientWidth || 220, h = this.canvas.clientHeight || 170;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

/* ── shared thumbnail renderer ──────────────────────────────────
   One hidden canvas + renderer for every picker thumbnail in the UI
   (browsers cap WebGL contexts, so per-thumbnail renderers are not an
   option). Renders synchronously and hands back a data URL. */

export interface ThumbSpec {
  kind: 'cube' | 'wing' | 'mesh';
  shape?: ShapeId;
  wingKind?: number;
  o?: number;
  color: string;
  /** raw cell-space submeshes for kind 'mesh' (plates, cages) */
  sub?: { pos: number[]; nrm?: number[]; idx: number[] }[];
  /** turn the mesh 180° about Y first — plates author their relief to −z,
      which would otherwise face away from the thumbnail camera */
  flip?: boolean;
}

let thumb: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  content: THREE.Group;
} | null = null;

function thumbCtx(size: number) {
  if (!thumb) {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.toneMapping = THREE.NeutralToneMapping;   // match the viewport
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(1.9, 1.5, 2.4);
    camera.lookAt(0, -0.03, 0);
    scene.add(new THREE.HemisphereLight(0x9fb6c9, 0x2a3542, 1.15));
    const key = new THREE.DirectionalLight(0xfff2dc, 1.2);
    key.position.set(3, 5, 2);
    scene.add(key);
    const content = new THREE.Group();
    scene.add(content);
    thumb = { renderer, scene, camera, content };
  }
  thumb.renderer.setSize(size, size, false);
  return thumb;
}

/** render a picker thumbnail; synchronous, returns a PNG data URL */
export function renderThumbnail(spec: ThumbSpec, size = 56): string {
  const t = thumbCtx(size);
  for (const child of t.content.children.slice()) {
    t.content.remove(child);
    child.traverse(o3 => {
      const d = o3 as THREE.Mesh;
      if (d.geometry) d.geometry.dispose();
      if (d.material) (Array.isArray(d.material) ? d.material : [d.material]).forEach(m => m.dispose());
    });
  }

  const material = new THREE.MeshStandardMaterial({
    color: spec.color, roughness: 0.7, metalness: 0.15,
    side: THREE.DoubleSide, flatShading: true,
  });

  if (spec.kind === 'mesh' && spec.sub) {
    /* cell-space mesh, centered; scaled so its bounding diagonal reads well */
    const pos: number[] = [];
    for (const s of spec.sub)
      for (const i of s.idx)
        pos.push(s.pos[i * 3] - 0.5, s.pos[i * 3 + 1] - 0.5, s.pos[i * 3 + 2] - 0.5);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const c = bb.getCenter(new THREE.Vector3());
    const ext = bb.getSize(new THREE.Vector3()).length() || 1;
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(c.negate());
    /* schematic linework, same voice as the shape/wing thumbnails */
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo, 25),
      new THREE.LineBasicMaterial({ color: 0xb8cbd9, transparent: true, opacity: 0.6, toneMapped: false }));
    edges.position.copy(mesh.position);
    const wrap = new THREE.Group();
    wrap.add(mesh, edges);
    if (spec.flip) wrap.rotation.y = Math.PI;
    wrap.scale.setScalar(1.55 / ext);
    t.content.add(wrap);
  } else {
    const loops: (readonly number[])[] = spec.kind === 'wing'
      ? (WING_RING[spec.wingKind ?? 0] ? [WING_RING[spec.wingKind ?? 0]] : [])
      : [...FACES[spec.shape ?? 0]];
    const pos: number[] = [];
    const outline: number[] = [];
    for (const loop of loops) {
      const verts = loop.map(ci => {
        const c = corner(ci);
        return rotDir(spec.o ?? 0, [c[0] - 0.5, c[1] - 0.5, c[2] - 0.5]);
      });
      for (let i = 1; i < verts.length - 1; i++)
        pos.push(...verts[0], ...verts[i], ...verts[i + 1]);
      for (let i = 0; i < verts.length; i++)
        outline.push(...verts[i], ...verts[(i + 1) % verts.length]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    if (spec.kind === 'wing') { material.transparent = true; material.opacity = 0.85; }
    t.content.add(new THREE.Mesh(geo, material));
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
    t.content.add(new THREE.LineSegments(lgeo,
      new THREE.LineBasicMaterial({ color: 0xb8cbd9, transparent: true, opacity: 0.6, toneMapped: false })));
  }

  t.renderer.render(t.scene, t.camera);
  return t.renderer.domElement.toDataURL();
}

/* ── material library previews ──────────────────────────────────
   The picker thumbnails above are flat-lit (Hemisphere + one key light) —
   fine for reading shape/orientation but not enough for a metal library
   material to look like anything. These get a PMREM environment so
   metalness/roughness/clearcoat actually read. */

/** A preview sphere wraps the whole texture once around its equator while
    the preview cube shows roughly one tile per face — wildly different texel
    densities for the same material. Boosting the sphere's UV repeat ~3×
    (equator ≈ 4 cube faces, pole-to-pole ≈ 2; a uniform 3 splits the
    difference) makes sphere, cube and thumbnails read the material at
    comparable scale. */
const SPHERE_UV_BOOST = 3;
const sphereUv = (mat: LibMaterial): LibMaterial =>
  ({ ...mat, uvScale: mat.uvScale * SPHERE_UV_BOOST });

/** built once, lazily, directly on the shared thumb scene above — every
    thumbnail (shape/wing/mesh included) picks up the same ambient reflection
    afterwards, which is the point: one consistent lighting rig, one shared
    WebGL context (browsers cap how many a page may open). */
let thumbEnvBuilt = false;
function ensureThumbEnv(t: ReturnType<typeof thumbCtx>): void {
  if (thumbEnvBuilt) return;
  thumbEnvBuilt = true;
  applyEnvironment(t.renderer, t.scene);
  t.scene.environmentIntensity = PREVIEW_ENV_INTENSITY;
  /* thumbnails are pulled by their consumers — this only keeps the shared
     scene current; the environment change event tells consumers to re-pull */
  subscribeEnvironment(() => applyEnvironment(t.renderer, t.scene));
}

/** one persistent sphere + material for every material thumbnail — a fresh
    material per call would compile (and, on dispose, destroy) its shader
    program every single time; patching one instance in place reuses the
    program exactly like the cached ship materials do. Lives directly on the
    thumb scene, hidden outside renders. */
let matThumb: { mesh: THREE.Mesh; material: THREE.MeshPhysicalMaterial } | null = null;

/** render a material library thumbnail: a sphere under the shared thumbnail
    renderer, synchronous, returns a PNG data URL */
export function renderMaterialThumb(mat: LibMaterial, size = 56): string {
  const t = thumbCtx(size);
  ensureThumbEnv(t);

  if (!matThumb) {
    const material = new THREE.MeshPhysicalMaterial();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.85, 48, 32), material);
    mesh.visible = false;
    t.scene.add(mesh);
    matThumb = { mesh, material };
  }
  applyLibMaterial(matThumb.material, sphereUv(mat),
    { map: environmentTexture(t.renderer), intensity: PREVIEW_ENV_INTENSITY });

  /* shape/wing thumbnails leave their meshes parented under content between
     calls — hide the group so they can't photobomb the material sphere */
  t.content.visible = false;
  matThumb.mesh.visible = true;
  t.renderer.render(t.scene, t.camera);
  const url = t.renderer.domElement.toDataURL();
  matThumb.mesh.visible = false;
  t.content.visible = true;
  return url;
}

/** modal-sized orbitable material preview — its own renderer/scene/camera
    (a picker-sized canvas is worth a dedicated WebGL context, unlike the
    swarm of list thumbnails above). Render-on-demand only: the caller drives
    every frame via update()/setShape() or its own pointer-drag handling.

    SINGLETON via acquireMaterialPreview(): three r185's renderer.dispose()
    does not release the GL context, and the shared cache-owned textures keep
    dispose listeners that pin a "disposed" renderer forever — so an instance
    per modal open permanently leaks a WebGL context each time, and Chrome
    evicts the oldest context (the main viewport) once it hits its cap. The
    one instance owns its canvas; callers re-parent it and never dispose. */
export class MaterialPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private material = new THREE.MeshPhysicalMaterial();
  private mesh: THREE.Mesh;
  private shape: 'sphere' | 'cube' = 'sphere';
  private mat: LibMaterial | null = null;

  private azimuth = 0.6;
  private elevation = 0.3;
  private readonly radius = 2.4;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor() {
    const canvas = document.createElement('canvas');
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;   // match the viewport
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);

    applyEnvironment(this.renderer, this.scene);
    this.scene.environmentIntensity = PREVIEW_ENV_INTENSITY;
    /* singleton, never disposed — the subscription lives for the app.
       update() re-binds the material's own envMap to the new selection */
    subscribeEnvironment(() => {
      applyEnvironment(this.renderer, this.scene);
      if (this.mat) this.update(this.mat);
      else this.render();
    });

    this.scene.add(new THREE.HemisphereLight(0x9fb6c9, 0x2a3542, 1.0));
    const key = new THREE.DirectionalLight(0xfff2dc, 1.2);
    key.position.set(3, 5, 2);
    this.scene.add(key);

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.7, 48, 32), this.material);
    this.scene.add(this.mesh);
    this.updateCamera();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerUp);

    this.render();
  }

  /** re-apply the material in place (one live instance, patched — same
      invariant as the cached ship materials) and render. The sphere gets the
      UV boost so both shapes show the texture at comparable density. */
  update(mat: LibMaterial): void {
    this.mat = mat;
    applyLibMaterial(this.material, this.shape === 'sphere' ? sphereUv(mat) : mat,
      { map: environmentTexture(this.renderer), intensity: PREVIEW_ENV_INTENSITY });
    this.render();
  }

  setShape(s: 'sphere' | 'cube'): void {
    if (s === this.shape) return;
    this.shape = s;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    const geo = s === 'sphere'
      ? new THREE.SphereGeometry(0.7, 48, 32)
      : new RoundedBoxGeometry(1.1, 1.1, 1.1, 4, 0.06);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.scene.add(this.mesh);
    if (this.mat) this.update(this.mat);
    else this.render();
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.azimuth -= dx * 0.008;
    this.elevation = Math.max(-1.35, Math.min(1.35, this.elevation + dy * 0.008));
    this.updateCamera();
    this.render();
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };

  private updateCamera(): void {
    const r = this.radius;
    this.camera.position.set(
      r * Math.cos(this.elevation) * Math.sin(this.azimuth),
      r * Math.sin(this.elevation),
      r * Math.cos(this.elevation) * Math.cos(this.azimuth),
    );
    this.camera.lookAt(0, 0, 0);
  }

  private render(): void {
    const w = this.canvas.clientWidth || 260, h = this.canvas.clientHeight || 260;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }
}

let materialPreview: MaterialPreview | null = null;

/** the one MaterialPreview for the session (see the class doc for why per-
    open instances are a context leak). The caller re-parents .canvas into its
    own DOM; closing the modal just detaches it — never dispose. */
export function acquireMaterialPreview(): MaterialPreview {
  materialPreview ??= new MaterialPreview();
  return materialPreview;
}
