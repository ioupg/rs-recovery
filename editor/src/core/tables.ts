/* Exe-derived constant tables, ported verbatim from the recovery
   (viewer/ships.js line 2, viewer/index.html FACES/centroids/fill).
   These are frozen facts extracted from RedStarEditor.Debug.Win32 —
   do not edit without new reverse-engineering evidence. */

import type { ShapeId, Vec3 } from './types';

/** 24 signed-permutation rotation matrices (row-major 3×3), the cube rotation
    group as initialised by the exe at 0x4020b0+ (table 0x22b7cf8). */
export const ORIENTATIONS: readonly (readonly number[])[] = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 0, -1, 0],
  [1, 0, 0, 0, -1, 0, 0, 0, -1], [1, 0, 0, 0, 0, -1, 0, 1, 0],
  [0, 0, -1, 0, 1, 0, 1, 0, 0], [0, 0, -1, 1, 0, 0, 0, -1, 0],
  [0, 0, -1, 0, -1, 0, -1, 0, 0], [0, 0, -1, -1, 0, 0, 0, 1, 0],
  [-1, 0, 0, 0, 1, 0, 0, 0, -1], [-1, 0, 0, 0, 0, -1, 0, -1, 0],
  [-1, 0, 0, 0, -1, 0, 0, 0, 1], [-1, 0, 0, 0, 0, 1, 0, 1, 0],
  [0, 0, 1, 0, 1, 0, -1, 0, 0], [0, 0, 1, -1, 0, 0, 0, -1, 0],
  [0, 0, 1, 0, -1, 0, 1, 0, 0], [0, 0, 1, 1, 0, 0, 0, 1, 0],
  [0, 1, 0, 0, 0, 1, 1, 0, 0], [0, 1, 0, 1, 0, 0, 0, 0, -1],
  [0, 1, 0, 0, 0, -1, -1, 0, 0], [0, 1, 0, -1, 0, 0, 0, 0, 1],
  [0, -1, 0, 0, 0, -1, 1, 0, 0], [0, -1, 0, 1, 0, 0, 0, 0, 1],
  [0, -1, 0, 0, 0, 1, -1, 0, 0], [0, -1, 0, -1, 0, 0, 0, 0, -1],
];

/** Faces per shape as corner-index loops, validated against the exe plate
    tables (CarcassCube::vertexIndex, 0x1db7030). Loop order defines the plate
    mapping frame — NEVER reorder; winding is not consistently outward
    (normals are oriented against the solid centroid instead). */
export const FACES: Record<ShapeId, readonly (readonly number[])[]> = {
  0: [[0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5], [0, 2, 3, 1], [4, 5, 7, 6]],
  1: [[0, 1, 5, 4], [1, 3, 7, 5], [4, 5, 7, 6], [0, 4, 6], [6, 7, 3], [0, 3, 1], [0, 6, 3]],
  2: [[0, 1, 5, 4], [4, 5, 7, 6], [0, 1, 7, 6], [0, 6, 4], [1, 5, 7]],
  3: [[1, 4, 5], [1, 5, 7], [4, 5, 7], [1, 4, 7]],
};

/** corner id (0..7) → unit-cell position */
export const corner = (i: number): Vec3 => [i & 1, (i >> 1) & 1, (i >> 2) & 1];

/** corner ids a shape occupies (union of its face loops) */
export const SHAPE_CORNERS: Record<ShapeId, readonly number[]> = Object.fromEntries(
  (Object.keys(FACES).map(Number) as ShapeId[]).map(s => [
    s, [...new Set(FACES[s].flat())].sort((a, b) => a - b),
  ]),
) as unknown as Record<ShapeId, readonly number[]>;

/** mean of the corner set — strictly interior for these convex solids, so a
    facet normal is outward iff it points away from it */
export const SHAPE_CENTROID: Record<ShapeId, Vec3> = Object.fromEntries(
  (Object.keys(FACES).map(Number) as ShapeId[]).map(s => {
    const ids = SHAPE_CORNERS[s];
    const m = ids.reduce<[number, number, number]>((a, i) => {
      const c = corner(i);
      return [a[0] + c[0], a[1] + c[1], a[2] + c[2]];
    }, [0, 0, 0]);
    return [s, m.map(x => x / ids.length) as unknown as Vec3];
  }),
) as Record<ShapeId, Vec3>;

/** how much of its cell a shape fills — AO weight */
export const SHAPE_FILL: Record<ShapeId, number> = { 0: 1, 1: 0.8, 2: 0.55, 3: 0.3 };

