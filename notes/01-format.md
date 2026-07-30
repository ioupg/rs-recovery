# .rsconstruction format — decoded structure (work in progress)

## Big picture

RedStarEditor is a **voxel/cube-based ship constructor** (engine "SharedTec", game "RedStar").
Ships are built from grid-placed elements. Key classes (from exe RTTI + asserts):

- `RedStar::CarcassCube` — hull cube; has shape `type` → `platesCount(type)`, `verticesCount(type)`
- `RedStar::CarcassPlate` — face plate generated per cube side (`makePlate`, `plateType`)
- `RedStar::Wing` — wing element (`determineTransform` asserts vertex `count == 3 || 4`)
- `RedStar::CubeModule` — module in a cube (references external FBX parts: `RedStar/parts/_defaults.fbx`)
- `RedStar::CubePlaceholder`
- `RedStar::coord3T` — maps index 0..7 → cube corner coordinate (assert `index >= 0 && index < 8`)
- Editor commands: AddCube / RemoveCube / ChangeCubeType / ChangeCubeTransform
- I/O: in-house `stream` lib (`dmemstream`, `cfile`, zlib wrapper available but **files are raw, not compressed**)

## File layout (all 44 files verified)

```
u32 N                     — element record count
N × 148-byte records      — raw memory dumps of element objects (packed struct, incl. junk)
u32 M                     — tail record count
M × 24-byte tail records  — TBD (only some files; counts 0..16)
```

**The 148-byte records are raw C++ object memory dumps** (fwrite of live objects).
They contain live heap POINTER fields (stable across saves because deterministic startup
allocation → same addresses every run) and stack-garbage padding bytes. The loader
evidently ignores pointers and uses index/value fields. Decoded field map (offsets):

| off | type | meaning | evidence |
|-----|------|---------|----------|
| 0   | u8   | ??? fA (0..23) | varies per record |
| 1   | u16  | save-session tag 0x47F4/F5/FE/FF (build id — per-file constant; ignore) | |
| 3   | u8   | 0 | |
| 4   | i32  | **grid X** (small signed) | centurion: all -1 (1-cube-thick ship) |
| 8   | i32  | **grid Y** (small signed) | centurion: -1..1 |
| 12  | i32  | **grid Z** (small signed) | centurion: -4..4 |
| 16  | u32  | **element class**: 0=CarcassCube(1388 recs), 1=??(32), 2=??(360), 3=??(221) | candidates: Wing / CubeModule / CubePlaceholder |
| 20  | ptr  | class-descriptor ptr (correlates 1:1 with class) — ignore | |
| 24  | u32  | **shape type** (0..9) — drives platesCount/verticesCount | paired descriptor ptr @28 |
| 28  | ptr  | shape-descriptor ptr — ignore | |
| 32  | u8   | 0 | |
| 33  | u8   | flag 0/1 | |
| 34  | u16  | element ID (auto-increment serial; clusters ~968..3900) | |
| 36  | u32  | enum 0..4 — **orientation/rotation?** | |
| 40+ | 7×16B groups at 40,56,72,88,104,120,136: `{u8 val; ptr; bool32; bool32}` (last truncated) | per-face **plate types** + plate ptrs + flags? | dA..dG values 0..23 |
| 128 | u8   | flag | |
| 129 | u24  | creation counter (sequential per editing session, e.g. 534631,534632,…) | |
| 132,144 | bool32s | | |

Padding bytes after u8 fields contain stack garbage (`F5 18 00` = 0x0018F5xx stack addrs) — ignore.

## Still to figure out

1. Which class id ↔ which RTTI class (0 = CarcassCube almost surely; 1/2/3 =?)
2. Shape-type geometry tables: need `platesCount(type)`, `verticesCount(type)`, corner layout
   (`coord3T`), plate generation (`makePlate`) → **extract from exe via disassembly**
3. Orientation encoding (e36? b0? dA..dG per-face plate types?)
4. 24-byte tail records (M×24) — compartments? wings? modules?
5. Grid cell size (cosmetic — pick 1.0)

## Interpretation notes

- 2001 records over 44 files. Class 1 appears in only ~32 files → maybe "cockpit/core" unique element.
- Element counts per file 13..113 — matches small→huge ships (m11 fighter → m72 apocalypse).
- Naming m<XY>: ship class/size progression.
