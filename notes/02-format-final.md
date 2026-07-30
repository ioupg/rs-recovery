# .rsconstruction — FINAL format specification (cracked)

## File layout

```
u32 N                      — hull cube count
N  × 148-byte CarcassCube records
u32 M                      — attached element count (wings/modules)
M  × 24-byte element records
```

Records are raw `fwrite` dumps of live C++ objects — they contain heap pointers
(stable across saves due to deterministic startup allocation) and stack-garbage
padding. Loader ignores those; so do we.

## CarcassCube record (148 B)

| off | type | field |
|-----|------|-------|
| 0   | u8   | **orientation** 0..23 — index into the cube rotation group (see below) |
| 1-3 | pad  | garbage (0x47F4/F5/FE/FF page of a code address; per-save constant) |
| 4   | i32  | **grid X** (width axis; cells occupy [x, x+1], ships mirror around −0.5) |
| 8   | i32  | **grid Y** (height axis) |
| 12  | i32  | **grid Z** (length axis, roster "длина" = Z extent) |
| 16  | u32  | **shape**: 0=full cube (8v/6 plates), 1=corner-cut (7v/7p), 2=wedge (6v/5p), 3=tetra (4v/4p) |
| 20  | ptr  | shape/class descriptor — ignore |
| 24  | u32  | **compartment/system**: 0=трюм(cargo), 1..5={пушки,ЦП,гироскоп,обит,баки}, 6=двигатель/энергия, 7=?, 8=plain hull, 9=special (9th roster column) |
| 28  | ptr  | compartment descriptor — ignore |
| 32  | u8   | 0 |
| 33  | u8   | flag (0/1) — meaning TBD (mirror?) |
| 34  | u16  | element id (editor auto-increment serial) |
| 36  | u32  | shape-variant enum: cube→0 (75 cubes→1, once 4), corner-cut→4, wedge→2, tetra→3 |
| 40  | 6×16B | plate slots i=0..5 @ 40+16i: `{u8 plateOrientation; ptr plate; bool32 a; bool32 b}` (derived/cached; not needed for geometry) |
| 128 | u8   | flag |
| 129 | u32  | creation counter (unaligned; sequential per session) — bytes 129..132 |
| 133 | pad  | 0 |
| 136 | u8+pad, ptr@140, bool32@144 | trailing slot — ignore |

## Attached element record (24 B)

| off | type | field |
|-----|------|-------|
| 0   | u8   | orientation 0..23 (+3 garbage bytes) |
| 4   | i32  | grid X |
| 8   | i32  | grid Y |
| 12  | i32  | grid Z |
| 16  | u32  | kind: 0 (×26), 1 (×73), 2 (×4), 3 (×7) — Wing/CubeModule/… mapping TBD; 1 likely Wing |
| 20  | ptr  | kind descriptor — ignore |

Element meshes live in `compiled/meshes/RedStar/parts/_defaults.fbx.*.compiled`
(13 compiled DX11 meshes — possible stretch goal to parse).

## Geometry reconstruction

Corner i (0..7) → local coords `(i&1, (i>>1)&1, (i>>2)&1)` (from `RedStar::coord3T`).

Shape vertex sets (from static table @0x1db7030, `vertexIndex`):
- shape 0: corners [0,1,2,3,4,5,6,7]
- shape 1: corners [0,1,3,4,5,6,7]   (corner 2 = (0,1,0) cut off)
- shape 2: corners [0,1,4,5,6,7]     (corners 2,3 cut — wedge/prism along X, slope from y0z0 edge to y1z1 edge)
- shape 3: corners [1,4,5,7]         (tetrahedron)

Orientation o → 3×3 signed-permutation matrix (24 proper rotations of the cube,
extracted from initializer @0x4020b0..; table @0x22b7cf8, row-major):

```
 0:[ 1 0 0| 0 1 0| 0 0 1]   1:[ 1 0 0| 0 0 1| 0 -1 0]   2:[ 1 0 0| 0 -1 0| 0 0 -1]  3:[ 1 0 0| 0 0 -1| 0 1 0]
 4:[ 0 0 -1| 0 1 0| 1 0 0]  5:[ 0 0 -1| 1 0 0| 0 -1 0]  6:[ 0 0 -1| 0 -1 0| -1 0 0] 7:[ 0 0 -1| -1 0 0| 0 1 0]
 8:[ -1 0 0| 0 1 0| 0 0 -1] 9:[ -1 0 0| 0 0 -1| 0 -1 0] 10:[ -1 0 0| 0 -1 0| 0 0 1] 11:[ -1 0 0| 0 0 1| 0 1 0]
12:[ 0 0 1| 0 1 0| -1 0 0] 13:[ 0 0 1| -1 0 0| 0 -1 0] 14:[ 0 0 1| 0 -1 0| 1 0 0]  15:[ 0 0 1| 1 0 0| 0 1 0]
16:[ 0 1 0| 0 0 1| 1 0 0]  17:[ 0 1 0| 1 0 0| 0 0 -1]  18:[ 0 1 0| 0 0 -1| -1 0 0] 19:[ 0 1 0| -1 0 0| 0 0 1]
20:[ 0 -1 0| 0 0 -1| 1 0 0] 21:[ 0 -1 0| 1 0 0| 0 0 1] 22:[ 0 -1 0| 0 0 1| -1 0 0] 23:[ 0 -1 0| -1 0 0| 0 0 -1]
```

World position of corner c of cube at (x,y,z): `R·(c − ½) + ½ + (x,y,z)` (rotate about cube center).

Plate types per shape (table @0x1db70b0): cube [0×6]; corner-cut [4,0,1,1,0,0,1];
wedge [2,1,1,0,0]; tetra [3,1,1,1] — plate type 0=square 1=triangle 2=slope quad
3=big triangle 4=cut-corner face. (Viewer builds faces directly from shape solids
instead + neighbor-culling, so plate slots are not required.)

## Validations done

- 44/44 files parse exactly (4 + N·148 + 4 + M·24 = file size).
- Ship designation m<NN> == hull cube count (m11→11 … m72→72, small drift where edited).
- Roster "длина" == Z extent (mostly exact, ±1 where design drifted from doc).
- Roster per-system counts == off24 histograms (archangel exact across all 8 systems).
- coord3T/vertexIndex/platesCount/orientation tables extracted from exe disassembly.
