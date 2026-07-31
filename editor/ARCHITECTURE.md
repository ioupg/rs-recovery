# RS Constructor — architecture contract

Vite + TypeScript + three.js (r185) app. Ships as `/editor` next to the untouched
viewer (`../viewer`). Build: `npm run build` → `../viewer/editor` (deployed by
`wrangler deploy` from repo root).

**Hard rules**

- `src/core/**` is **three.js-free** (runs under vitest in node). Rendering lives in `src/render/**`.
- The exe-derived tables in `src/core/tables.ts` are frozen facts — never edit values.
- `FACES` loop order defines the plate-mapping frame. Never reorder loops. Winding is
  not consistently outward: orient normals against `SHAPE_CENTROID` (see `orient()` in
  the reference viewer `../viewer/index.html:258`).
- Strict TS, no `any` unless unavoidable. Match existing code style (comment sparsely,
  state constraints not narration).
- Reference implementation for all geometry ports: `../viewer/index.html`
  (AO 213-249, orient 258-264, chamfer 266-363, atlas 370-470, facet collect+cull
  763-798, mesh-mode shells 800-860 / filler 861-886 / plates 887-953, plate-mode
  974-1051, wings 1053-1096). Port faithfully — this code embodies validated
  reverse-engineering; deviations cost days before.

## Module map

```
src/core/    types.ts tables.ts materials.ts   (done — read them first)
             model.ts commands.ts history.ts symmetry.ts validation.ts io.ts
src/data/    loader.ts                          (done)
src/render/  scene.ts materialCache.ts geometry.ts ao.ts chamfer.ts atlas.ts
             pick.ts shipView.ts viewports.ts exportGlb.ts
src/editor/  state.ts tools.ts controller.ts
src/ui/      style.css ui.ts panels/*.ts
src/main.ts  (integration)
```

## Core contracts

### model.ts

```ts
export class ShipModel {
  readonly doc: ShipDoc;
  // queries
  cubeAt(x: number, y: number, z: number): Cube | undefined;
  wingAt(x: number, y: number, z: number): Wing | undefined; // first match
  byUid(uid: number): Cube | Wing | undefined;
  isCube(e: Cube | Wing): e is Cube;             // 'shape' in e
  bounds(): { min: Vec3; max: Vec3 } | null;     // over cubes + wings
  nextUid(): number;                             // monotonic
  // mutations — called ONLY by commands
  addCube(c: Cube): void;                        // throws if cell occupied by a cube
  removeCube(uid: number): Cube;                 // returns removed (for revert)
  patchCube(uid: number, patch: Partial<Cube>): Partial<Cube>; // returns inverse patch
  addWing(w: Wing): void;
  removeWing(uid: number): Wing;
  patchWing(uid: number, patch: Partial<Wing>): Partial<Wing>;
  setMeta(patch: Partial<ShipMeta>): Partial<ShipMeta>;
  // lifecycle
  load(doc: ShipDoc): void;                      // resets uids index, emits 'reset'
  subscribe(fn: (kind: ChangeKind) => void): Unsubscribe;
  batch<T>(fn: () => T): T;                      // coalesce events into one emit
}
```

Cell index key `x,y,z`. Moving a cube = patchCube with new x/y/z (index updates).

### commands.ts

```ts
export interface Command { readonly label: string; apply(m: ShipModel): void; revert(m: ShipModel): void }
```

`AddCubes(cubes: Cube[])`, `RemoveCubes(uids)` (captures removed on apply),
`PatchCubes(entries: {uid, patch}[])` (captures inverse patches on apply),
`AddWings/RemoveWings/PatchWings` likewise,
`MoveEntities(uids: number[], delta: Vec3)` (patches x/y/z of cubes+wings; caller
pre-validates collisions), `Composite(label, commands)` (applies in order, reverts
in reverse). All commands wrap mutations in `model.batch()`.

### history.ts