export const SHAPE_NAMES: Record<ShapeId, string> = { 0: 'k8', 1: 'k7', 2: 'k6', 3: 'k4' };

/** wing outline rings as corner ids (Wing corner table 0x1db7148) */
export const WING_RING: Record<number, readonly number[]> = {
  0: [0, 1, 3, 2], 1: [0, 1, 2], 2: [0, 1, 7, 6], 3: [0, 1, 7], 4: [1, 4, 7],
};
/** engine names = squared edge lengths (names table 0x1db7130) */
export const WING_NAMES: Record<number, string> = {
  0: 'w1111', 1: 'w121', 2: 'w2121', 3: 'w321', 4: 'w222',
};
export const WING_KINDS = [0, 1, 2, 3, 4] as const;

/** compartment id → display name (russian, as in the exe) */
export const COMP_NAMES: Record<number, string> = {
  0: 'энергия', 1: 'ЦП', 2: 'обитаемый', 3: 'гироскоп', 4: 'баки',
  5: 'орудия', 6: 'двигатели', 7: 'ангар', 8: 'корпус', 9: 'мостик',
};
export const HULL_COMP = 8;
export const COMP_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** R·(v−½)+½ — rotate a unit-cell point about the cell centre */
export function rot(o: number, v: Vec3): [number, number, number] {
  const m = ORIENTATIONS[o];
  const x = v[0] - 0.5, y = v[1] - 0.5, z = v[2] - 0.5;
  return [
    m[0] * x + m[1] * y + m[2] * z + 0.5,
    m[3] * x + m[4] * y + m[5] * z + 0.5,
    m[6] * x + m[7] * y + m[8] * z + 0.5,
  ];
}

