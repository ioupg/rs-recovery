/* Procedural builders for the prototype element kinds (ShipDoc.extras):
   lattice spine/mast trusses, attached decorative meshes, guyline cables.
   Engine-side only — there is no editing UI yet; elements arrive via ship
   JSON (notes/07-authoring.md §4.3) and render in every mode. Like wings,
   everything here is generated, not stored. */

import type { DecoEl, ExtraElement, GuyEl, LatticeEl, Vec3 } from '../core/types';
import { ORIENTATIONS, SLOT_AXES, corner } from '../core/tables';
import type { GameData } from '../data/loader';

type V3 = readonly [number, number, number];

export interface TriSink {
  (p: V3, n: V3): void;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** square-section strut between two points: 4 sides + 2 caps, flat normals */
export function emitStrut(sink: TriSink, p0: V3, p1: V3, t: number): void {
  const axis = sub(p1, p0);
  const l = len(axis);
  if (l < 1e-9) return;
  const d = scale(axis, 1 / l);
  /* any perpendicular; pick against the least-aligned world axis */
  const ref: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(d, ref));
  const v = cross(d, u);
  const h = t / 2;
  const ring = (p: V3): V3[] => [
    add(p, add(scale(u, h), scale(v, h))),
    add(p, add(scale(u, -h), scale(v, h))),
    add(p, add(scale(u, -h), scale(v, -h))),
    add(p, add(scale(u, h), scale(v, -h))),
  ];
  const a = ring(p0), b = ring(p1);
  const quad = (q0: V3, q1: V3, q2: V3, q3: V3, n: V3): void => {
    sink(q0, n); sink(q1, n); sink(q2, n);
    sink(q0, n); sink(q2, n); sink(q3, n);
  };
  const sideN: V3[] = [v, scale(u, -1), scale(v, -1), u];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(a[i], a[j], b[j], b[i], sideN[i]);
  }
  quad(a[3], a[2], a[1], a[0], scale(d, -1));   // caps
  quad(b[0], b[1], b[2], b[3], d);
}

/* ── lattice spine / mast ────────────────────────────────────────
   Truss along an axis-aligned run of cells: chords down the corners of the
   cross-section polygon, a ring at every cell boundary, one diagonal brace
   per bay per side (alternating direction). Cross-section is inscribed in
   the cell with a small inset so the truss reads inside its cells. */
const SECTION_INSET = 0.12;

export function emitLattice(sink: TriSink, el: LatticeEl): void {
  const from = el.from, to = el.to;
  const axis = [0, 1, 2].find(i => to[i] !== from[i]) ?? 2;
  const n = Math.abs(to[axis] - from[axis]) + 1;      // bays span n cells
  const lo = Math.min(from[axis], to[axis]);
  /* cross-section corner offsets in the two perpendicular axes */
  const [a1, a2] = [0, 1, 2].filter(i => i !== axis);
  const half = 0.5 - SECTION_INSET;
  const cornersOf = (profile: 'square' | 'tri'): [number, number][] =>
    profile === 'square'
      ? [[-half, -half], [half, -half], [half, half], [-half, half]]
      : [[-half, -half], [half, -half], [0, half]];
  const cs = cornersOf(el.profile);
  /* ring b sits on the cell boundary lo + b; the run fills [lo, lo + n] */
  const at = (b: number, c: readonly [number, number]): V3 => {
    const p: [number, number, number] = [0, 0, 0];
    p[axis] = lo + b;
    p[a1] = from[a1] + 0.5 + c[0];
    p[a2] = from[a2] + 0.5 + c[1];
    return p;
  };
  /* chords: one strut per corner over the whole run */
  for (const c of cs)
    emitStrut(sink, at(0, c), at(n, c), el.chord);
  /* rings + braces per bay */
  for (let b = 0; b <= n; b++) {
    for (let i = 0; i < cs.length; i++) {
      const j = (i + 1) % cs.length;
      emitStrut(sink, at(b, cs[i]), at(b, cs[j]), el.brace);
      if (b < n) {
        /* alternate brace direction per bay and per side */
        const flip = (b + i) % 2 === 0;
        emitStrut(sink,
          at(b, flip ? cs[i] : cs[j]),
          at(b + 1, flip ? cs[j] : cs[i]), el.brace);
      }
    }
  }
}

