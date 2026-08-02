/* Ship geometry builders — ports of the validated renderer in
   ../viewer/index.html (facet collect+cull, mesh-mode shells/cages/plates,
   plate mode, wings — the two stay in lockstep).
   See ARCHITECTURE.md for mode semantics.

   Deviation from the reference, by design: the viewer bakes the compartment
   tint into the vertex colour and draws everything with one material. Here the
   tint lives in the per-slot material and the triangles are bucketed by
   MaterialSlot into contiguous geometry groups. The vertex colour is a data
   channel, not a colour: R carries baked occupancy AO, G carries facet tone x
   brightness, B is unused (1). The ssao.ts material patch routes R through
   three's occlusion path (indirect diffuse + specular — combined with the
   screen-space AO) and multiplies only G into albedo; GLB export bakes RxG
   back to grayscale for external viewers (exportGlb.ts). */

import * as THREE from 'three';
import type { MaterialSlot, ShapeId, ShipDoc } from '../core/types';
import { WING_SLOT } from '../core/types';
import {
  AXIS_FACE_KIND, HULL_COMP, ORIENTATIONS, SLOT_AXES, WING_RING,
  corner, plateCanonical, plateFaceDir, rot,
} from '../core/tables';
import { compSlot } from '../core/materials';
import type { GameData, PlateMeshEntry } from '../data/loader';
import type { BuildOptions, BuiltShip, PlateVariants } from './geometryTypes';
import { occupancyOf, vertexAO, type Occupancy } from './ao';
import { BLANK_UV, atlasUV } from './atlas';
import {
  centroid, collectFacets, cross, cullFacets, dot, facetNormal, len, norm, orient, sub,
  type V3,
} from './facets';
import { emitExtras } from './extras';

/* Flush composition (the engine's own scheme, measured from the =default
   parts): every part is authored exactly in the unit cell and mates exactly
   on the cell boundary planes — plates cover the whole face with their back
   in the face plane, shells put their rims in the face planes, cages mount
   at full size. Coincident surfaces always face opposite ways, so mesh mode
   renders FrontSide and nothing fights; there are no insets or margins.
   naked mode keeps a cosmetic cage shrink so rays and eyes slip between
   cells in the systems view. */
const NAKED_MODULE_SCALE = 0.88;
const MODULE_BRIGHT = 0.78, PLATE_BRIGHT = 1.06;

/** compartment → material slot; malformed compartments fall back to hull.
    No upper clamp — the slot key is open-ended and the material store falls
    back to hull for slots no registered system backs. */
const slotOf = (comp: number): MaterialSlot =>
  compSlot(Number.isInteger(comp) && comp >= 0 ? comp : HULL_COMP);

/** group order: systems by id, wing last */
const slotOrder = (slot: MaterialSlot): number =>
  slot === WING_SLOT ? Number.MAX_SAFE_INTEGER : Number(slot.slice(4));

interface Bin { slot: MaterialSlot; tex: string | null; pos: number[]; nrm: number[]; col: number[]; uv: number[] }

/** Triangle sink that keeps each (material slot, archive texture) contiguous,
    so one non-indexed BufferGeometry can carry one group per material. tex is
    always null outside textured mesh mode, collapsing to one group per slot —
    identical output to the parity-verified untextured build. */
class SlotBuckets {
  private readonly bins = new Map<string, Bin>();
  constructor(private readonly uvOn: boolean) {}

  vertex(
    slot: MaterialSlot, p: readonly number[], n: readonly number[],
    ao: number, tone: number,
    uv?: readonly [number, number], tex: string | null = null,
  ): void {
    const key = `${slot} ${tex ?? ''}`;
    let b = this.bins.get(key);
    if (!b) { b = { slot, tex, pos: [], nrm: [], col: [], uv: [] }; this.bins.set(key, b); }
    b.pos.push(p[0], p[1], p[2]);
    b.nrm.push(n[0], n[1], n[2]);
    b.col.push(ao, tone, 1);
    if (this.uvOn) b.uv.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
  }