/** rotate a direction (no centre shift) */
export function rotDir(o: number, v: Vec3): [number, number, number] {
  const m = ORIENTATIONS[o];
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/* ── reflection across x (the fleet's mirror axis) ──────────────
   Reflecting a rotated shape across a grid plane x=const maps its cell to the
   mirrored cell and, within the cell, x → 1−x (S = diag(−1,1,1) about the cell
   centre). The mirrored orientation must satisfy R′·C = S·R·C on the base
   corner set C. Pick a group element t with R_t·C = S·C and (S·R_t)² = I — an
   actual mirror symmetry of the solid — then R′ = S·R·S·R_t works for every o
   and the table is an involution by construction: applying it twice yields
   R·(S·R_t)² = R. Such a t exists for all four shapes and all five wing rings
   (they are achiral under this reflection; verified at module init). */

const key = (pts: [number, number, number][]) =>
  pts.map(p => p.join(',')).sort().join('|');

const reflPts = (axis: 0 | 1 | 2, pts: [number, number, number][]): [number, number, number][] =>
  pts.map(p => {
    const q: [number, number, number] = [...p];
    q[axis] = 1 - q[axis];
    return q;
  });

const matMul = (a: readonly number[], b: readonly number[]): number[] => {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};
/** conjugate/sandwich with S = diag(±1) flipping `axis`: negates the
    off-diagonal entries of that row and column */
const sandwich = (axis: 0 | 1 | 2, m: readonly number[]): number[] =>
  m.map((v, i) => {
    const r = Math.floor(i / 3), c = i % 3;
    return (r === axis) !== (c === axis) ? -v : v;
  });
const matIndex = (m: readonly number[]): number =>
  ORIENTATIONS.findIndex(n => n.every((v, i) => v === m[i]));

function buildReflTable(axis: 0 | 1 | 2, cornersOf: (o: number) => [number, number, number][]): number[] {
  const base = key(cornersOf(0));           // o=0 is the identity
  const target = key(reflPts(axis, cornersOf(0)));
  const t = Array.from({ length: 24 }, (_, i) => i).find(i => {
    if (key(cornersOf(i)) !== target) return false;
    // (S·R_t)² = I  ⇔  S·R_t·S = R_t⁻¹ = R_tᵀ  ⇔  sandwich(R_t) is R_t transposed
    const m = ORIENTATIONS[i], s = sandwich(axis, m);
    return s[0] === m[0] && s[1] === m[3] && s[2] === m[6] && s[3] === m[1]
      && s[4] === m[4] && s[5] === m[7] && s[6] === m[2] && s[7] === m[5] && s[8] === m[8];
  });
  if (t === undefined) throw new Error(`no involutive mirror for base ${base}`);
  const rt = ORIENTATIONS[t];
  return Array.from({ length: 24 }, (_, o) => {
    const idx = matIndex(matMul(sandwich(axis, ORIENTATIONS[o]), rt));
    if (idx < 0) throw new Error(`reflection left the group at o=${o}`);
    return idx;
  });
}

const AXES = [0, 1, 2] as const;

/** REFLECT_SHAPE[axis][shape][o] → o′ such that (shape,o′) is the mirror of
    (shape,o) across that world axis */
export const REFLECT_SHAPE: readonly Record<ShapeId, readonly number[]>[] = AXES.map(a =>
  Object.fromEntries(
    (Object.keys(FACES).map(Number) as ShapeId[]).map(s => [
      s, buildReflTable(a, o => SHAPE_CORNERS[s].map(i => rot(o, corner(i)))),
    ]),
  ) as unknown as Record<ShapeId, readonly number[]>);

/** REFLECT_WING[axis][kind][o] → o′ for wing rings */
export const REFLECT_WING: readonly Record<number, readonly number[]>[] = AXES.map(a =>
  Object.fromEntries(
    WING_KINDS.map(k => [
      k, buildReflTable(a, o => WING_RING[k].map(i => rot(o, corner(i)))),
    ]),
  ));

/** the fleet's mirror axis — kept as the names symmetry.ts was built on */
export const REFLECT_X_SHAPE = REFLECT_SHAPE[0];
export const REFLECT_X_WING = REFLECT_WING[0];

/* ── 90° world-axis rotation steps through the group ────────────
   Composing a quarter-turn about a world axis onto an orientation stays inside
   the 24 (signed permutations are closed under multiplication), so each axis
   defines a permutation of orientation indices; the reverse direction is its
   inverse permutation. */

const AXIS_STEP: readonly (readonly number[])[] = [
  [1, 0, 0, 0, 0, -1, 0, 1, 0],   // Rx(+90°): (x,y,z) → (x,−z,y)
  [0, 0, 1, 0, 1, 0, -1, 0, 0],   // Ry(+90°): (x,y,z) → (z,y,−x)
  [0, -1, 0, 1, 0, 0, 0, 0, 1],   // Rz(+90°): (x,y,z) → (−y,x,z)
];

const ROT_PLUS: readonly (readonly number[])[] = AXIS_STEP.map(step =>
  ORIENTATIONS.map(m => {
    const idx = matIndex(matMul(step, m));
    if (idx < 0) throw new Error('axis rotation left the group');
    return idx;
  }));
const ROT_MINUS: readonly number[][] = ROT_PLUS.map(t => {
  const inv = new Array<number>(24);
  t.forEach((v, o) => { inv[v] = o; });
  return inv;
});

/** compose a ±90° rotation about world axis 0/1/2 (x/y/z) onto orientation o */
export function rotateOrient(o: number, axis: 0 | 1 | 2, dir: 1 | -1): number {
  return (dir === 1 ? ROT_PLUS : ROT_MINUS)[axis][o];
}

/* ── plate slots ────────────────────────────────────────────────
   Each cube stores 7 plate slots: the six cube-local axis faces in order
   [+x,−x,+y,−y,+z,−z] plus the shape's non-axis face (k7 cut / k6 slope /
   k4 diagonal) as slot 6. Established by fleet-wide correlation of the
   per-slot presence bytes with face exteriority (local order won 83% vs 56%
   on rotated cubes; axis assignment 95-99% at o=0). */

/** local axis directions in slot order */
export const SLOT_AXES: readonly Vec3[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** FACE_SLOT[shape][faceIndex] → slot index 0..6 (6 = the non-axis face).
    Faces are in local corner space, so orientation never enters. */
export const FACE_SLOT: Record<ShapeId, readonly number[]> = Object.fromEntries(
  (Object.keys(FACES).map(Number) as ShapeId[]).map(s => [
    s,
    FACES[s].map(loop => {
      const pts = loop.map(corner);
      for (let a = 0; a < 3; a++) {
        if (pts.every(p => p[a] === 1)) return a * 2;       // +axis
        if (pts.every(p => p[a] === 0)) return a * 2 + 1;   // −axis
      }
      return 6;
    }),
  ]),
) as unknown as Record<ShapeId, readonly number[]>;

/** number of plate slots the exe considers per shape (platesCount, 0x440120) */
export const PLATES_COUNT: Record<ShapeId, number> = { 0: 6, 1: 7, 2: 5, 3: 4 };

/* Axis plates are authored on the cell's z=0 face (relief to −z, outward) and
   mounted by rotating about the cell centre by ORIENTATIONS[slot.o]; the face
   a plate decorates is therefore R(slot.o)·(0,0,−1) in WORLD coordinates —
   confirmed fleet-wide (98% at cube o=0, 87% presence-exteriority agreement on
   rotated cubes vs ≤59% for any slot-index-based frame). */

/** world direction of the face a plate with orientation o decorates */
export const plateFaceDir = (o: number): [number, number, number] => rotDir(o, [0, 0, -1]);

/** canonical (smallest) orientation mounting a plate on each SLOT_AXES direction */
export const PLATE_CANON: readonly number[] = SLOT_AXES.map(axis => {
  for (let o = 0; o < 24; o++) {
    const d = plateFaceDir(o);
    if (d[0] === axis[0] && d[1] === axis[1] && d[2] === axis[2]) return o;
  }
  throw new Error('unreachable: every axis is hit by some orientation');
});

/** Canonical mount orientation for a FRESH plate on the face of `cube` that
    points along world `dir` — of the four spins that land on that face, pick
    one whose footprint lies on the shape's actual face. For a triangular face
    (wedge/tetra sides) only one spin covers the material half; the p121 plate
    is authored over corners (0,0),(1,0),(0,1) of the z=0 cell face. */
export function plateCanonical(
  shape: ShapeId, cubeO: number, dir: readonly [number, number, number],
): number {
  const M = ORIENTATIONS[cubeO];
  const local: [number, number, number] = [
    M[0] * dir[0] + M[3] * dir[1] + M[6] * dir[2],
    M[1] * dir[0] + M[4] * dir[1] + M[7] * dir[2],
    M[2] * dir[0] + M[5] * dir[1] + M[8] * dir[2],
  ];
  const axis = SLOT_AXES.findIndex(a =>
    a[0] === Math.round(local[0]) && a[1] === Math.round(local[1]) && a[2] === Math.round(local[2]));
  const fi = axis >= 0 ? FACE_SLOT[shape].indexOf(axis) : -1;
  const faceCorners = fi >= 0
    ? new Set(FACES[shape][fi].map(ci => corner(ci).join(',')))
    : null;
  /* authored tri plate corners on the z=0 cell face */
  const authored: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  let fallback = -1;
  for (let o = 0; o < 24; o++) {
    const d = plateFaceDir(o);
    if (d[0] !== dir[0] || d[1] !== dir[1] || d[2] !== dir[2]) continue;
    if (fallback < 0) fallback = o;
    if (!faceCorners) return o;
    /* world mount = R(o); into the local frame via R(cubeO)ᵀ */
    const ok = authored.every(p => {
      const w = rot(o, p);
      const l = [
        M[0] * (w[0] - 0.5) + M[3] * (w[1] - 0.5) + M[6] * (w[2] - 0.5) + 0.5,
        M[1] * (w[0] - 0.5) + M[4] * (w[1] - 0.5) + M[7] * (w[2] - 0.5) + 0.5,
        M[2] * (w[0] - 0.5) + M[5] * (w[1] - 0.5) + M[8] * (w[2] - 0.5) + 0.5,
      ];
      return faceCorners.has(l.map(Math.round).join(','));
    });
    if (ok) return o;
  }
  return fallback;
}

/** face kind on each local axis (SLOT_AXES order) per shape: the plate mesh a
    mounted plate needs there — full quad, corner triangle, or no face at all */
export const AXIS_FACE_KIND: Record<ShapeId, readonly ('quad' | 'tri' | null)[]> =
  Object.fromEntries(
    (Object.keys(FACES).map(Number) as ShapeId[]).map(s => {
      const kinds: ('quad' | 'tri' | null)[] = [null, null, null, null, null, null];
      FACES[s].forEach((loop, fi) => {
        const slot = FACE_SLOT[s][fi];
        if (slot < 6) kinds[slot] = loop.length === 4 ? 'quad' : 'tri';
      });
      return [s, kinds];
    }),
  ) as unknown as Record<ShapeId, readonly ('quad' | 'tri' | null)[]>;

/** exe PLATE_TYPE[shape][plateIndex] names, table 0x1db70b0 / 0x1db7218:
    face plate types by geometry — axis quad p1111, axis tri p121,
    k6 slope p2121, k4 diagonal p222A, k7 cut p222V. */
export const PLATE_TYPE_NAMES = ['p1111', 'p121', 'p2121', 'p222A', 'p222V'] as const;
