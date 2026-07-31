# Status and handoff — start here

**Live:** https://rs.ioupg.com (fleet) · https://rs.ioupg.com/parts (mesh catalogue)
· https://rs.ioupg.com/editor/ (constructor)
**Repo:** working tree clean, deployed build matches the viewer at HEAD.

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

## Blocked, and why (do not re-litigate without new information)

**Which mesh file is which named part.** Two independent negative results:

1. *Not in the ship files.* The per-slot byte in each cube record is determined by
   `(cube orientation, slot index)` — only 9 of 36 observed pairs vary, and that
   variation is presence/absence. It is a plate **orientation**, not a style id.
2. *Not a hash of the name.* With the real vocabulary and the `=default` syntax,
   ~447 000 combinations (13 959 name forms × 8 hash functions × 2 encodings ×
   ±terminator) hit none of the 75 ids. The only FNV-1a in the binary is MSVC's
   `std::hash`. The id is assigned by the offline asset compiler, which is not in
   this executable.

Consequence: plate **type** per face is fully recovered; plate **mesh** is a
choice. The viewer exposes a picker rather than pretending otherwise. Anything
rendered from the meshes is *a plausible dressing of exact structure*.

---

## Where we stopped

The last thing discussed and **not done**: the viewer currently distinguishes only
quad vs triangle plates. The exe's `plateType(shape, plateIndex)` table
(`0x1db70b0`) gives five types, so `p2121` (wedge slopes) and `p222A`/`p222V`
(cut corners) could get their own distinct meshes instead of reusing the quad and
triangle. The *assignment* would then be recovered data; only the per-type mesh
choice stays a choice.

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
(mesh mapping, including the negative results) → this file.

Screenshots in `notes/img/`. The 33 MB debug exe is gitignored; everything learned
from it is recorded here with addresses.
