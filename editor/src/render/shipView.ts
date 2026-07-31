/* Owns the ship's live visuals: the assembled solid, its edge-line overlay,
   the invisible pick mesh, and the editing overlays (selection, ghost
   preview, symmetry plane). Pure orchestration — geometry itself comes from
   geometry.ts / pick.ts; this file just wires builders to scene objects and
   keeps them in sync with doc/options changes via rebuild(). */

import * as THREE from 'three';
import type { Cube, MaterialSlot, ShapeId, ShipDoc, Vec3, Wing } from '../core/types';
import { compSlot } from '../core/materials';
import { HULL_COMP, FACES, WING_RING, corner, rot } from '../core/tables';
import type { GameData } from '../data/loader';
import type { RenderSettings } from '../editor/state';
import type { SceneCtx } from './scene';
import type { MaterialCache } from './materialCache';
import { NAKED_PICK_SCALE, buildShipGeometry } from './geometry';
import { buildPickGeometry } from './pick';
import type { BuildOptions, PickTri } from './geometryTypes';

export type EntityResolver = (uid: number) => Cube | Wing | undefined;

/** placement preview passed to setGhost — not part of the core/render
    contract types, so defined here (single shape or wing instance at a cell). */
export interface GhostSpec {
  x: number;
  y: number;
  z: number;
  shape: ShapeId;
  o: number;
  valid: boolean;
  /** 'wing' previews the actual wing ring instead of a shape solid */
  kind?: 'wing';
  wingKind?: number;
}

const isCube = (e: Cube | Wing): e is Cube => 'shape' in e;

function disposeDrawable(obj: THREE.Object3D): void {
  if (
    obj instanceof THREE.Mesh ||
    obj instanceof THREE.LineSegments ||
    obj instanceof THREE.LineLoop
  ) {
    obj.geometry.dispose();
    const mat = obj.material;
    if (Array.isArray(mat)) mat.forEach(m => m.dispose());
    else mat.dispose();
  }
}

function clearGroup(group: THREE.Group): void {
  for (const child of group.children.slice()) {
    group.remove(child);
    disposeDrawable(child);
  }
}

export class ShipView {
  private doc: ShipDoc | null = null;
  private options: RenderSettings = {
    mode: 'box', chamfer: true, ao: true, textures: true, plates: true,
    plateVariants: { quad: 1, slope: 0, tri: 0, eq: 0 },
    edges: true, compColors: true,
  };

  private mesh: THREE.Mesh | null = null;
  private edgeLines: THREE.LineSegments | null = null;
  private _pickMesh: THREE.Mesh | null = null;
  private _tris: readonly PickTri[] = [];

  private readonly selectionGroup = new THREE.Group();
  private readonly ghostGroup = new THREE.Group();
  private readonly plateGhostGroup = new THREE.Group();
  private readonly symmetryGroup = new THREE.Group();

  constructor(
    private readonly sceneCtx: SceneCtx,
    private readonly cache: MaterialCache,
    private readonly data: GameData,
    private resolveEntity: EntityResolver = () => undefined,
  ) {
    this.sceneCtx.overlayRoot.add(
      this.selectionGroup, this.ghostGroup, this.plateGhostGroup, this.symmetryGroup);
  }

  get pickMesh(): THREE.Mesh | null { return this._pickMesh; }
  get tris(): readonly PickTri[] { return this._tris; }
  /** alias for editor/controller.ts, which was already written against this name */
  get pickTris(): readonly PickTri[] { return this._tris; }

  /** wire uid -> entity lookups without importing ShipModel (keeps render decoupled) */
  setResolver(fn: EntityResolver): void { this.resolveEntity = fn; }

  setDoc(doc: ShipDoc | null): void { this.doc = doc; }

  setOptions(o: RenderSettings): void { this.options = o; }

  rebuild(): void {
    this.disposeShipMeshes();
    if (!this.doc) return;
    const doc = this.doc;

    const opts: BuildOptions = {
      mode: this.options.mode,
      chamfer: this.options.chamfer,
      ao: this.options.ao,
      textures: this.options.textures,
      plates: this.options.plates,
      plateVariants: this.options.plateVariants,
    };
    const built = buildShipGeometry(doc, this.data, opts);
    const textured = opts.mode === 'plate' && opts.textures;
    const materials = built.groupSlots.map((slot, i) => {
      const resolved: MaterialSlot =
        slot !== 'wing' && !this.options.compColors ? compSlot(HULL_COMP) : slot;
      const map = built.groupTex[i] ?? null;
      /* system_colors carries the 2014 engine's own system palette — tinting
         it would recolour the modules it exists to colour */
      return this.cache.get(resolved, {
        textured, map, untinted: map === 'system_colors.png' && this.options.compColors,
      });
    });

    const mesh = new THREE.Mesh(built.geometry, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.sceneCtx.shipRoot.add(mesh);
    this.mesh = mesh;

    if (this.options.edges && built.edges) {
      const eg = new THREE.EdgesGeometry(built.edges, built.edgesThreshold);
      const lines = new THREE.LineSegments(
        eg,
        new THREE.LineBasicMaterial({ color: 0xb8cbd9, transparent: true, opacity: 0.18 }),
      );
      this.sceneCtx.shipRoot.add(lines);
      this.edgeLines = lines;
    }

    const picked = buildPickGeometry(doc, this.options.mode === 'naked' ? NAKED_PICK_SCALE : 1);
    const pickMesh = new THREE.Mesh(picked.geometry, new THREE.MeshBasicMaterial());
    pickMesh.visible = false;
    this.sceneCtx.shipRoot.add(pickMesh);
    this._pickMesh = pickMesh;
    this._tris = picked.tris;
  }

  /** over doc cubes + wings cells; each cell spans [x,x+1) per axis */
  boundsOfDoc(): { min: Vec3; max: Vec3 } | null {
    const doc = this.doc;
    if (!doc || (doc.cubes.length === 0 && doc.wings.length === 0)) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const e of [...doc.cubes, ...doc.wings]) {
      minX = Math.min(minX, e.x); minY = Math.min(minY, e.y); minZ = Math.min(minZ, e.z);
      maxX = Math.max(maxX, e.x + 1); maxY = Math.max(maxY, e.y + 1); maxZ = Math.max(maxZ, e.z + 1);
    }
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }

  setSelection(uids: Set<number>): void {
    clearGroup(this.selectionGroup);
    for (const uid of uids) {
      const e = this.resolveEntity(uid);
      if (!e) continue;
      this.selectionGroup.add(isCube(e) ? this.buildCellBox(e.x, e.y, e.z) : this.buildWingRing(e));
    }
  }

  setGhost(g: GhostSpec | null): void {
    clearGroup(this.ghostGroup);
    if (!g) return;
    const color = g.valid ? 0x4a90d9 : 0xd64545;
    const loops: (readonly number[])[] = g.kind === 'wing'
      ? (WING_RING[g.wingKind ?? 0] ? [WING_RING[g.wingKind ?? 0]] : [])
      : [...FACES[g.shape]];
    const pos: number[] = [];
    const outline: number[] = [];
    for (const loop of loops) {
      const verts = loop.map(ci => {
        const p = rot(g.o, corner(ci));
        return [p[0] + g.x, p[1] + g.y, p[2] + g.z] as const;
      });
      for (let i = 1; i < verts.length - 1; i++) pos.push(...verts[0], ...verts[i], ...verts[i + 1]);
      for (let i = 0; i < verts.length; i++)
        outline.push(...verts[i], ...verts[(i + 1) % verts.length]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.45, depthTest: true, side: THREE.DoubleSide,
    });
    this.ghostGroup.add(new THREE.Mesh(geo, mat));
    /* crisp contour so orientation reads even against same-hue hull */
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
    this.ghostGroup.add(new THREE.LineSegments(lgeo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })));
  }

  /** plate-tool preview: the plate as it would sit on the hovered face —
      blue when a click would mount it, brass over an existing plate */
  setPlateGhost(positions: number[] | null, wouldAdd: boolean): void {
    clearGroup(this.plateGhostGroup);
    if (!positions || !positions.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    this.plateGhostGroup.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: wouldAdd ? 0x4a90d9 : 0xc9a227,
      transparent: true, opacity: wouldAdd ? 0.5 : 0.35,
      depthTest: true, side: THREE.DoubleSide,
    })));
  }

  setSymmetryPlane(planeX2: number | null): void {
    clearGroup(this.symmetryGroup);
    if (planeX2 === null) return;
    const bounds = this.boundsOfDoc();
    const margin = 2;
    const sizeY = bounds ? bounds.max[1] - bounds.min[1] + margin * 2 : 20;
    const sizeZ = bounds ? bounds.max[2] - bounds.min[2] + margin * 2 : 20;
    const cy = bounds ? (bounds.min[1] + bounds.max[1]) / 2 : 0;
    const cz = bounds ? (bounds.min[2] + bounds.max[2]) / 2 : 0;
    const geo = new THREE.PlaneGeometry(sizeZ, sizeY);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4a90d9, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(planeX2 / 2, cy, cz);
    this.symmetryGroup.add(mesh);
  }

  /** release everything this view owns; the ShipView itself is done after this */
  dispose(): void {
    this.disposeShipMeshes();
    clearGroup(this.selectionGroup);
    clearGroup(this.ghostGroup);
    clearGroup(this.symmetryGroup);
    this.sceneCtx.overlayRoot.remove(this.selectionGroup, this.ghostGroup, this.symmetryGroup);
  }

  private buildCellBox(x: number, y: number, z: number): THREE.LineSegments {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
    const seg = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc9a227 }));
    seg.position.set(x + 0.5, y + 0.5, z + 0.5);
    return seg;
  }

  private buildWingRing(w: Wing): THREE.LineLoop {
    const ring = WING_RING[w.kind] ?? [];
    const verts = ring.map(ci => {
      const p = rot(w.o, corner(ci));
      return [p[0] + w.x, p[1] + w.y, p[2] + w.z] as const;
    });
    const n = Math.max(verts.length, 1);
    const cx = verts.reduce((s, v) => s + v[0], 0) / n;
    const cy = verts.reduce((s, v) => s + v[1], 0) / n;
    const cz = verts.reduce((s, v) => s + v[2], 0) / n;
    const pos: number[] = [];
    for (const v of verts) pos.push(cx + (v[0] - cx) * 1.02, cy + (v[1] - cy) * 1.02, cz + (v[2] - cz) * 1.02);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xc9a227 }));
  }

  private disposeShipMeshes(): void {
    if (this.mesh) {
      this.sceneCtx.shipRoot.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
      // materials are cache-owned — never disposed here
    }
    if (this.edgeLines) {
      this.sceneCtx.shipRoot.remove(this.edgeLines);
      this.edgeLines.geometry.dispose();
      (this.edgeLines.material as THREE.Material).dispose();
      this.edgeLines = null;
    }
    if (this._pickMesh) {
      this.sceneCtx.shipRoot.remove(this._pickMesh);
      this._pickMesh.geometry.dispose();
      (this._pickMesh.material as THREE.Material).dispose();
      this._pickMesh = null;
      this._tris = [];
    }
  }
}