/* ── guyline ─────────────────────────────────────────────────────
   Cable between two cell corners; straight at sag 0, otherwise a quadratic
   bow away from the segment (downward in world Y, or along the least-aligned
   axis for vertical runs). */
const GUY_THICKNESS = 0.018;

export function emitGuy(sink: TriSink, el: GuyEl): void {
  const p = (end: GuyEl['a']): V3 => {
    const c = corner(end.corner);
    return [end.cell[0] + c[0], end.cell[1] + c[1], end.cell[2] + c[2]];
  };
  const a = p(el.a), b = p(el.b);
  if (!el.sag) { emitStrut(sink, a, b, GUY_THICKNESS); return; }
  const d = norm(sub(b, a));
  const down: V3 = Math.abs(d[1]) < 0.9 ? [0, -1, 0] : [1, 0, 0];
  /* component of `down` perpendicular to the cable */
  const k = down[0] * d[0] + down[1] * d[1] + down[2] * d[2];
  const bow = norm(sub(down, scale(d, k)));
  const segs = Math.max(4, Math.ceil(len(sub(b, a)) * 2));
  let prev = a;
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const straight = add(a, scale(sub(b, a), t));
    const cur = add(straight, scale(bow, el.sag * 4 * t * (1 - t)));
    emitStrut(sink, prev, cur, GUY_THICKNESS);
    prev = cur;
  }
}

/* ── attached decorative mesh ────────────────────────────────────
   Registry mesh glued to a hull face: authored in the unit cell like every
   part, back on the z=0 plane. Mount = R(el.o) about the anchor cell's
   centre (the plate convention — the face it lands on is R(o)·(0,0,−1)),
   then the in-face offset. meshId resolves against the module cages first
   (by resource name), then the plate registry. */
export function emitDeco(
  sink: (p: V3, n: V3, uv: [number, number] | undefined, tex: string | null) => void,
  el: DecoEl, data: GameData, texOn: boolean,
): void {
  const mesh = data.moduleByName?.[el.meshId] ?? data.plates.get(el.meshId)?.mesh;
  const M = ORIENTATIONS[el.o];
  if (!mesh || !M) return;
  const cell = el.anchor.cell;
  const faceDir = SLOT_AXES[el.anchor.face] ?? [0, 0, -1];
  /* offset moves within the face plane */
  const [u, v] = el.anchor.offset;
  const off: V3 = faceDir[0] !== 0 ? [0, u - 0.5, v - 0.5]
    : faceDir[1] !== 0 ? [u - 0.5, 0, v - 0.5] : [u - 0.5, v - 0.5, 0];
  for (const s of mesh.sub) {
    if (!s.nrm) continue;
    const stex = texOn ? (s.tex?.[0] ?? null) : null;
    for (const i of s.idx) {
      const px = s.pos[i * 3] - 0.5, py = s.pos[i * 3 + 1] - 0.5, pz = s.pos[i * 3 + 2] - 0.5;
      const w: V3 = [
        M[0] * px + M[1] * py + M[2] * pz + 0.5 + cell[0] + off[0],
        M[3] * px + M[4] * py + M[5] * pz + 0.5 + cell[1] + off[1],
        M[6] * px + M[7] * py + M[8] * pz + 0.5 + cell[2] + off[2],
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

/** everything in doc.extras, routed to the right emitter */
export function emitExtras(
  vertexSink: (p: V3, n: V3, uv: [number, number] | undefined, tex: string | null) => void,
  extras: readonly ExtraElement[], data: GameData, texOn: boolean,
): void {
  const plain: TriSink = (p, n) => vertexSink(p, n, undefined, null);
  for (const el of extras) {
    if (el.kind === 'lattice') emitLattice(plain, el);
    else if (el.kind === 'guy') emitGuy(plain, el);
    else if (el.kind === 'deco') emitDeco(vertexSink, el, data, texOn);
  }
}

/** cells a lattice run occupies — reserved so validation can flag overlaps */
export function latticeCells(el: LatticeEl): Vec3[] {
  const axis = [0, 1, 2].find(i => el.to[i] !== el.from[i]) ?? 2;
  const dir = Math.sign(el.to[axis] - el.from[axis]) || 1;
  const out: Vec3[] = [];
  for (let v = el.from[axis]; ; v += dir) {
    const p: [number, number, number] = [...el.from] as [number, number, number];
    p[axis] = v;
    out.push(p);
    if (v === el.to[axis]) break;
  }
  return out;
}
