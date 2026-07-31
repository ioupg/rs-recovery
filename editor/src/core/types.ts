/* Domain types for the RedStar constructor. Core stays three.js-free so the
   model, commands and validation run under vitest without a DOM or GL. */

export type Vec3 = readonly [number, number, number];

/** 0 cube · 1 corner-cut (k7) · 2 wedge (k6) · 3 tetra (k4) */
export type ShapeId = 0 | 1 | 2 | 3;

/** Per-face decoration plate slot, layout settled 2026-07-31: seven slots per
    cube — six axis faces in CUBE-LOCAL order [+x,−x,+y,−y,+z,−z] plus the
    shape's non-axis face (k7 cut / k6 slope / k4 diagonal) as slot 6.
    o = plate orientation (0..23), p = plate present, f = unexplained flag
    preserved for round-trip. */
export interface PlateSlot { o: number; p: number; f: number }

export interface Cube {
  /** editor-internal identity, stable across moves/patches; never exported */
  uid: number;
  x: number; y: number; z: number;
  /** 0..23 — index into ORIENTATIONS (the cube rotation group) */
  o: number;
  shape: ShapeId;
  /** 0..9 — compartment (энергия … мостик) */
  comp: number;
  /* archive fields, preserved verbatim through import/export;
     absent on cubes placed in the editor (regenerated on export) */
  id?: number;
  flag?: number;
  variant?: number;
  counter?: number;
  slots?: PlateSlot[];
}

export interface Wing {
  uid: number;
  /** 0..4 — index into WING_RING / WING_NAMES (w1111 w121 w2121 w321 w222) */
  kind: number;
  x: number; y: number; z: number;
  o: number;
  /** unknown archive fields preserved verbatim */
  extra?: Record<string, unknown>;
}

export interface ShipMeta {
  name: string;
  display: string;
  class?: string;
  nation?: string;
  rank?: string;
}

/* ── PBR materials ─────────────────────────────────────────── */

/** `comp<N>` per registered system, plus 'wing'. Dynamic since the systems
    registry became extensible — the known set lives in materials.ts. */
export type MaterialSlot = string;
export const WING_SLOT: MaterialSlot = 'wing';

export interface MaterialDef {
  /** '#rrggbb' */
  color: string;
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  clearcoat: number;
  clearcoatRoughness: number;
}

export type MaterialSet = Record<MaterialSlot, MaterialDef>;

/* ── extra element kinds (JSON-only; ignored by the 2014 binary format) ──
   Engine-prototype schema per notes/07-authoring.md §4.3. All three are
   procedural, like wings. */

/** truss spanning a straight run of cells */
export interface LatticeEl {
  uid: number;
  kind: 'lattice';
  from: Vec3;
  to: Vec3;
  profile: 'square' | 'tri';
  /** corner chord thickness (cell units) */
  chord: number;
  /** diagonal brace thickness (cell units) */
  brace: number;
}

/** registry mesh glued to a hull face */
export interface DecoEl {
  uid: number;
  kind: 'deco';
  meshId: string;
  anchor: { cell: Vec3; face: number; offset: readonly [number, number] };
  o: number;
}

/** cable between two cell corners (corner index 0..7) */
export interface GuyEl {
  uid: number;
  kind: 'guy';
  a: { cell: Vec3; corner: number };
  b: { cell: Vec3; corner: number };
  /** 0 = straight; otherwise quadratic sag depth in cell units */
  sag: number;
}

export type ExtraElement = LatticeEl | DecoEl | GuyEl;

/* ── the document ──────────────────────────────────────────── */

export interface ShipDoc {
  meta: ShipMeta;
  cubes: Cube[];
  wings: Wing[];
  /** per-slot overrides of the default material set, embedded on export */
  materials?: Partial<MaterialSet>;
  /** lattice/deco/guy prototypes — JSON extension, absent on archive ships */
  extras?: ExtraElement[];
}

/* ── validation ────────────────────────────────────────────── */

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  /** entities involved, when attributable */
  uids?: number[];
}

/* ── change events ─────────────────────────────────────────── */

export type ChangeKind = 'cubes' | 'wings' | 'meta' | 'materials' | 'reset';

export type Unsubscribe = () => void;
