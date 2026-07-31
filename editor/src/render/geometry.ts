/* Ship geometry builders — ports of the validated renderer in
   ../viewer/index.html (facet collect+cull 763-798, mesh mode shells 800-860 /
   filler 861-886 / plates 887-953, plate mode 974-1051, wings 1053-1096).
   See ARCHITECTURE.md for mode semantics.

   Deviation from the reference, by design: the viewer bakes the compartment
   tint into the vertex colour and draws everything with one material. Here the
   tint lives in the per-slot material and the triangles are bucketed by
   MaterialSlot into contiguous geometry groups, so the vertex colour carries
   grayscale shading only — AO x facet tone x brightness factor. */

import * as THREE from 'three';
import type { MaterialSlot, ShapeId, ShipDoc } from '../core/types';
import { MATERIAL_SLOTS } from '../core/types';
import {
  AXIS_FACE_KIND, HULL_COMP, ORIENTATIONS, SLOT_AXES, WING_RING, corner, plateFaceDir, rot,
} from '../core/tables';
import { compSlot } from '../core/materials';
import type { GameData, PlateMeshEntry } from '../data/loader';
import type { BuildOptions, BuiltShip, PlateVariants } from './geometryTypes';
import { occupancyOf, vertexAO, type Occupancy } from './ao';
import { BLANK_UV, atlasUV } from './atlas';
import { chamferFaces } from './chamfer';
import {
  centroid, collectFacets, cross, cullFacets, dot, facetNormal, len, norm, orient, sub,
  type Facet, type V3,
} from './facets';

/* plates drop into the open window each hull shell leaves on its face; the
   margin keeps the plate edge off the rim so the two never fight for pixels */
const PLATE_MARGIN = 0.985;
/* the hull shapes are shells: the filler is the plain culled hull pushed a
   little way inside, blocking the view without reaching the detail surface */
const FILL_INSET = 0.045;
/* interior module cage, shrunk to clear the shell it sits inside */
const MODULE_SCALE = 0.88;
const CHAMFER = 0.07;
const FILL_BRIGHT = 0.55, MODULE_BRIGHT = 0.78, PLATE_BRIGHT = 1.06;

/** compartment → material slot; out-of-range compartments fall back to hull */
const slotOf = (comp: number): MaterialSlot =>
  compSlot(Number.isInteger(comp) && comp >= 0 && comp <= 9 ? comp : HULL_COMP);

interface Bin { slot: MaterialSlot; tex: string | null; pos: number[]; nrm: number[]; col: number[]; uv: number[] }

/** Triangle sink that keeps each (material slot, archive texture) contiguous,
    so one non-indexed BufferGeometry can carry one group per material. tex is
    always null outside textured mesh mode, collapsing to one group per slot —
    identical output to the parity-verified untextured build. */
class SlotBuckets {
  private readonly bins = new Map<string, Bin>();
  constructor(private readonly uvOn: boolean) {}

  vertex(
    slot: MaterialSlot, p: readonly number[], n: readonly number[], shade: number,
    uv?: readonly [number, number], tex: string | null = null,
  ): void {
    const key = `${slot} ${tex ?? ''}`;
    let b = this.bins.get(key);
    if (!b) { b = { slot, tex, pos: [], nrm: [], col: [], uv: [] }; this.bins.set(key, b); }
    b.pos.push(p[0], p[1], p[2]);
    b.nrm.push(n[0], n[1], n[2]);
    b.col.push(shade, shade, shade);
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
    shade: (i: number) => number, uv?: (i: number) => readonly [number, number],
  ): void {
    for (let i = 1; i < vs.length - 1; i++) {
      const w = cross(sub(vs[i], vs[0]), sub(vs[i + 1], vs[0]));
      let tn = n;
      if (len(w) > 1e-12) { tn = norm(w); if (dot(tn, n) < 0) tn = [-tn[0], -tn[1], -tn[2]]; }
      for (const j of [0, i, i + 1])
        this.vertex(slot, vs[j], tn, shade(j), uv ? uv(j) : undefined);
    }
  }