  /** Fan-triangulate a loop, flat-shaded (viewer 1010-1019). The normal is
      taken per triangle from its own winding and flipped to agree with the
      facet's outward normal: chamfer corner patches are not planar, so one
      normal for the whole fan would shade them wrong (the reference gets this
      from computeVertexNormals over its non-indexed soup, then relies on
      double-sided shading for the sign — we settle the sign here instead). */
  fan(
    slot: MaterialSlot, vs: readonly V3[], n: V3,
    ao: (i: number) => number, tone: number,
    uv?: (i: number) => readonly [number, number],
    tex: string | null = null,
  ): void {
    for (let i = 1; i < vs.length - 1; i++) {
      const w = cross(sub(vs[i], vs[0]), sub(vs[i + 1], vs[0]));
      let tn = n;
      if (len(w) > 1e-12) { tn = norm(w); if (dot(tn, n) < 0) tn = [-tn[0], -tn[1], -tn[2]]; }
      for (const j of [0, i, i + 1])
        this.vertex(slot, vs[j], tn, ao(j), tone, uv ? uv(j) : undefined, tex);
    }
  }

  build(): { geometry: THREE.BufferGeometry; groupSlots: MaterialSlot[]; groupTex: (string | null)[] } {
    const used = [...this.bins.values()]
      .filter(b => b.pos.length > 0)
      .sort((a, b2) => (slotOrder(a.slot) - slotOrder(b2.slot))
        || (a.tex ?? '').localeCompare(b2.tex ?? ''));
    const n = used.reduce((s, e) => s + e.pos.length, 0);
    const pos = new Float32Array(n), nrm = new Float32Array(n), col = new Float32Array(n);
    const uv = new Float32Array(this.uvOn ? (n / 3) * 2 : 0);
    const geometry = new THREE.BufferGeometry();
    const groupSlots: MaterialSlot[] = [];
    const groupTex: (string | null)[] = [];
    let off = 0, uvOff = 0;
    for (const bin of used) {
      pos.set(bin.pos, off); nrm.set(bin.nrm, off); col.set(bin.col, off);
      if (this.uvOn) { uv.set(bin.uv, uvOff); uvOff += bin.uv.length; }
      geometry.addGroup(off / 3, bin.pos.length / 3, groupSlots.length);
      groupSlots.push(bin.slot);
      groupTex.push(bin.tex);
      off += bin.pos.length;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (this.uvOn) geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return { geometry, groupSlots, groupTex };
  }
}

/** deterministic per-facet jitter, ±6% (viewer 979-983) */
function facetTone(k: string): number {
  let h = 2166136261;
  for (const ch of k) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return 0.94 + ((h >>> 8) % 1000) / 1000 * 0.12;
}

/** loops → non-indexed triangle soup, the EdgesGeometry input */
function fanGeometry(loops: readonly (readonly V3[])[]): THREE.BufferGeometry {
  let n = 0;
  for (const vs of loops) n += Math.max(0, vs.length - 2) * 9;
  const pos = new Float32Array(n);
  let o = 0;
  for (const vs of loops)
    for (let i = 1; i < vs.length - 1; i++)
      for (const j of [0, i, i + 1]) { pos.set(vs[j], o); o += 3; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

/* ── wings: a flat polygon spanning cube corners, per the engine's own tables.
      Zero thickness is faithful to the data, so occlude both sides and average
      (viewer 1053-1096). Present in every render mode. ── */
function addWings(
  b: SlotBuckets, doc: ShipDoc, occ: Occupancy, aoOn: boolean, uvOn: boolean,
  solar = false,
): V3[][] {
  const loops: V3[][] = [];
  for (const el of doc.wings) {
    const ring = WING_RING[el.kind];
    if (!ring || ring.length < 3 || !ORIENTATIONS[el.o]) continue;
    const vs = ring.map(ci => {
      const p = rot(el.o, corner(ci));
      return [p[0] + el.x, p[1] + el.y, p[2] + el.z] as V3;
    });
    const n = facetNormal(vs);
    const flip: V3 = [-n[0], -n[1], -n[2]];
    /* a wing is open on both sides, so occlude it symmetrically */
    const wao = vs.map(v => (vertexAO(v, n, occ, null) + vertexAO(v, flip, occ, null)) / 2);
    /* solar skin: planar world-scale UVs so the cell grid tiles per hull cell */
    const e1 = norm(sub(vs[1], vs[0])), e2 = cross(n, e1);
    const uvFn = solar && uvOn
      ? (i: number): [number, number] =>
          [dot(sub(vs[i], vs[0]), e1), dot(sub(vs[i], vs[0]), e2)]
      : uvOn ? () => BLANK_UV as [number, number] : undefined;
    b.fan('wing', vs, n, i => (aoOn ? wao[i] : 1), 1, uvFn, solar && uvOn ? 'wing_solar' : null);
    loops.push(vs);
  }
  return loops;
}

/* ── mesh mode: the decoded part meshes in place of the procedural hull ──
      Each cube shape was matched to a decoded mesh by corner set, authored in
      the unit cell, so it rides the same rotate-about-centre transform the
      facets use (viewer 800-831). The whole frame is emitted for every cube,
      the engine's way: rims meeting at a shared boundary are coplanar but
      opposite-facing, which FrontSide rendering resolves per pixel — the old
      per-face rim cull existed only for DoubleSide z-fighting. ── */
function addShells(
  b: SlotBuckets, doc: ShipDoc, data: GameData, occ: Occupancy, aoOn: boolean,
  texOn: boolean,
): void {
  for (const cb of doc.cubes) {
    const sm = data.shapeMesh[String(cb.shape)];
    const M = ORIENTATIONS[cb.o];
    if (!sm || !M) continue;
    const own = `${cb.x},${cb.y},${cb.z}`;
    const slot = slotOf(cb.comp);
    for (const s of sm.sub) {
      if (!s.nrm) continue;
      const stex = texOn ? (s.tex?.[0] ?? null) : null;
      for (const i of s.idx) {
        const p = [s.pos[i * 3] - 0.5, s.pos[i * 3 + 1] - 0.5, s.pos[i * 3 + 2] - 0.5];
        const w: V3 = [
          M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + 0.5 + cb.x,
          M[3] * p[0] + M[4] * p[1] + M[5] * p[2] + 0.5 + cb.y,
          M[6] * p[0] + M[7] * p[1] + M[8] * p[2] + 0.5 + cb.z,
        ];
        const n0 = [s.nrm[i * 3], s.nrm[i * 3 + 1], s.nrm[i * 3 + 2]];
        const n: V3 = [
          M[0] * n0[0] + M[1] * n0[1] + M[2] * n0[2],
          M[3] * n0[0] + M[4] * n0[1] + M[5] * n0[2],
          M[6] * n0[0] + M[7] * n0[1] + M[8] * n0[2],
        ];
        b.vertex(slot, w, n, aoOn ? vertexAO(w, n, occ, own) : 1, 1,
          texOn && s.uv ? [s.uv[i * 2], s.uv[i * 2 + 1]] : undefined, stex);
      }
    }
  }
}

/* interior module cage per system cube — Systems view only. The cage meshes
   are cube-authored, but a compartment is a logical property that can sit on
   any shape, so cages never join a dressed render (they would clip through a
   prismatic shell). Drawn shrunk so cells read apart and rays slip between. */
function addModules(
  b: SlotBuckets, doc: ShipDoc, data: GameData, occ: Occupancy, aoOn: boolean,
  texOn: boolean, includeHull = false, moduleScale = 1,
): void {
  const N = data.moduleMesh.length;
  if (!N) return;
  for (const cb of doc.cubes) {
    /* plain hull carries no system — it reads from the silhouette */
    if (cb.comp === HULL_COMP && !includeHull) continue;
    /* index = compartment id: cages are name-bound to systems since the
       resource-id crack (m1*power=comp0 … m1*cargo=comp9); registered systems
       (id ≥ 10) resolve their cage by name through the registry */
    const mm = data.moduleMesh[cb.comp]
      ?? (() => {
        const cage = data.systems.byId(cb.comp)?.cage;
        return cage ? data.moduleByName?.[cage] ?? null : null;
      })();
    const M = ORIENTATIONS[cb.o];
    if (!mm || !M) continue;
    const own = `${cb.x},${cb.y},${cb.z}`;
    const slot = slotOf(cb.comp);
    for (const s of mm.sub) {
      if (!s.nrm) continue;
      const stex = texOn ? (s.tex?.[0] ?? null) : null;
      for (const i of s.idx) {
        const p0 = [
          (s.pos[i * 3] - 0.5) * moduleScale,
          (s.pos[i * 3 + 1] - 0.5) * moduleScale,
          (s.pos[i * 3 + 2] - 0.5) * moduleScale,
        ];
        const w: V3 = [
          M[0] * p0[0] + M[1] * p0[1] + M[2] * p0[2] + 0.5 + cb.x,
          M[3] * p0[0] + M[4] * p0[1] + M[5] * p0[2] + 0.5 + cb.y,
          M[6] * p0[0] + M[7] * p0[1] + M[8] * p0[2] + 0.5 + cb.z,
        ];
        const n0 = [s.nrm[i * 3], s.nrm[i * 3 + 1], s.nrm[i * 3 + 2]];
        const n: V3 = [
          M[0] * n0[0] + M[1] * n0[1] + M[2] * n0[2],
          M[3] * n0[0] + M[4] * n0[1] + M[5] * n0[2],
          M[6] * n0[0] + M[7] * n0[1] + M[8] * n0[2],
        ];
        b.vertex(slot, w, n, aoOn ? vertexAO(w, n, occ, own) : 1, MODULE_BRIGHT,
          texOn && s.uv ? [s.uv[i * 2], s.uv[i * 2 + 1]] : undefined, stex);
      }
    }
  }
}

/* ── decoration plates: authored on a unit face with the mounting back at
      z=0 spanning the whole face and the relief extending to -z (outward
      once mounted). The back winds inward, the shell rim winds outward, so
      the two coplanar surfaces coexist under FrontSide — the plate simply
      covers the rim, and the frame shows only on faces with no plate. ── */
const pickVariant = <T>(pool: readonly T[], i: number): T | undefined =>
  pool.length ? pool[((i % pool.length) + pool.length) % pool.length] : undefined;

/** Parts are authored in the unit cell and instanced by rotating about the
    cell centre (the engine's own mounting — no mirroring, no rewinding:
    rotations preserve handedness and the decoder already flipped to CCW).
    Axis plates: M = R(slot.o), face = M·(0,0,−1) in world. Cell-authored
    parts (slope/cut plates, wing skins): M composes cube/element rotations. */
function emitMountedPart(
  sink: (p: V3, n: V3, uv?: [number, number], tex?: string | null) => void,
  cell: V3, M: readonly number[] | undefined,
  pm: { sub: { pos: number[]; nrm?: number[]; idx: number[]; uv?: number[]; tex?: string[] }[] },
  texOn: boolean, texOverride?: string,
): void {
  if (!M) return;
  for (const s of pm.sub) {
    if (!s.nrm) continue;
    const stex = texOn ? (texOverride ?? s.tex?.[0] ?? null) : null;
    for (const i of s.idx) {
      const px = s.pos[i * 3] - 0.5;
      const py = s.pos[i * 3 + 1] - 0.5;
      const pz = s.pos[i * 3 + 2] - 0.5;
      const w: V3 = [
        M[0] * px + M[1] * py + M[2] * pz + 0.5 + cell[0],
        M[3] * px + M[4] * py + M[5] * pz + 0.5 + cell[1],
        M[6] * px + M[7] * py + M[8] * pz + 0.5 + cell[2],
      ];
      const nx = s.nrm[i * 3], ny = s.nrm[i * 3 + 1], nz = s.nrm[i * 3 + 2];
      const n: V3 = [
        M[0] * nx + M[1] * ny + M[2] * nz,
        M[3] * nx + M[4] * ny + M[5] * nz,
        M[6] * nx + M[7] * ny + M[8] * nz,
      ];
      sink(w, n, texOn && s.uv ? [s.uv[i * 2], s.uv[i * 2 + 1]] : undefined, stex);
    }
  }
}

/** The plate mesh a slot orientation needs on this cube plus the orientation
    to mount it with, or null when the shape has no face there / the face is
    buried under a full-cube neighbour. The mount orientation is the stored
    slot orientation for quad faces (its spin is a free decoration parameter)
    but SNAPPED to the face for tri faces: the archive stores free spins there
    too, and 30 fleet tri plates would land on the empty half of their face if
    mounted verbatim (the Punisher/Legion phantom "fins"). overrideId (the
    cube's per-face plateKinds entry) resolves through the plate registry and
    wins when its faceType matches the face. */
export function plateMeshFor(
  cube: { x: number; y: number; z: number; o: number; shape: number },
  slotO: number, data: GameData, variants: PlateVariants,
  cubeAtCell?: (x: number, y: number, z: number) => { shape: number } | undefined,
  overrideId?: string | null,
): { pm: PlateMeshEntry; mountO: number } | null {
  const d = plateFaceDir(slotO);
  const M = ORIENTATIONS[cube.o];
  if (!M) return null;
  // local direction = Rᵀ·d, matched against SLOT_AXES for the face kind
  const ld: V3 = [
    M[0] * d[0] + M[3] * d[1] + M[6] * d[2],
    M[1] * d[0] + M[4] * d[1] + M[7] * d[2],
    M[2] * d[0] + M[5] * d[1] + M[8] * d[2],
  ];
  const axis = SLOT_AXES.findIndex(a =>
    a[0] === Math.round(ld[0]) && a[1] === Math.round(ld[1]) && a[2] === Math.round(ld[2]));
  if (axis < 0) return null;
  const kind = AXIS_FACE_KIND[cube.shape as ShapeId]?.[axis];
  if (!kind) return null;
  const nb = cubeAtCell?.(cube.x + d[0], cube.y + d[1], cube.z + d[2]);
  if (nb && nb.shape === 0) return null;          // buried under a full cube
  const mountO = kind === 'tri'
    ? plateCanonical(cube.shape as ShapeId, cube.o, d)
    : slotO;
  if (overrideId) {
    const def = data.plates.get(overrideId);
    if (def && def.faceType === kind) return { pm: def.mesh as PlateMeshEntry, mountO };
  }
  const quads = data.plateMesh.quad_all ?? [];
  const tris = data.plateMesh.tri_all ?? (data.plateMesh.tri ? [data.plateMesh.tri] : []);
  const pm = kind === 'quad' ? pickVariant(quads, variants.quad) : pickVariant(tris, variants.tri);
  return pm ? { pm, mountO } : null;
}

/** translucent preview triangles for the plate tool: the plate as it would be
    mounted at slotO on this cube, or null when nothing can mount there */
export function mountedPlatePositions(
  cube: { x: number; y: number; z: number; o: number; shape: number },
  slotO: number, data: GameData, variants: PlateVariants,
  overrideId?: string | null,
): number[] | null {
  const found = plateMeshFor(cube, slotO, data, variants, undefined, overrideId);
  if (!found) return null;
  const pos: number[] = [];
  emitMountedPart((w) => { pos.push(w[0], w[1], w[2]); },
    [cube.x, cube.y, cube.z], ORIENTATIONS[found.mountO], found.pm, false);
  return pos.length ? pos : null;
}

function addAxisPlates(
  b: SlotBuckets, doc: ShipDoc, data: GameData, occ: Occupancy,
  aoOn: boolean, variants: PlateVariants, texOn: boolean,
): void {
  const byCell = new Map<string, { shape: number }>();
  for (const c of doc.cubes) byCell.set(`${c.x},${c.y},${c.z}`, c);
  const cubeAt = (x: number, y: number, z: number) => byCell.get(`${x},${y},${z}`);
  for (const cb of doc.cubes) {
    if (!cb.slots) continue;                       // editor-created: bare by default
    const mslot = slotOf(cb.comp);
    for (let i = 0; i < 6 && i < cb.slots.length; i++) {
      const sl = cb.slots[i];
      if (!sl.p) continue;
      const found = plateMeshFor(cb, sl.o, data, variants, cubeAt, cb.plateKinds?.[i]);
      if (!found) continue;
      emitMountedPart((w, n, uv, tex) => {
        b.vertex(mslot, w, n, aoOn ? vertexAO(w, n, occ, null) : 1, PLATE_BRIGHT, uv, tex ?? null);
      }, [cb.x, cb.y, cb.z], ORIENTATIONS[found.mountO], found.pm, texOn);
    }
  }
}

/* ── non-axis faces (k7 cut / k6 slope / k4 diagonal, slot 6): the named
      '=default' plates (p2121/p222A/p222V, identified via the cracked resource
      CRC) are authored IN the unit cell on their slanted planes, so they mount
      like shells: rotated by R(cube.o) ALONE about the cell centre. Slot 6's
      stored bytes are untrustworthy on both counts: its orientation is NOT a
      mounting rotation (never a cut-plane spin; composing it threw 8/25 fleet
      cut plates off-face — the Punisher "fin"), and its presence byte sits in
      the dump's garbage tail (5 false zeros break mirror symmetry in 4
      ships; every one of the 572 fleet k6/k4 reads plated). The slant plate
      is the shape's structural skin — always mounted. ── */
const NON_AXIS_TYPE: Record<number, 'p2121' | 'p222A' | 'p222V'> = {
  2: 'p2121', 3: 'p222A', 1: 'p222V',
};

function addNonAxisPlates(
  b: SlotBuckets, doc: ShipDoc, data: GameData, occ: Occupancy,
  aoOn: boolean, texOn: boolean,
): void {
  const types = data.plateMesh.types;
  if (!types) return;
  const NON_AXIS_FACE: Record<number, 'slope' | 'diag' | 'cut'> = { 2: 'slope', 3: 'diag', 1: 'cut' };
  for (const cb of doc.cubes) {
    const typeName = NON_AXIS_TYPE[cb.shape];
    if (!typeName) continue;
    const overrideId = cb.plateKinds?.[6];
    const override = overrideId ? data.plates.get(overrideId) : undefined;
    const pm = override && override.faceType === NON_AXIS_FACE[cb.shape]
      ? override.mesh : types[typeName];
    const Mc = ORIENTATIONS[cb.o];
    if (!pm || !Mc) continue;
    const mslot = slotOf(cb.comp);
    emitMountedPart((w, n, uv, tex) => {
      b.vertex(mslot, w, n, aoOn ? vertexAO(w, n, occ, null) : 1, PLATE_BRIGHT, uv, tex ?? null);
    }, [cb.x, cb.y, cb.z], Mc, pm, texOn);
  }
}

/* ── wing skins: the named w*=default meshes, authored in the unit cell and
      mounted by R(element.o) about the cell centre; w2121 has no mesh in the
      archive and keeps the flat recovered polygon ── */
function addWingSkins(
  b: SlotBuckets, doc: ShipDoc, data: GameData, occ: Occupancy,
  aoOn: boolean, texOn: boolean,
): Set<number> {
  const skinned = new Set<number>();
  const meshes = data.wingMesh;
  if (!meshes) return skinned;
  doc.wings.forEach((el, i) => {
    const pm = meshes[el.kind];
    const M = ORIENTATIONS[el.o];
    if (!pm || !M) return;
    emitMountedPart((w, n, uv, tex) => {
      b.vertex('wing', w, n, aoOn ? vertexAO(w, n, occ, null) : 1, 1, uv, tex ?? null);
    }, [el.x, el.y, el.z], M, pm, texOn, 'wing_solar');
    skinned.add(i);
  });
  return skinned;
}

/** prototype extras (lattice trusses, guylines, attached deco) — structural,
    so they render in every mode; struts wear the hull material, deco carries
    its own textures. UVs default to the blank atlas cell in plate mode. */
function addExtras(
  b: SlotBuckets, doc: ShipDoc, data: GameData, occ: Occupancy,
  aoOn: boolean, texOn: boolean, uvBlank: boolean,
): void {
  if (!doc.extras?.length) return;
  const slot = compSlot(HULL_COMP);
  emitExtras((p, n, uv, tex) => {
    b.vertex(slot, p, n, aoOn ? vertexAO(p, n, occ, null) : 1, 1,
      uv ?? (uvBlank ? BLANK_UV : undefined), tex);
  }, doc.extras, data, texOn);
}

/** naked-mode pick shrink — matches the module cages so rays slip between
    cells and reach interior systems */
export const NAKED_PICK_SCALE = NAKED_MODULE_SCALE;

export function buildShipGeometry(doc: ShipDoc, data: GameData, opts: BuildOptions): BuiltShip {
  /* hull only — attached elements never occlude */
  const occ = occupancyOf(doc.cubes);

  if (opts.mode === 'naked') {
    /* Systems view — the exclusive home of the interior system meshes.
       Compartments are a logical property and can sit on prismatic blocks
       whose slant the cube-authored cages would clip through, so no dressed
       view renders them; here they draw over a translucent hull silhouette
       (shipView adds it) instead. System cubes only — plain hull reads from
       the silhouette. */
    const b = new SlotBuckets(opts.textures);
    addModules(b, doc, data, occ, opts.ao, opts.textures, false, NAKED_MODULE_SCALE);
    const { geometry, groupSlots, groupTex } = b.build();
    const kept = cullFacets(collectFacets(doc.cubes));
    const frame = fanGeometry(kept.map(f => f.verts));
    return { geometry, groupSlots, groupTex, edges: frame, edgesThreshold: 25 };
  }

  const kept = cullFacets(collectFacets(doc.cubes));

  if (opts.mode === 'mesh') {
    /* with textures on, the archive's own UVs and per-submesh diffuse maps are
       emitted and triangles group by (slot, texture) instead of slot alone.
       Rendered FrontSide: complete frames, hollow the engine's way — the
       interior system meshes belong to the Systems view alone (a cage can sit
       in a prismatic cube and would clip through its slant shell). */
    const b = new SlotBuckets(opts.textures);
    addShells(b, doc, data, occ, opts.ao, opts.textures);
    if (opts.plates) {
      addAxisPlates(b, doc, data, occ, opts.ao, opts.plateVariants, opts.textures);
      addNonAxisPlates(b, doc, data, occ, opts.ao, opts.textures);
    }
    const skinned = addWingSkins(b, doc, data, occ, opts.ao, opts.textures);
    addWings(b, { ...doc, wings: doc.wings.filter((_, i) => !skinned.has(i)) },
      occ, opts.ao, opts.textures, true);
    addExtras(b, doc, data, occ, opts.ao, opts.textures, false);
    const { geometry, groupSlots, groupTex } = b.build();
    /* the detail meshes carry every crease worth tracing themselves */
    return { geometry, groupSlots, groupTex, edges: geometry, edgesThreshold: 32 };
  }

  const plate = opts.mode === 'plate';
  const shown = kept;
  const b = new SlotBuckets(plate);

  for (const f of shown) {
    const e1 = norm(sub(f.verts[1], f.verts[0]));
    /* facet winding isn't consistently outward, so settle it against the source
       solid's centroid (probe fallback for chamfer strips) */
    const cen = centroid(f.verts);
    const n = orient(norm(cross(e1, sub(f.verts[2], f.verts[0]))), cen, f, occ);
    const ownKey = `${Math.floor(cen[0] - 0.3 * n[0])},${Math.floor(cen[1] - 0.3 * n[1])},${Math.floor(cen[2] - 0.3 * n[2])}`;
    const tone = plate ? facetTone(f.k) : 1;
    const ao = (i: number): number =>
      opts.ao ? vertexAO(f.verts[i], n, occ, ownKey) : 1;

    if (!plate) { b.fan(slotOf(f.comp), f.verts, n, ao, tone); continue; }

    /* planar face UVs, normalized+centered into [0,1] */
    const e2 = cross(n, e1);
    const fuv = f.verts.map(v => [dot(sub(v, f.verts[0]), e1), dot(sub(v, f.verts[0]), e2)]);
    const us = fuv.map(p => p[0]), vs = fuv.map(p => p[1]);
    const u0 = Math.min(...us), v0 = Math.min(...vs);
    const s = Math.max(Math.max(...us) - u0, Math.max(...vs) - v0) || 1;
    const mu = (1 - (Math.max(...us) - u0) / s) / 2, mv = (1 - (Math.max(...vs) - v0) / s) / 2;
    b.fan(slotOf(f.comp), f.verts, n, ao, tone, i => f.plain
      ? BLANK_UV
      : atlasUV(f.comp, (fuv[i][0] - u0) / s + mu, (fuv[i][1] - v0) / s + mv));
  }

  const wingLoops = addWings(b, doc, occ, opts.ao, plate);
  addExtras(b, doc, data, occ, opts.ao, false, plate);
  const { geometry, groupSlots, groupTex } = b.build();

  /* accent lines trace the facet outlines — when chamfered, the bevel strips
     are excluded so each plate gets one crisp contour instead of a double line
     (viewer 1033-1039). Wing outlines come along, as they do in the viewer's
     own separate wing edge pass. */
  const eSrc: (readonly V3[])[] = shown.filter(f => !f.plain).map(f => f.verts);
  const edges = fanGeometry([...eSrc, ...wingLoops]);
  return { geometry, groupSlots, groupTex, edges, edgesThreshold: 25 };
}
