# Part authoring — the to-scale contract

How to model new RedStar parts so the engine mounts them exactly like the
2014 originals. Companion file: `templates/authoring-template.glb`
(regenerate with `python make_authoring_template.py`) — open it in Blender
and model against the references. Requirements context: `06-editor-v2.md`
(R12–R15); recovered-format evidence: `02-format-final.md`, `05-status.md`.

## 1. Coordinate system and scale

- **1 unit = 1 grid cell.** A cube at grid `(x,y,z)` occupies world
  `[x,x+1]×[y,y+1]×[z,z+1]`. All parts are authored inside the **unit cell
  `[0,1]³`** — never centered on the origin.
- Axes (engine = three.js, Y-up): **X = width** (ships mirror across a
  grid-x plane), **Y = height**, **Z = length** (roster "длина" = Z extent).
- Orientation: every placement rotates the part by one of the 24 cube
  rotations **about the cell centre**: `p' = R·(p − ½) + ½ + cell`.
  The 24 matrices are frozen facts (`editor/src/core/tables.ts`,
  extracted from the exe).
- **Blender note:** glTF is Y-up; Blender auto-converts to its Z-up on
  import and back on export. Author with default import/export settings and
  the round-trip is exact. In Blender you will see height as +Z — that is
  the importer's doing, not a data difference.
- The template's stations are spread along +X by node translations for
  readability only — zero an object's location to put it back in the
  authoring cell.

## 2. Mesh conventions

- **Winding CCW, normals outward** (three.js/glTF front face). The 2014
  archive was D3D clockwise; the decode pipeline already flips it — new
  parts are authored normally and never flipped.
- Vertex data: position + normal + uv (the archive's 32-byte vertex is
  pos3+nrm3+uv2; UVs always existed and flow through).
- Hard edges are done with split vertices (flat per-corner normals), exactly
  like the originals. Averaging normals across the shell rims is what caused
  the "gaps between cubes" artifact — don't.
- Textures reference the recovered set (`recovered/textures/*.png`); the
  PBR pipeline (`enhance_textures.py`) derives normal/roughness maps, so a
  diffuse is all a part needs.

## 3. Part classes — the contracts

### 3.1 Hull shells (k8 · k7 · k6 · k4)

| shape | solid | rid (=default) | tris | window |
|---|---|---|---|---|
| 0 k8 | full cube | 277088277 | 48 | 0.9 |
| 1 k7 | corner-cut (corner 2 removed) | 3476932548 | 130 | 0.9 |
| 2 k6 | wedge (corners 2,3 removed) | 3628520327 | 74 | 0.9 |
| 3 k4 | tetra (corners 1,4,5,7 kept) | 4138793729 | 42 | 0.8 |

- Full-cell `[0,1]³`. Each face is a **0.05 rim around an open window**
  (window side = `window` above; face area is exactly `1 − 0.9² = 0.19`).
- The engine culls shell faces shared between neighbours per-face
  (`shellFaceClasses` — triangles are classified by the face they belong
  to), so a new shell must keep its per-face triangles cleanly separable:
  no triangle may span two faces.
- Corner numbering: corner *i* = `(i&1, (i>>1)&1, (i>>2)&1)`.

### 3.2 Decoration plates

| type | face | rid (=default) | tris |
|---|---|---|---|
| p1111 | axis quad | 3415334756 | 12 |
| p121 | axis triangle | 2008756708 | 8 |
| p2121 | k6 slope rectangle | 1463334551 | 12 |
| p222A | k4 diagonal triangle | 1048122179 | 8 |
| p222V | k7 cut triangle | 4141366523 | 8 |

- **Axis plates (p1111/p121) are authored on the cell's z=0 face**: they
  span `[0,1]×[0,1]` in x/y with the mounting back at **z = 0** and the
  relief extending to **−z** (the defaults reach −0.02; deeper relief is
  fine, it stands off the hull).
- Mounting is a pure rotation about the cell centre: the face a plate
  decorates is `R(slot.o)·(0,0,−1)` in world. **Spin about the face normal
  is the free decoration parameter** — author the plate in any spin; the
  editor rotates it per face.
- The engine scales plates by `PLATE_MARGIN = 0.985` about the face centre
  to keep edges off the shell rim — author edge-to-edge, don't pre-shrink.
- Slanted-face plates (p2121/p222A/p222V) are authored **in the unit cell
  on their slanted plane** (see the template stations) — or omitted, in
  which case the engine shears the axis representatives onto those faces,
  as the 2014 defaults did.
- p1111 greeble variants in the archive run 12 → 3422 tris; keep new plates
  in that budget.

### 3.3 Interior modules (system cages)