  build(): { geometry: THREE.BufferGeometry; groupSlots: MaterialSlot[]; groupTex: (string | null)[] } {
    const order = new Map(MATERIAL_SLOTS.map((s, i) => [s, i]));
    const used = [...this.bins.values()]
      .filter(b => b.pos.length > 0)
      .sort((a, b2) => (order.get(a.slot)! - order.get(b2.slot)!)
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
    b.fan('wing', vs, n, i => (aoOn ? wao[i] : 1), uvOn ? () => BLANK_UV : undefined);
    loops.push(vs);
  }
  return loops;
}

/* ── mesh mode: the decoded part meshes in place of the procedural hull ──
      Each cube shape was matched to a decoded mesh by corner set, authored in
      the unit cell, so it rides the same rotate-about-centre transform the
      facets use (viewer 800-831). ── */
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
        b.vertex(slot, w, n, aoOn ? vertexAO(w, n, occ, own) : 1,
          texOn && s.uv ? [s.uv[i * 2], s.uv[i * 2 + 1]] : undefined, stex);
      }
    }
  }
}

/* interior module cage per cube — the machinery you see through the window.
   Cage-to-system mapping is not recoverable, so cages are handed out by
   compartment id over the family in a stable order (viewer 832-859). */
function addModules(
  b: SlotBuckets, doc: ShipDoc, data: GameData, occ: Occupancy, aoOn: boolean,
  texOn: boolean,
): void {
  const N = data.moduleMesh.length;
  if (!N) return;
  for (const cb of doc.cubes) {
    if (cb.comp === HULL_COMP) continue;                 // plain hull carries none
    const mm = data.moduleMesh[((cb.comp % N) + N) % N];
    const M = ORIENTATIONS[cb.o];
    if (!mm || !M) continue;
    const own = `${cb.x},${cb.y},${cb.z}`;
    const slot = slotOf(cb.comp);
    for (const s of mm.sub) {
      if (!s.nrm) continue;
      const stex = texOn ? (s.tex?.[0] ?? null) : null;
      for (const i of s.idx) {
        const p0 = [
          (s.pos[i * 3] - 0.5) * MODULE_SCALE,
          (s.pos[i * 3 + 1] - 0.5) * MODULE_SCALE,
          (s.pos[i * 3 + 2] - 0.5) * MODULE_SCALE,
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
        b.vertex(slot, w, n, (aoOn ? vertexAO(w, n, occ, own) : 1) * MODULE_BRIGHT,
          texOn && s.uv ? [s.uv[i * 2], s.uv[i * 2 + 1]] : undefined, stex);
      }
    }
  }
}

/** filler: the procedural hull, offset inward, sitting behind everything
    (viewer 861-886) */
function addFiller(
  b: SlotBuckets, kept: readonly Facet[], occ: Occupancy, aoOn: boolean,
): void {
  for (const f of kept) {
    const cen = centroid(f.verts);
    const n = orient(facetNormal(f.verts), cen, f, occ);
    const vs = f.verts.map(v =>
      [v[0] - n[0] * FILL_INSET, v[1] - n[1] * FILL_INSET, v[2] - n[2] * FILL_INSET] as V3);
    /* emit triangles wound with the outward normal, whichever way the loop
       runs, so the explicit normal is not flipped by double-sided shading */
    const rev = dot(cross(sub(vs[1], vs[0]), sub(vs[2], vs[0])), n) < 0;
    const slot = slotOf(f.comp);
    for (let i = 1; i < vs.length - 1; i++)
      for (const k of rev ? [0, i + 1, i] : [0, i, i + 1])
        b.vertex(slot, vs[k], n, (aoOn ? vertexAO(vs[k], n, occ, null) : 1) * FILL_BRIGHT);
  }
}

/* ── decoration plates ride over the frame's exterior faces (viewer 887-953).
      Each plate mesh is authored on a unit face with its mounting back at z=0
      and the relief extending to -z (the same D3D-handed convention as the
      winding), so it is mounted MIRRORED along the facet normal — back on the
      face plane, relief standing out of the hull. Mapped as-is the relief would
      sink into the window and only the flat back would show. The mirror flips
      handedness, so position z and normal z are negated and each triangle is
      rewound. Plates map through the affine frame the facet itself defines —
      which also means they inherit the facet culling for free. ── */
const pickVariant = <T>(pool: readonly T[], i: number): T | undefined =>
  pool.length ? pool[((i % pool.length) + pool.length) % pool.length] : undefined;

/** Axis plates, mounted the engine's own way: the plate is authored on the
    cell's z=0 face (relief to −z, outward) and instanced by rotating about the
    cell centre by ORIENTATIONS[slot.o] — the face it decorates is
    R(slot.o)·(0,0,−1) in world (fleet-verified). No mirroring, no rewinding:
    rotations preserve handedness and the decoder already flipped to CCW. */
function emitMountedPlate(
  sink: (p: V3, n: V3, uv?: [number, number], tex?: string | null) => void,
  cell: V3, slotO: number,
  pm: { sub: { pos: number[]; nrm?: number[]; idx: number[]; uv?: number[]; tex?: string[] }[] },
  windowK: number, texOn: boolean,
): void {
  const M = ORIENTATIONS[slotO];
  if (!M) return;
  for (const s of pm.sub) {
    if (!s.nrm) continue;
    const stex = texOn ? (s.tex?.[0] ?? null) : null;
    for (const i of s.idx) {
      const px = 0.5 + (s.pos[i * 3] - 0.5) * windowK - 0.5;
      const py = 0.5 + (s.pos[i * 3 + 1] - 0.5) * windowK - 0.5;
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

/** the plate mesh a slot orientation needs on this cube, or null when the
    shape has no face there / the face is buried under a full-cube neighbour */
export function plateMeshFor(
  cube: { x: number; y: number; z: number; o: number; shape: number },
  slotO: number, data: GameData, variants: PlateVariants,
  cubeAtCell?: (x: number, y: number, z: number) => { shape: number } | undefined,
): { pm: PlateMeshEntry; windowK: number } | null {
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
  const quads = data.plateMesh.quad_all ?? [];
  const tris = data.plateMesh.tri_all ?? (data.plateMesh.tri ? [data.plateMesh.tri] : []);
  const pm = kind === 'quad' ? pickVariant(quads, variants.quad) : pickVariant(tris, variants.tri);
  if (!pm) return null;
  const sm = data.shapeMesh[String(cube.shape)];
  return { pm, windowK: ((sm && sm.window) || 1) * PLATE_MARGIN };
}

/** translucent preview triangles for the plate tool: the plate as it would be
    mounted at slotO on this cube, or null when nothing can mount there */
export function mountedPlatePositions(
  cube: { x: number; y: number; z: number; o: number; shape: number },
  slotO: number, data: GameData, variants: PlateVariants,
): number[] | null {
  const found = plateMeshFor(cube, slotO, data, variants);
  if (!found) return null;
  const pos: number[] = [];
  emitMountedPlate((w) => { pos.push(w[0], w[1], w[2]); },
    [cube.x, cube.y, cube.z], slotO, found.pm, found.windowK, false);
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
      const found = plateMeshFor(cb, sl.o, data, variants, cubeAt);
      if (!found) continue;
      emitMountedPlate((w, n, uv, tex) => {
        b.vertex(mslot, w, n, (aoOn ? vertexAO(w, n, occ, null) : 1) * PLATE_BRIGHT, uv, tex ?? null);
      }, [cb.x, cb.y, cb.z], sl.o, found.pm, found.windowK, texOn);
    }
  }
}

/* ── non-axis faces (k7 cut / k6 slope / k4 diagonal, slot 6): the archive has
      no meshes authored on those planes, so the stand-ins map through the
      affine frame the facet defines, exactly as the reference viewer validated
      (mirrored mounting, rewound triangles, right-handed frame). ── */
function addNonAxisPlates(
  b: SlotBuckets, kept: readonly Facet[], data: GameData, occ: Occupancy,
  aoOn: boolean, variants: PlateVariants, texOn: boolean,
): void {
  const quads = data.plateMesh.quad_all ?? [];
  const tris = data.plateMesh.tri_all ?? (data.plateMesh.tri ? [data.plateMesh.tri] : []);
  for (const f of kept) {
    if (!f.nonAxis || f.plate === false) continue;
    /* slope p2121 (quad pool, sheared) · cut/diagonal p222A,V (tri pool) */
    const pm = f.verts.length === 4
      ? pickVariant(quads, variants.slope)
      : pickVariant(tris, variants.eq);
    if (!pm || pm.outline.length < 3) continue;
    const nw = facetNormal(f.verts);
    const cen = centroid(f.verts);
    const n = orient(nw, cen, f, occ);
    /* the loop may wind either way; the mirror mounting needs a right-handed
       frame, or it mirrors the plate a second time in-plane and the winding
       comes out inverted on exactly those facets. Walk the loop backwards when
       its winding normal opposes the outward one. */
    const fv = dot(nw, n) < 0 ? f.verts.slice().reverse() : f.verts;
    const v0 = fv[0], E1 = sub(fv[1], v0), E2 = sub(fv[2], v0);
    /* solve the plate's local outline onto this facet */
    const [a0, a1, a2] = pm.outline;
    /* shrink the plate about its own centre: at full size it covers the whole
       face and hides the frame it is supposed to be bolted onto */
    const oc = pm.outline.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0])
                         .map(v => v / pm.outline.length);
    const sm = data.shapeMesh[String(f.shape)];
    const k = ((sm && sm.window) || 1) * PLATE_MARGIN;
    const d1 = [a1[0] - a0[0], a1[1] - a0[1]], d2 = [a2[0] - a0[0], a2[1] - a0[1]];
    const det = d1[0] * d2[1] - d1[1] * d2[0];
    if (!det) continue;
    const slot = slotOf(f.comp);
    for (const s of pm.sub) {
      if (!s.nrm) continue;
      const stex = texOn ? (s.tex?.[0] ?? null) : null;
      for (let t = 0; t < s.idx.length; t += 3)
        for (const i of [s.idx[t], s.idx[t + 2], s.idx[t + 1]]) {
          const lx = oc[0] + (s.pos[i * 3] - oc[0]) * k - a0[0],
                ly = oc[1] + (s.pos[i * 3 + 1] - oc[1]) * k - a0[1],
                lz = -s.pos[i * 3 + 2];
          const t1 = (lx * d2[1] - ly * d2[0]) / det;
          const t2 = (-lx * d1[1] + ly * d1[0]) / det;
          const w: V3 = [
            v0[0] + t1 * E1[0] + t2 * E2[0] + lz * n[0],
            v0[1] + t1 * E1[1] + t2 * E2[1] + lz * n[1],
            v0[2] + t1 * E1[2] + t2 * E2[2] + lz * n[2],
          ];
          const m1 = (s.nrm[i * 3] * d2[1] - s.nrm[i * 3 + 1] * d2[0]) / det;
          const m2 = (-s.nrm[i * 3] * d1[1] + s.nrm[i * 3 + 1] * d1[0]) / det;
          const nz = -s.nrm[i * 3 + 2];
          const wn = norm([
            m1 * E1[0] + m2 * E2[0] + nz * n[0],
            m1 * E1[1] + m2 * E2[1] + nz * n[1],
            m1 * E1[2] + m2 * E2[2] + nz * n[2],
          ]);
          b.vertex(slot, w, wn, (aoOn ? vertexAO(w, wn, occ, null) : 1) * PLATE_BRIGHT,
            texOn && s.uv ? [s.uv[i * 2], s.uv[i * 2 + 1]] : undefined, stex);
        }
    }
  }
}

