# Putting real meshes on the ships — what's recoverable and how

## The naming vocabulary (recovered from the exe)

The engine names every buildable element with a code whose digits are the
**squared edge lengths** of the polygon it spans. Three families, all confirmed:

| family | names | table | notes |
|---|---|---|---|
| cube shapes | `k8` `k7` `k6` `k4` | strings @0x18f282c/0x18f28bc.. | digit = vertex count; matches `CarcassCube::verticesCount` = 8/7/6/4 |
| plate types | `p1111` `p121` `p2121` `p222A` `p222V` | ptr table @0x1db7218 | 5 types, indexed by `plateType(shape, plateIndex)` @0x1db70b0 |
| wing types | `w1111` `w121` `w2121` `w321` `w222` | ptr table @0x1db7130 | already rendered exactly |
| modules | `m1*engine` `m1*power` `m1*gyroscope` `m1*command` `m1*habitable` `m1*cargo` `m1*weapon` `m1*hangar` `m1*slot` `m1*tank` | ptr table @0x1db71f0 | 10 names — the same system list as the compartment field |

The module names line up with the compartment ids we derived from the roster, which
is independent corroboration of that decode.

## What the ship files already give us, per cube

Everything needed to place a plate is in the 148-byte record:

- `shape` @16 → `platesCount(shape)` = 6 / 7 / 5 / 4  (exe 0x440120)
- plate slot *i* at offset `40 + 16i`, seven slots, matching the max of 7:
  `{ u8 orientation; ptr plate; bool; bool }`
- plate **type** = `PLATE_TYPE[shape][i]` from the exe table @0x1db70b0
- plate **orientation** = the u8 in the slot — verified to span exactly 0..23,
  the same cube rotation group used everywhere else

So each of the ~12 000 plate instances in the fleet has a known type and a known
orientation. Nothing needs guessing at this level.

## The one thing that is NOT recoverable

Which *variant* mesh the engine loaded for a given plate. Compiled files are named
`<source>.<id>.compiled` and the FBX node names never made it into them. The id is
not a hash of the part name: the only FNV-1a in the binary (0x4eb510, offset
0x811c9dc5 / prime 0x1000193) is MSVC's `std::hash`, called only from two
`std::hash<basic_string>` specialisations, and brute-forcing 13 hash functions ×
name variants (with source paths, separators, ascii/utf-16, ±NUL) against all 75
ids produced nothing. The filename construction at 0x58af30 just concatenates
`<name>` `.` `<id>` `.compiled`, taking the id straight from the resource object,
so the id is assigned elsewhere — most likely by the offline asset compiler, which
is not in this binary.

## The route that works: classify by outline

A plate's silhouette in its face plane identifies its type. Projecting each decoded
mesh onto XY and taking the convex hull area:

| hull area | meaning | count |
|---|---|---|
| 1.00 | unit square → `p1111` (and `p2121`, which also projects square) | 45 |
| 0.50 | half-square right triangle → `p121` | 17 |
| 0.866 | equilateral √2 triangle → `p222A` / `p222V` | 6 |
| irregular (0.77–1.6, 6–28 hull points) | free-form, multi-cell → **modules**, not plates | 6 |

That cleanly separates the catalogue into plate families plus a handful of module
meshes (the engine bell, the turret, the 2-cell-deep block).

## Recipe to render it

1. Group the 74 meshes into families by outline area (above).
2. Pick one representative per family from `_defaults.fbx` — justified by the exe's
   own `RedStar/parts/_defaults.fbx` and `=default` strings, but still a *choice*,
   not a recovery. Offer a variant picker so it stays honest.
3. For every cube, for `i < platesCount(shape)`: instance the mesh for
   `PLATE_TYPE[shape][i]`, rotated by `ORIENTATIONS[slot_i.orientation]` about the
   cube centre, translated to the cell.
4. Cull plates on interior faces the same way facets are culled today.
5. Use `THREE.InstancedMesh` — one per (family, variant). ~12 000 instances of a few
   hundred triangles is far too much as individual meshes but trivial instanced.

Modules (`m1*…`) can be placed the same way off the compartment field, once a
representative mesh is chosen per system from the six free-form meshes.

## Honest summary

Placement is fully recovered; **variant selection is not**. Any render using these
meshes is "a plausible dressing of exact structure", and should be labelled that way
in the UI rather than presented as the original appearance.

## Update: the plate identity is not recoverable (settled)

Two independent attempts, both negative.

**1. Is the plate variant stored per face in the ship files?** No. Each cube record
has seven plate slots at `40 + 16i`, each holding a byte. Testing shape-0 cubes,
that byte is almost entirely determined by `(cube orientation, slot index)` — only
9 of 36 observed pairs vary, and the variation is the presence/absence of a plate
(value 0 dominates the slots that face inward). So the byte is a **plate
orientation**, not a style id. The files record *where* a plate goes, never *which*.

**2. Is the compiled filename a hash of the part name?** No. With the real
vocabulary now in hand (`k8`, `p1111`, `w1111`, `m1*engine`, …) plus the `=default`
syntax found next to `RedStar/parts/_defaults.fbx`, a second sweep tried 13 959
constructed name forms × 8 hash functions × 2 encodings × with/without terminator
— roughly 447 000 combinations — against all 75 ids. Zero hits. The id is assigned
by the offline asset compiler, which is not in this executable.

### What this means in practice

Plate **type** per face is fully recovered and needs no guessing: the exe's
`plateType(shape, plateIndex)` table gives p1111 / p121 / p2121 / p222A / p222V,
and those correspond exactly to the facet shapes the viewer already culls — square
facets take the square plate, triangular facets the triangular one, and the affine
mapping fits the slanted and equilateral cases automatically.

Plate **mesh** is a choice, not a recovery. `_defaults.fbx` holds eleven thin square
candidates (12 → 3422 triangles) with assorted decorative textures; nothing in the
data distinguishes them. The viewer therefore exposes them as a picker rather than
pretending one is correct.

Remaining idea, not yet done: assign *different* meshes to p2121 and p222A/V so
wedge slopes and cut corners differ from flat faces. That uses the recovered type
table for real variety, though the per-type mesh choice stays a choice.
