# Status and handoff — start here

**Live:** https://rs.ioupg.com (fleet) · https://rs.ioupg.com/parts (mesh catalogue)
**Repo:** 14 commits, working tree clean, deployed build matches HEAD.

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
| second mesh format | one later export uses a 40-byte vertex (pos3, normal3, uv2, pad2) with the index block *first* and normals left as `0xCDCDCD`; normals are recomputed from winding. This is the missing `k8` hull shell |
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

- **Textures.** `compiled/textures/*.compiled` is trivially decodable: `u32 width`,
  `u32 height`, `w·h·4` bytes, 52-byte trailer — consistent across every file
  (512² craftHull, 256² for the JPEGs, 128² ContourAlum). RGB reads cleanly; the
  4th byte per pixel is *not* alpha (values like 7 and 9) and is unexplained.
  Decoding these would make the "текстуры" toggle meaningful in detail mode, using
  the ship's real 2014 textures instead of the procedural stand-in atlas.
- **Module ↔ system mapping.** Nine cages exist for ten `m1*` names; they are
  currently handed out by compartment id in a stable order. Same hash blocker.
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

**Viewer toggles:** вращение · кромки · отсеки · текстуры · фаски · затенение ·
детали · космос · свечение · плита (cycles the 11 plate candidates).

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
