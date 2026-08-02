# Status and handoff — start here

**Live:** https://rs.ioupg.com (fleet) · https://rs.ioupg.com/parts (mesh catalogue)
· https://rs.ioupg.com/editor/ (constructor)
**Repo:** working tree clean, deployed build matches the viewer at HEAD.

## Editor v2 (2026-07-31)

Full UX overhaul + extensibility: requirements/decisions in
`06-editor-v2.md`, part-authoring contract + Blender template in
`07-authoring.md` (+ `templates/authoring-template.glb`,
`make_authoring_template.py`). Highlights: English chrome, SVG icon toolbar,
load-template modal, contextual right panel with visual pickers
(shapes+wings unified, plate meshes with relief-facing schematic
thumbnails), view cube (quad layout removed), X/C/V rotate + Alt mirror on
all three axes (REFLECT tables generalized), Systems tool/view (tint ON =
plain system-colored cages; OFF = authentic untinted palette), per-face
plate mesh assignment (`Cube.plateKinds` through the plate registry),
per-texture surface PBR editor (`SurfaceStore`, persisted as `surfaces`),
systems registry (ids ≥ 10 JSON-only) and lattice/deco/guy engine
prototypes (`ShipDoc.extras`, render-only). A selection rotation gizmo was
tried twice and dropped by user decision. Normal-map sign chain verified
consistent (green = −Sobel-dy ↔ flipY=false derivative frame).

## The constructor (2026-07-30)

`editor/` is a Vite + TypeScript + three r185 app deployed to `/editor/` —
a full ship constructor built on the recovered format. The original viewer
is untouched. Structure and contracts: `editor/ARCHITECTURE.md`.

- **Render modes** box / plate / mesh — the geometry is a typed port of the
  viewer with **triangle-for-triangle parity** (positions, shades, atlas UVs,
  normals, edges) verified against the reference on three fleet ships.
- **PBR materials**: per-slot registry (10 compartments + wing),
  MeshPhysicalMaterial + RoomEnvironment; live material editor tab; overrides
  embed in exported JSON and carry into GLB.
- **Editing**: add/erase/paint/wing/select-move tools, 24-orientation stepper,
  undo/redo, validation (overlap / wing anchoring / connectivity).
- **Symmetry**: mirror across a grid-x plane (auto-detected, 39/43 fleet ships
  mirror on x). Orientation reflection = `S·R·S·R_t` with an involutive mirror
  symmetry `t` per solid — proven an involution, test-covered
  (`src/core/tables.ts`, `symmetry.test.ts`).
- **IO**: fleet load, JSON import/export (byte-exact round-trip of all 43
  ships tested; editor-created cubes get majority-vote plate slots per
  (orientation, slot) from the fleet), GLB export. Binary .rsconstruction
  writing: not done, format is fully known if wanted.
- **Data**: a Vite plugin regenerates `editor/public/data/*.json` from
  `viewer/ships.js` + `viewer/shapes.js` on every dev/build, so the python
  pipeline stays the single source of truth.

Workflow: `cd editor && npm run dev` · `npm test` (109 vitest) ·
`npm run build` (→ `viewer/editor/`) then `wrangler deploy` from the root.

---

## The problem

`RedStarEditor` (2014, in-house "SharedTec" engine) stored ship designs in
`.rsconstruction`. The editor still exists as a debug build but no longer runs
reliably, and the source tree is gone. The goal is to recover the designs —
geometry, structure and appearance — and view them in a browser.

Ships are voxel constructions: a grid of hull cubes, each with a shape, an
orientation from the 24-element rotation group of the cube, and a compartment
type, plus attached wings. The engine draws each cube as a **hull shell**, drops
an **interior module** inside it, and lays a **decoration plate** over each
exterior face.

---

## Solved, with evidence

