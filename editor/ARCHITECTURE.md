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
  (AO, orient, atlas, facet collect+cull, mesh-mode shells/cages/plates,
  plate-mode, wings — the two implementations stay in lockstep). Port
  faithfully — this code embodies validated reverse-engineering; deviations
  cost days before.
- Flush composition contract (2026-07-31, measured from the =default parts):
  every archive part is authored in the unit cell and mates exactly on the
  cell boundary planes — plate backs and shell rims lie in the face planes,
  cages mount full size. Mesh mode renders FrontSide, and coincident surfaces
  always face opposite ways, so nothing z-fights and nothing needs an inset,
  margin, or scale factor. Do not reintroduce PLATE_MARGIN / FILL_INSET /
  MODULE_SCALE-style constants; if a fight appears, the geometry or winding
  is wrong, not the mounting.

## Module map

```
src/core/    types.ts tables.ts materials.ts systems.ts   (read them first)
             model.ts commands.ts history.ts symmetry.ts validation.ts io.ts
src/data/    loader.ts plates.ts
src/render/  scene.ts materialCache.ts textureCache.ts geometry.ts ao.ts
             atlas.ts facets.ts pick.ts shipView.ts viewports.ts viewCube.ts
             shapePreview.ts exportGlb.ts
src/editor/  state.ts tools.ts controller.ts symmetryExpand.ts
src/ui/      style.css ui.ts context.ts dom.ts panels/*.ts
src/main.ts  (integration)
```

v2 registries (2026-07-31): `core/systems.ts` — data-driven system roster
(ids 0..9 frozen archive block, ids ≥ 10 JSON-only registrations; material
slots derive from it); `data/plates.ts` — every mountable plate mesh behind
`PlateRegistry` (faceType quad/tri/slope/diag/cut). `ShipDoc.extras` carries
the lattice/deco/guy prototype elements (notes/07-authoring.md §4.3).

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
- **mesh**: shells + interior cages (every cube — plain hull carries m1*slot)
  + decoration plates + wings, all mounted flush at scale 1 and rendered
  FrontSide (wing slot stays DoubleSide for the zero-thickness w2121
  fallback). Module/plate brightness factors (0.78/1.06) bake into vertex
  color. No filler, no margins.
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

### viewports.ts + viewCube.ts

```ts
export class Viewports {
  constructor(container: HTMLElement, renderer: THREE.WebGLRenderer);
  render(scene: THREE.Scene): void;
  update(dt: number): void;                 // damped orbit / snap easing, once per frame
  getOrbit(): { th: number; ph: number };
  snapTo(th: number, ph: number): void;     // eased canonical views (view cube)
  orbitBy(dx: number, dy: number): void;
  pickRay(clientX: number, clientY: number): { camera: THREE.Camera; ndc: THREE.Vector2 } | null;
  fit(bounds: { min: Vec3; max: Vec3 }): void;
  onResize(): void;
}
```

Single perspective viewport (the quad/ortho layout was removed in v2 — view
snapping replaced it). Controls: **MMB or Alt+LMB** orbit, **RMB** pan,
**wheel** zoom — LMB belongs to tools. Damped orbit feel from viewer 716-734.
`ViewCube` (render/viewCube.ts) is a 2D-canvas overlay: click a face to snap,
drag to orbit, ⌂ fits. (A selection rotation gizmo was tried and dropped
by user decision — rotation lives on X/C/V + the panel buttons.)

### Surface textures + per-face plates (v2)

`SurfaceStore` (core/materials.ts) holds one `SurfaceDef` per archive texture
(normalScale, roughnessK/metalnessK multipliers over the slot material,
envIntensity, tint); `MaterialCache` applies it live and `exportShipJson`
embeds the diff as `surfaces`. `Cube.plateKinds` (7 registry ids parallel to
slots) selects a per-face plate mesh; the geometry builder resolves it
through `data.plates` with face-type matching, and the Plates tool mounts /
swaps / removes with the panel's visual picker. The Systems (naked) view
shows plain cages tinted per system when the tint toggle is on; toggling it
off restores the authentic untinted `system_colors` palette.

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
tool: 'select' | 'build' | 'erase' | 'systems' | 'plate';
buildKind: 'shape' | 'wing';                // Build places both item families
activeShape: ShapeId; activeOrient: number; activeComp: number; activeWingKind: number;
selection: Set<number>;                     // uids
symmetry: { on: boolean; planeX2: number };
render: BuildOptions & { edges: boolean; compColors: boolean };
```

### tools/controller

`editor/tools.ts` is the single source of truth for tools and view modes
(ids, icons, shortcuts, per-tool auto view mode) — the header toolbar and the
keymap both read it. A tool with `needsMode` switches the render mode on
entry and the controller restores the previous mode on exit unless the user
changed modes manually meanwhile (Systems tool → Systems view; Plates → Mesh).

Pointer flow: hover → raycast pick → tool decides ghost/cursor; LMB down/up/click
→ tool builds command (with symmetry expansion) → `history.run`. Drag-move in
select tool: XZ-plane constrained integer drag (Shift = Y), one `MoveEntities` on
drop, pre-checked for collisions.

Keyboard (see editor/tools.ts + controller onKey): 1–5 tools · 7/8/9/0 view
modes · X/C/V rotate ±90° about world X/Y/Z (Shift reverses) · Alt+X/C/V
mirror along an axis (REFLECT_SHAPE/REFLECT_WING tables, all three axes) ·
R/Shift+R cycle 24 orientations or spin a hovered plate · Q/E cycle the
active item/system/plate mesh · M symmetry · F fit · P plates · G edges ·
Del delete · Ctrl+Z/Y undo/redo · Esc deselect.

## UI

The UI builds against `src/ui/context.ts` (UiContext with structural
HistoryLike/ModelLike so it compiles independently of core). Entry:
`export const buildUi: BuildUi` in `src/ui/ui.ts`; main.ts supplies real objects.

Visual language of the viewer (CSS vars/fonts from viewer/index.html:8-120).
Chrome is mono-language English; data strings (ship names, the exe's system
names, the ГОСТ stamp) stay Russian by design.

Layout: header = file ops (New / Load… / Import / Save / GLB) + icon tool
buttons + view modes + toggles + symmetry + undo/redo + fit; stage hosts the
canvas + view cube; right panel = tabs [<active tool> | Materials | Info] —
the first tab is contextual, renamed and activated with the tool:

- **Select** — selection info, rotate/mirror rows, delete.
- **Build** — piece preview canvas, unified item picker (4 shapes + 5 wings
  as offscreen-rendered thumbnails, `renderThumbnail` in shapePreview.ts),
  orientation stepper + rotate/mirror rows, system palette.
- **Erase** — hint only.
- **Systems** — system palette with live per-system counts.
- **Plates** — plate mesh picker.

Every tool page ends with its shortcut legend. Fleet loading is a modal
(`panels/loadModal.ts`, ship cards grouped by rank) opened from the header;
a "saved designs — this browser" section on top lists localStorage saves
(`data/localDesigns.ts`, key `rs.editor.designs.v1`, payload = the exported
ship JSON so save/load shares the io path) with load + delete. Header Save =
save to browser storage (prompted name, overwrite allowed); Export = JSON
file download.
Materials tab: slot list (from the systems registry) with color swatch +
sliders. Info: ГОСТ-stamp ship card + system ledger + validation issues.