```ts
export class History {
  constructor(model: ShipModel);
  run(cmd: Command): void;      // apply + push, truncates redo
  undo(): boolean; redo(): boolean;
  readonly canUndo: boolean; readonly canRedo: boolean;
  clear(): void;
  subscribe(fn: () => void): Unsubscribe;
}
```

### symmetry.ts

Mirror across grid plane `x = planeX2 / 2` (integer `planeX2` allows half-cell
planes). Cell map: `x' = planeX2 - 1 - x` for CELLS (cell [x, x+1) reflects to
[planeX2-1-x, planeX2-x)). Orientation via `REFLECT_X_SHAPE` / `REFLECT_X_WING`
from tables.ts.

```ts
export function detectPlaneX2(model: ShipModel): number;   // min+max+1 over cube cells x → planeX2; 39/43 fleet ships mirror on x
export function mirrorCubeSpec(c: Omit<Cube,'uid'|'slots'|'id'|'counter'>, planeX2: number): same;
export function mirrorWingSpec(w: Omit<Wing,'uid'>, planeX2: number): same;
// a spec is self-mirrored when cell AND shape AND orientation map to themselves
export function isSelfMirrored(...): boolean;
```

Symmetry application happens in `editor/controller.ts`: tools produce primitive
specs, controller expands them with mirrors (skipping self-mirrored duplicates and
cells already occupied by the mirror twin) into one `Composite`.

### validation.ts

`export function validate(model: ShipModel): Issue[]` — rules:

- `range` (error): o∉0..23, shape∉0..3, comp∉0..9, kind∉0..4
- `overlap` (error): two cubes in one cell; wing in a cube-occupied cell
- `wing-anchor` (warning): wing with no face-adjacent cube cell (fleet invariant:
  wings sit in empty cells anchored to the hull along an edge)
- `disconnected` (warning): cube cells form >1 face-adjacency component

### io.ts

```ts
export function importShip(entry: ShipEntry, name?: string): ShipDoc;      // assigns uids; preserves id/flag/variant/counter/slots
export function importShipJson(json: unknown, fallbackName: string): ShipDoc; // recovered/*.json shape {cubes, elements} + optional {meta, materials}
export function exportShipJson(doc: ShipDoc, slotDefaults: PlateSlot[][]): unknown;
```

Export emits `{cubes, elements, meta, materials?}` — cubes in RawCube shape;
archive fields regenerated when absent: `id` = sequential from max preserved id+1,
`flag` 0, `variant` 0, `counter` sequential, `slots` = `slotDefaults[o]` (6 entries).
Round-trip of an unedited import must be byte-equal for cubes/elements fields.

## Render contracts

### Materials

`MaterialCache` (render/materialCache.ts) wraps `MaterialStore`: lazily builds
`THREE.MeshPhysicalMaterial` per slot with `vertexColors: true` (vertex color
carries AO/tone only — base color comes from the material). Rebuilds on store
change. Option `textures: boolean` → sets the procedural atlas as `.map`
(plate mode only). Option `compColors: false` remaps every compN slot to comp8's
material at mesh-assembly time (do not mutate defs).

### geometry.ts

Shared types live in `render/geometryTypes.ts` (done — RenderMode, BuildOptions,
BuiltShip, PickTri, ViewportLayout). Builders are **pure functions over ShipDoc**
(not ShipModel) — occupancy is computed internally from doc.cubes, exactly like
the reference viewer does.

```ts
export function buildShipGeometry(doc: ShipDoc, data: GameData, opts: BuildOptions): BuiltShip;
```

- **box**: facet collect + interior cull (viewer 763-798), fan-triangulate, flat
  normals, AO in vertex color when on. No chamfer/atlas/plates. Wings included
  (slot 'wing'). This is the fast editing mode.
- **plate**: box + chamfer(0.07) + atlas UVs + facet tone jitter (viewer 974-1051).
- **mesh**: shells + interior modules + inset filler + decoration plates + wings
  (viewer 800-953). Module/filler/plate brightness factors (0.78/0.55/1.06) bake
  into vertex color. `window` scale + PLATE_MARGIN = 0.985, FILL_INSET = 0.045,
  MODULE_SCALE = 0.88.