| thing | how it was pinned down |
|---|---|
| `.rsconstruction` container | raw `fwrite` of live C++ objects: `u32 N`, N×148-byte cubes, `u32 M`, M×24-byte wings. 44/44 files account for every byte |
| cube fields | shape, orientation, grid x/y/z, compartment, plate slots. All ranges validated over 2001 cubes; 0 violations |
| 24 orientations | signed-permutation matrices lifted from the exe initialisers (`0x4020b0+`, table `0x22b7cf8`) |
| shape geometry | corner sets from `CarcassCube::vertexIndex` (table `0x1db7030`), counts from `verticesCount` (`0x4401a0`) |
| compartment ids | cross-checked against `ship-roster.csv` per-system counts, then independently corroborated when the exe's ten `m1*` module names turned up in the same order-of-systems |
| wings | fully procedural, not meshes. `Wing::verticesCount` (`0x4428e0`) + corner table (`0x1db7148`) + names (`0x1db7130`). Names are **squared edge lengths** — reconstructing each ring reproduces the engine's own name for all 5 types |
| wing placement | all 110 wings across the fleet sit in *empty* cells anchored to the hull along an edge — never inside it |
| `.compiled` mesh container | `u32 submeshCount`, then per submesh a material blob (floats, `0xCD` fill, two length-prefixed texture paths), a u32-counted 32-byte vertex block, a u32-counted u32 index block. **75/75 files decode** |
| second mesh format | one later export uses a 40-byte vertex (pos3, normal3, uv2, pad2) with the index block *first* and normals left as `0xCDCDCD`; normals are recomputed from winding, **flat per corner** — averaging across the hard rim edges of this thin shell cancels them, and the unlit rims read as gaps between cubes (`notes/gaps-offset.jpg`). This is the missing `k8` hull shell |
| mesh winding | D3D-style, **clockwise seen from outside**: on all 74 stored-normal meshes the winding cross-product is exactly opposite the stored (correct, outward) normals. The decoder flips every triangle to CCW so three.js front faces are the exterior — without this, `DoubleSide` inverts lighting normals on all outside surfaces, and the recomputed `k8` normals come out inward |
| plate mounting | plates are authored with the mounting back at z=0 and the relief extending to **−z** (same D3D-handed convention as the winding). The viewer mounts them **mirrored along the facet normal** — back on the face plane, relief standing out of the hull. Mapped +z-along-normal instead, the relief sinks into the window and only the flat back shows |
| shape ↔ mesh | matched by corner set — a candidate qualifies only if its corners reproduce the exe's own table. `k7`, `k6`, `k4` each had exactly **one** candidate |
| hull shells are shells | each face is a 0.05 rim around an open window: area on the cell face is exactly `1 − 0.9² = 0.19` |
| naming vocabulary | `k8 k7 k6 k4` · `p1111 p121 p2121 p222A p222V` · `w1111 w121 w2121 w321 w222` · ten `m1*…` modules (tables at `0x1db7218`, `0x1db7130`, `0x1db71f0`) |

---

## Formerly blocked — SOLVED 2026-07-31 with the engine source

**Which mesh file is which named part** — cracked. The SharedTec engine source
(dropped into `tmp/`, untracked) contains the mechanism in
`resourceManager/resource.cpp`: `Resource::ID::computeCRC` = **standard CRC32
of the resource registration name**, printed decimal into
`<source>.<id>.compiled`. The name form is
`RedStar/parts/<file><node>=<variant>` (no separator between file and node).
Verified 14/14 on textures (bare filename), 25/75 on meshes — including
**every `=default` part**: the four shells (confirming the corner-set matching
by name), the five plate types, four of five wing skins, and all ten `m1*`
module cages, which binds cages to compartments exactly
(`m1*power`=comp0 … `m1*cargo`=comp9; the one non-cognate pair is
мостик↔cargo). The remaining 50 ids are artist-named variants
(two recovered: `=grid`); ships never store a variant, so the `=default` set
IS the 2014 appearance. Notably the default p1111 plate is a hazard-striped
placeholder — `_defaults.fbx` is literally the placeholder library.
Earlier brute-force failed because the file+node concatenation has no
separator; nobody guessed that form.

The old negative result about the per-slot byte being an orientation (not a
style id) still stands — variants were never persisted per face.

---

## Where we stopped — SOLVED (2026-07-31): per-face plates fully recovered

The cube record's slot region was re-derived by fleet-wide correlation with
face exteriority (the old 6×16 uniform read was partly wrong):

- six 16-byte slots at `40+16i` in **CUBE-LOCAL axis order [+x,−x,+y,−y,+z,−z]**
  (local beat world 83% vs 56% on rotated cubes): `{u8 plateOrientation;
  garbage; u8 noPlate @+8; garbage; u32 flag @+12}` — plate present ⇔ the
  `noPlate` byte is 0;
- a compact 7th slot in the tail for the shape's **non-axis face** (k7 cut /
  k6 slope / k4 diagonal): orientation `@136`, present ⇔ `@144 == 1`
  (note the opposite polarity); `counter` sits unaligned at `@129`.

All 12 006 slot orientations are valid group members. **324 exterior faces
across the fleet are genuinely bare** — real decoration state (six of them k7
cut faces). 316 slots keep a plate on faces later covered by a neighbour
(stale, culled at render); slots for faces a partial shape doesn't have read
as covered.

The exe's `PLATE_TYPE` table `@0x1db70b0` decodes as `[4][7]` u32 indices into
the name table `@0x1db7218` (`p1111 p121 p2121 p222A p222V`): k8 = 6×p1111;
k7 = p222V + 3 quads + 3 tris; k6 = p2121 + 2 quads + 2 tris; k4 = p222A +
3 tris — matching each shape's face inventory exactly, and settling A/V:
**p222A is k4's diagonal, p222V is k7's cut**. No dedicated p2121/p222 meshes
exist in the archive (the catalogue census re-run found none; the notes-04
"6 equilateral" were module cages) — the affine face frame shears the
quad/tri representatives onto those faces, as the engine's own defaults did.