| comp | name | rid | tris |
|---|---|---|---|
| 0 | m1\*power | 3922344229 | 108 |
| 1 | m1\*command | 2388003349 | 108 |
| 2 | m1\*habitable | 4231328032 | 268 |
| 3 | m1\*gyroscope | 1953235835 | 576 |
| 4 | m1\*tank | 543676054 | 640 |
| 5 | m1\*weapon | 2720223943 | 108 |
| 6 | m1\*engine | 2502410216 | 108 |
| 7 | m1\*hangar | 4091051812 | 60 |
| 8 | m1\*slot | 64001152 | 128 |
| 9 | m1\*cargo | 555481462 | 268 |

- Authored **full-cell `[0,1]³`**; the engine renders them at
  `MODULE_SCALE = 0.88` about the cell centre (the cyan box in the
  template). Anything outside the 0.88 box can poke through partial-shape
  cells (known cosmetic issue) — keep silhouettes inside it where possible.
- **Do not bake a colour**: cages render untinted and take their tint from
  the engine's per-system palette (`system_colors.png`). Author neutral.
- A new system's cage is just a new mesh registered against the system id
  (see §4.1).

### 3.4 Wings

| kind | name | ring | skin rid | tris |
|---|---|---|---|---|
| 0 | w1111 | square | 3068320060 | 24 |
| 1 | w121 | triangle | 52680811 | 14 |
| 2 | w2121 | rect (no archive skin — procedural ring) | — | — |
| 3 | w321 | large tri | 1531929002 | 14 |
| 4 | w222 | equilateral | 2739700399 | 14 |

- Wings are **procedural rings first** (names are the squared edge lengths
  of the ring); a skin mesh is optional. Flat skins (w1111/w121) sit on the
  z≈0 plane spanning `[0,1]²`, thickness ±0.02; the slanted rings span the
  cell. Wings occupy **empty cells** anchored edge-wise to the hull.

## 4. Extending the base (engine v2 registries)

### 4.1 New systems

`systems.json` registry (editor data): ids **0–9 are the archive systems —
frozen**. New systems take ids ≥ 10:

```jsonc
{ "id": 10, "key": "sensors", "name": "Sensors",
  "color": "#7FD0FF",        // palette tint for the cage + box mode
  "cage": "sensors_cage" }   // mesh key in the parts registry; omit → generic box
```

JSON-only (the 2014 binary format caps at 10) — the editor flags cubes with
id ≥ 10 if a binary export is ever requested.

### 4.2 New plate meshes

Plate registry entry: `{ id, name, faceType: quad|tri|slope|diag|cut,
source, mesh }`. Author per §3.2, name objects `PLATE_<faceType>_<name>` in
the GLB, register, done — the picker and geometry builder resolve through
the registry only.

### 4.3 New element kinds (prototype schema — engine only, no editor UI yet)

```jsonc
// lattice spine / mast — truss spanning a straight run of cells,
// replacing a solid element or connecting modules
{ "kind": "lattice", "from": [x,y,z], "to": [x,y,z],
  "profile": "square" | "tri", "chord": 0.08, "brace": 0.04 }

// attached decorative mesh — registry mesh glued to a hull face
{ "kind": "deco", "meshId": "antenna_a",
  "anchor": { "cell": [x,y,z], "face": 0-5, "offset": [u,v] }, "o": 0-23 }

// guyline — cable between two cell corners (corner index 0..7, §3.1)
{ "kind": "guy", "a": { "cell": [x,y,z], "corner": 0-7 },
  "b": { "cell": [x,y,z], "corner": 0-7 }, "sag": 0.0 }
```

All three are procedural (like wings): the lattice generates chord + brace
struts, the guyline a straight segment (quadratic sag when `sag > 0`).
They live in the doc's `elements` array next to wings and are ignored by
any future binary export.

## 5. Template inventory (`templates/authoring-template.glb`)

| station (x) | objects |
|---|---|
| 0 | `CELL_bounds`, `AXIS_X/Y/Z`, `SHELL_k8` |
| 2·4·6 | `SHELL_k7_corner_cut` · `SHELL_k6_wedge` · `SHELL_k4_tetra`, each with cell bounds |
| 8–18 | the five plate defaults + one flat-panel variant, each with cell bounds and the orange `MOUNT_*` marker (mount square at z=0, arrow = relief direction) |
| 20 | `MODULE_m1power_authored_full_cell` + cyan `MODULE_render_bounds_088` |
| 22 | `WING_w1111_skin` |

Workflow: import the GLB → model your part in a copy of the relevant
station → move it to the origin cell → delete the references → export
**selected objects** as GLB with default settings → register in the data
JSON (§4). Verify in the editor: the part must sit flush in all 24
orientations (the mounting math tolerates nothing off-cell).