- Vertex color = AO (and tone factors) in all modes; grouping by cube comp slot.

### pick.ts

```ts
export function buildPickGeometry(doc: ShipDoc): { geometry: THREE.BufferGeometry; tris: PickTri[] };
```

Raycast against this invisible mesh regardless of render mode; `faceIndex` of the
hit triangle indexes `tris`. Ground plane y=0 is the fallback target for placing
into an empty world.

### shipView.ts

Owns ship mesh (material array from cache + groups), edge lines overlay, pick mesh,
selection highlight (overlay of selected cubes' facets, additive/emissive),
ghost preview mesh (single shape solid at cell, semi-transparent, red when invalid).
Subscribes to model/materials/options; `rebuild()` disposes and rebuilds on change.

### viewports.ts

```ts
export type ViewportLayout = 'single' | 'quad';
export class Viewports {
  constructor(container: HTMLElement, renderer: THREE.WebGLRenderer);
  layout: ViewportLayout;                   // single = perspective; quad = persp + top + front + side orthos
  render(scene: THREE.Scene): void;         // scissored per viewport
  pickRay(clientX: number, clientY: number): { camera: THREE.Camera; ndc: THREE.Vector2 } | null;
  fit(bounds: { min: Vec3; max: Vec3 }): void;
  onResize(): void;
}
```

Controls: **MMB or Alt+LMB** orbit (perspective only), **RMB** pan, **wheel** zoom
— LMB belongs to tools. Port the damped orbit feel from viewer 716-734. Ortho
cameras: top (−y), front (−z), side (−x), with zoom/pan.

### scene.ts

Renderer (antialias, shadows PCFSoft), `THREE.RoomEnvironment` PMREM as
`scene.environment` (PBR needs it), hemisphere + key directional (shadow) + rim
per viewer 484-495, grid + floor per 497-504, background #0A0E14, fog off in
ortho views (leave fog out entirely for the editor).

### exportGlb.ts

`exportGlb(view: BuiltShip-bearing scene subset, name: string): Promise<Blob>` via
`GLTFExporter` (binary). Materials come through as metallic-roughness PBR.

## Editor layer

### state.ts — single mutable EditorState with change events

```ts
tool: 'select' | 'add' | 'erase' | 'paint' | 'wing';
activeShape: ShapeId; activeOrient: number; activeComp: number; activeWingKind: number;
selection: Set<number>;                     // uids
symmetry: { on: boolean; planeX2: number };
render: BuildOptions & { edges: boolean; compColors: boolean };
layout: ViewportLayout;
plateVariant: number;
```

### tools/controller

Pointer flow: hover → raycast pick → tool decides ghost/cursor; LMB down/up/click
→ tool builds command (with symmetry expansion) → `history.run`. Drag-move in
select tool: XZ-plane constrained integer drag (Shift = Y), one `MoveEntities` on
drop, pre-checked for collisions. Keyboard: 1-5 tools, R/Shift+R rotate active
orientation (cycle 24), Q/E cycle compartment, Del delete selection, Ctrl+Z/Y
undo/redo, F fit view, Tab toggle single/quad, X toggle symmetry.

## UI

The UI builds against `src/ui/context.ts` (done — UiContext with structural
HistoryLike/ModelLike so it compiles independently of core). Entry:
`export const buildUi: BuildUi` in `src/ui/ui.ts`; main.ts supplies real objects.

Visual language of the viewer (port CSS vars/fonts from viewer/index.html:8-120).
Layout: header toolbar; left rail = fleet list (from `data.ships`) + file ops
(new / import JSON / export JSON / export GLB); right panel = tabs [Build |
Materials | Info]; status bar = validation issues + counts + hover cell.
Build tab: shape picker (4), orientation stepper (0..23 + visual), compartment
palette (10 swatches), wing kind picker (5). Materials tab: slot list with color
swatch + sliders (color, roughness, metalness, emissive+intensity, clearcoat(+R),
reset per slot). Info: ГОСТ-stamp style ship card (viewer stamp(), 1121-1145).
