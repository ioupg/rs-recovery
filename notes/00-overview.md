# RedStar Editor — .rsconstruction recovery notes

**Goal:** reverse-engineer the `.rsconstruction` binary format (ship designs made of
vertices/edges/faces + metadata) from the 2014 backup of `RedStarEditor.Debug.Win32.backup.exe`,
recover geometry from all 40+ ship files, and build a three.js viewer.

## Inventory (repository root)

- `RedStarEditor.Debug.Win32.backup.exe` — 33 MB, MSVC **Debug** Win32 build, 2014-06-29.
  Debug build → expect rich strings (class/field names, asserts, RTTI).
- 42 `.rsconstruction` files, 1.9–16.7 KB, dated Jun–Jul 2014.
  Naming: `m<XY>-name` — likely X=class/size, Y=variant (m11..m72), plus `c12-light-trader`.
- `temp.rsconstruction` — byte-identical to `c12-light-trader.rsconstruction` (editor's last-open buffer).
- `settings.bin` (236 B, overwritten TODAY by a failed run) vs `_settings.bin` (237 B, 2020 backup).
  **Hypothesis: exe fails on 2nd start because it overwrote settings.bin with a bad one.
  Try restoring from `_settings.bin`.**
- `_log.txt`, `_err.txt` — empty, touched today.
- `compiled/` — engine asset cache: `atlases/gui.atlas`, `textures/*.compiled` (BMP/JPG/PNG,
  sizes like 262204 = 512×512×BGRA + 60-byte header?), `meshes/RedStar/`, `shaders/{common,gui,postFX,shadowDX11}`.
  Shader names → DX11 renderer.

## File format first look (m12-centurion, 1932 B, smallest)

- Starts with `0D 00 00 00` = 13 → record count.
- Records begin with a recurring header pattern: `00 F5 47 00  FF FF FF FF  00 00 00 00  <i32 index>  00 00 00 00`
  with index incrementing 0,1,2,3,4 … then some records use indices `FFFFFFFF` (-1), `FEFFFFFE` (-2)…
- Inside records: recurring 4-byte tokens that look like **32-bit field-name hashes**
  (`22CD1EDF`, `8518A4ED`, `EF75E24C`, `067A35FA`, `05AB5B99`, `95819163`, `524306D8`,
  `9F794DCE`, `669B0688`, `26B94E99`, `3D695E00`, `FD875A3B`, …) followed by values.
- `22CD1EDF` is always followed by a small u32 (8,8,4,6,6,2,1 …) → a count of sub-items.
- Some tokens differ only in first byte (`04 13AC1C` vs `07 13AC1C`, `0C D1781D` vs `0F D1781D`)
  → stream is probably NOT 4-aligned; leading byte may be a type tag or bool.
- Float-looking values present: e.g. `68 27 97 3F` = 1.1809f.
- Recurring `00 F5 18 00` / `00 F4 18 00` byte pattern — meaning TBD.

## Plan

1. Extract strings from exe → find serializer field names; match CRC32/FNV etc. against observed hashes.
2. Decode record structure; write Python parser → JSON.
3. three.js viewer over the JSON.

## Progress log

- [x] Inventory + initial hex analysis (this file)
- [x] Exe strings + disassembly → format cracked (`01-format.md` WIP notes, `02-format-final.md` final spec)
- [x] Parser `parse_rsconstruction.py` → `recovered/*.json` (43 ships, all checks pass)
- [x] three.js viewer `viewer/index.html` (offline, screenshots in `notes/img/`)
- [x] Results + future work → `03-results.md`

Note: the early "field-name hash" theory in this file was wrong — records turned out
to be raw C++ object memory dumps (see 02-format-final.md).