The constructor renders plates **per face from the recovered slots**, offers
the mesh choice per plate *type* (p1111/p2121 pickers), and edits presence
per face with the plate tool (6) — symmetry-aware, undoable, round-tripping
through export. `parse_rsconstruction.py` emits the corrected 7-slot format
(`{o, p, f}`; `f` is the still-unexplained per-slot flag, preserved).

**Mounting model (2026-07-31, supersedes the affine-frame guess for axis
faces):** the plate is authored on the cell's z=0 face with relief outward to
−z and instanced by rotating about the cell centre by `ORIENTATIONS[slot.o]`
— the face a plate decorates is `R(slot.o)·(0,0,−1)` in WORLD coordinates.
Fleet evidence: 98% of o=0 slot orientations map (0,0,−1) onto their slot's
axis, and on rotated cubes presence-vs-exteriority agrees 87% under this
model vs ≤59% under any slot-index-based frame — the slot index is mere
storage; the orientation byte itself says which face. No mirroring or
rewinding needed (rotations preserve handedness). Non-axis faces (k7 cut /
k6 slope / k4 diagonal, slot 6) keep the viewer's validated affine stand-in
mapping since the archive has no meshes authored on those planes. The spin
about the face normal is the plate's free decoration parameter — the editor
rotates it with R (composed through the orientation group, face-preserving),
previews mounting as a translucent ghost, and creates new cubes BARE: plates
are per-face decoration, never a whole-ship drape. The classic viewer also
skips unassigned plates now.

### Other open threads

- **Textures — SOLVED (2026-07-30).** All 14 decoded by `decode_textures.py` into
  `recovered/textures/*.png` and rendered by the constructor's mesh mode. Byte
  order proven RGBA (bordersDusty = black/yellow hazard stripes; BGRA would make
  them teal). The 4th byte is a small per-file constant (7-10; 255 only in
  balk_fragment) — still not alpha, forced opaque. The 52-byte trailer starts
  `15 00 00 00 01 00 00 00 01 00 …` on every file. The 32-byte mesh vertex is
  pos3+nrm3+uv2 — UVs were always there, validated in-range, and now flow through
  the pipeline (`shapes.js` carries per-submesh `uv` + `tex`). `system_colors.png`
  is the engine's own per-system palette — the module cages sample their colour
  from it, which is why nine cages have no colour of their own.
- **Module ↔ system mapping.** Nine cages exist for ten `m1*` names; they are
  currently handed out by compartment id in a stable order. Same hash blocker.
- **Cages poke out of partial cells.** The module cages are full-cell meshes, so
  in a wedge or tetra cell the cage can show through the slope face (visible on
  Hammer's bottom wedges). Cosmetic; would need per-shape clipping or scaling.
- **Reviving the exe.** `settings.bin` was overwritten by the failed run on
  2026-07-30. `_settings.bin` is the 2020 backup. Restoring it may fix the
  "fails after first start" behaviour. Never attempted — back up the directory first.
- **Two unmapped ships.** `m13-tick` and `m16-escort` are not in `ship-roster.csv`.

---

## Working on it

```sh
python parse_rsconstruction.py   # ships  -> recovered/*.json + viewer/ships.js
python decode_meshes.py          # meshes -> recovered/parts.json, viewer/parts.js, viewer/shapes.js
wrangler deploy                  # publishes viewer/ to rs.ioupg.com
```

The viewer also runs straight off disk (`viewer/index.html`); only the Playwright
checks need a local server.

**Viewer toggles:** spin · edges · compartments · textures · chamfer · shading ·
parts · space · bloom · plate (cycles the 11 plate candidates).

**Tunables**, all near the top of `viewer/index.html`:

| constant | now | what it does |
|---|---|---|
| `PLATE_MARGIN` | `.985` | keeps the plate edge off the shell rim |
| `FILL_INSET` | `.045` | how far the solid backing sits inside the shells |
| `MODULE_SCALE` | `.88` | interior cage size within the shell |
| `AO_POWER/DEPTH/RANGE` | `1.8 / .86 / .42` | occlusion falloff; RANGE normalises to where the raw ratio saturates |
| `plateVariant` | `8` | default plate (896 triangles) |

Bloom lives in `initBloom()` — `UnrealBloomPass(…, strength, radius, threshold)`.
Space lighting is set in `setSpace()`; the sky is the `SKY_FRAG` shader.

**Gotchas that cost time before:**
- Facet winding in the viewer's `FACES` table is not consistently outward (the k6
  slope loop winds inward), and it cannot be reordered — vertex order defines the
  plate mapping frame validated against the exe tables. Normals are oriented
  against the source cube's solid centroid instead (`orient()`); the old
  occupancy probe tied on slanted facets and left wedge slopes AO-black
  (`notes/ao-wrong.jpg`).