export function buildShipGeometry(doc: ShipDoc, data: GameData, opts: BuildOptions): BuiltShip {
  /* hull only — attached elements never occlude */
  const occ = occupancyOf(doc.cubes);
  const kept = cullFacets(collectFacets(doc.cubes));

  if (opts.mode === 'mesh') {
    /* with textures on, the archive's own UVs and per-submesh diffuse maps are
       emitted and triangles group by (slot, texture) instead of slot alone */
    const b = new SlotBuckets(opts.textures);
    addShells(b, doc, data, occ, opts.ao, opts.textures);
    addModules(b, doc, data, occ, opts.ao, opts.textures);
    addFiller(b, kept, occ, opts.ao);
    if (opts.plates) {
      addAxisPlates(b, doc, data, occ, opts.ao, opts.plateVariants, opts.textures);
      addNonAxisPlates(b, kept, data, occ, opts.ao, opts.plateVariants, opts.textures);
    }
    addWings(b, doc, occ, opts.ao, opts.textures);
    const { geometry, groupSlots, groupTex } = b.build();
    /* the detail meshes carry every crease worth tracing themselves */
    return { geometry, groupSlots, groupTex, edges: geometry, edgesThreshold: 32 };
  }

  const plate = opts.mode === 'plate';
  const shown = plate && opts.chamfer ? chamferFaces(kept, CHAMFER) : kept;
  const b = new SlotBuckets(plate);

  for (const f of shown) {
    const e1 = norm(sub(f.verts[1], f.verts[0]));
    /* facet winding isn't consistently outward, so settle it against the source
       solid's centroid (probe fallback for chamfer strips) */
    const cen = centroid(f.verts);
    const n = orient(norm(cross(e1, sub(f.verts[2], f.verts[0]))), cen, f, occ);
    const ownKey = `${Math.floor(cen[0] - 0.3 * n[0])},${Math.floor(cen[1] - 0.3 * n[1])},${Math.floor(cen[2] - 0.3 * n[2])}`;
    const tone = plate ? facetTone(f.k) : 1;
    const shade = (i: number): number =>
      (opts.ao ? vertexAO(f.verts[i], n, occ, ownKey) : 1) * tone;

    if (!plate) { b.fan(slotOf(f.comp), f.verts, n, shade); continue; }

    /* planar face UVs, normalized+centered into [0,1] */
    const e2 = cross(n, e1);
    const fuv = f.verts.map(v => [dot(sub(v, f.verts[0]), e1), dot(sub(v, f.verts[0]), e2)]);
    const us = fuv.map(p => p[0]), vs = fuv.map(p => p[1]);
    const u0 = Math.min(...us), v0 = Math.min(...vs);
    const s = Math.max(Math.max(...us) - u0, Math.max(...vs) - v0) || 1;
    const mu = (1 - (Math.max(...us) - u0) / s) / 2, mv = (1 - (Math.max(...vs) - v0) / s) / 2;
    b.fan(slotOf(f.comp), f.verts, n, shade, i => f.plain
      ? BLANK_UV
      : atlasUV(f.comp, (fuv[i][0] - u0) / s + mu, (fuv[i][1] - v0) / s + mv));
  }

  const wingLoops = addWings(b, doc, occ, opts.ao, plate);
  const { geometry, groupSlots, groupTex } = b.build();

  /* accent lines trace the facet outlines — when chamfered, the bevel strips
     are excluded so each plate gets one crisp contour instead of a double line
     (viewer 1033-1039). Wing outlines come along, as they do in the viewer's
     own separate wing edge pass. */
  const eSrc: (readonly V3[])[] = shown.filter(f => !f.plain).map(f => f.verts);
  const edges = fanGeometry([...eSrc, ...wingLoops]);
  return { geometry, groupSlots, groupTex, edges, edgesThreshold: 25 };
}