- The plate mapping needs a **right-handed facet frame**: the mirror mounting
  rewinds every plate triangle, and on inward-wound loops (`orient()` flipped n
  but E1/E2 kept the loop order) the mapping mirrors the plate a second time
  in-plane and the winding comes out inverted — `DoubleSide` then lights those
  plates with backwards normals. The loop is walked backwards when its winding
  normal opposes the outward one; the filler backing gets the same treatment.
- **Flush composition (2026-07-31, supersedes the inset-era notes above where
  they conflict):** measuring the named `=default` parts settled the cell
  topology. Shells are hollow strut frames with 0.05 rims lying exactly IN the
  face planes (k8=default quirk: no rim on its bottom face, body floats at
  y∈[0.05,1]); all 37 quad plate variants span the face exactly 1×1 with the
  mounting back at z=0 and relief only outward (0.02–0.40); cages are
  full-size with feet stopping exactly at the window edge. Coincident
  surfaces always face opposite ways, so mesh/parts mode renders FrontSide
  and mounts everything at scale 1: PLATE_MARGIN, FILL_INSET, MODULE_SCALE
  and the editor's per-face shell rim cull are all gone from both apps.
  Before/after of the old artifacts: `gaps-offset.jpg`/`ao-wrong.jpg` vs
  `img/flush-viewer-dragonfly-frames.jpeg`,
  `img/flush-editor-dragonfly-closeup.jpeg`.
- **Systems are view-exclusive (same day, corrects a brief cage-in-mesh-mode
  interlude):** a compartment is a logical property that can sit on prismatic
  cubes too, where the cube-authored m1* cages would clip through the slant
  shells — so no dressed render draws interior cages, in either app; frames
  are hollow the engine's way. Systems appear only in the dedicated systems
  view (editor Systems mode; viewer `systems` toggle, exclusive with `parts`):
  system cages over a translucent hull silhouette. Viewer also gained a bloom
  regrade (`setBloomLook` — key up, fill down, so lit faces clip past the
  bloom threshold and leak) and a bow-first fly-through ship-change
  transition with a braking camera tween.
- **Slot orientations are only half trustworthy (2026-08-01, Punisher-hole
  fix):** an axis slot's orientation reliably encodes WHICH face the plate
  decorates (R(o)·(0,0,−1)) but its spin about the face normal is free — on
  tri faces only one of the four spins covers the material half and 30 fleet
  plates store a wrong one, so both renderers snap tri plates to the face
  (`plateCanonical` in the editor, inline search in the viewer). slot 6 is
  worse: its orientation is NOT a mounting rotation at all — measured over all
  30 fleet k7s, the nonzero values (deterministic per cube.o, e.g. o=8→17 in
  five ships, and present even with p=0) are never cut-plane spins, and
  composing them threw 8 of 25 cut plates off their faces (the Punisher
  phantom fin — that ship has no wing elements at all; see
  `punisher-hole.jpg`). Non-axis plates mount by R(cube.o) alone — 25/25
  base-on-plane. Supersedes the earlier "spin about the cut diagonal" claim.
  The slot-6 PRESENCE byte @144 is unreliable too: it sits in the record's
  garbage tail, and its only five zeros in the fleet are k7s whose mirrored
  partner is plated in an otherwise symmetric ship (Light Trader, Punisher,
  Scyche, Zealot; Legion's lone k7 the fifth) — while all 572 k6/k4 read
  plated. The non-axis face is ALWAYS dressed: the slant plate is the
  shape's structural skin, and both renderers mount it unconditionally.
- `.gitattributes` marks data files `binary` — never remove it, CRLF conversion
  would corrupt the `.rsconstruction` files.
- Cloudflare redirects `/parts.html` → `/parts`; check with `curl -L`.
- Star halos in `SKY_FRAG` must stay well inside their hash cell or neighbouring
  cells clip them into hard-edged polygons.
- Bloom needs headroom: if lit faces already reach ~1.0 they clip to white instead
  of glowing.

---

## Reading order

`00-overview.md` (inventory, includes the first wrong theory) → `02-format-final.md`
(format spec) → `03-results.md` (validation + rendering) → `04-parts-mapping.md`
(mesh mapping, including the negative results) → this file. For the editor's
lighting/shading pipeline (state + known defects + fix plan) see
`09-render-path.md`.

Screenshots in `notes/img/`. The 33 MB debug exe is gitignored; everything learned
from it is recorded here with addresses.
