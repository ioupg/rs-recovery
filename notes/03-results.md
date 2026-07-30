# Recovery results

## Deliverables

- `parse_rsconstruction.py` — parser, run with `python parse_rsconstruction.py`
- `recovered/*.json` — 43 ships as clean JSON (cubes + elements + roster metadata)
- `viewer/index.html` — offline three.js viewer ("Ред Стар · реестр флота").
  Open directly (file://) or serve the `viewer/` dir with any static server.
  Self-contained: `three.min.js` (r128) + `ships.js` (generated data) are local.

## Version control

Repo initialised late (2026-07-30), so the recovery itself isn't in the history —
the first commits import the 2014 material and then land the finished format spec,
parser, and viewer. Everything after that is committed as it changes.
The 33 MB debug exe is gitignored; `.gitattributes` marks all data files `binary`
so line-ending conversion can never corrupt them (verified: all 44 ship files
round-trip byte-identical out of git).

## Deployment

Live at **https://rs.ioupg.com** — Cloudflare Worker with static assets
(`wrangler.jsonc` in project root: worker `rs-fleet-registry`, assets dir `./viewer`,
custom domain route). Redeploy after changes with `python parse_rsconstruction.py`
(regenerates `viewer/ships.js`) + `wrangler deploy`.

## Viewer features

- Fleet registry rail grouped by rank (I..VI + civilian), ГОСТ-style title block
  with hull no., class, nation, dims, and per-compartment ledger with counts.
- Compartment coloring (toggle), sharp-edge overlay (toggle), auto-rotate (toggle),
  orbit/zoom/pan. Wings/modules drawn as translucent markers (exact part meshes
  are in compiled DX11 buffers — not decoded, see future work).
- Interior faces culled exactly: all world vertices are integers (rotations are
  signed permutations about cube centers), coincident faces + tris-under-quads dropped.

## Validation summary

| check | result |
|---|---|
| file size = 4 + N·148 + 4 + M·24 | 44/44 files exact |
| all field ranges (orient<24, shape<4, comp<10, kind<4) | 2001 cubes + 110 elements, 0 violations |
| m<NN> designation == cube count | matches (small drift on edited designs) |
| roster длина == Z extent | mostly exact, ±1..3 where roster is stale |
| roster systems == compartment histograms | exact on archangel, machete, centurion, HoG, normandie… |
| hand-derived shape faces == exe plate tables | 4/4 shapes exact (6/7/5/4 plates, types match) |
| X-mirror symmetry | 34/43 ships ≥95%; asymmetric ones are all Единение faction (by design) + apocalypse (94% at offset plane) |

## Screenshots (notes/img/)

- `centurion.png` — M12 Centurion gunboat, compartment colors
- `scorpion.png` — M11 Scorpion corvette: wedge nose + tetra wings
- `archangel.png` — M72 Archangel dreadnought (94 blocks)
- `fenrir.png` — M52 Fenrir: asymmetric Единение design + 16 module markers

## Discoveries along the way

- Единение (Unity) faction ships are deliberately mirror-asymmetric; all other
  factions build symmetric hulls.
- Compartment id 7 = hangar bays, present only on carriers (Normandie 12 ✓, Asmodee).
- "Трюм" (cargo) is not cube-assigned — it's leftover hull volume.
- temp.rsconstruction == c12-light-trader.rsconstruction (editor's last-open buffer).
- Element id counter (u16@34) and creation counter (u32@129) reveal editing order/history.

## Future work (not done)

1. **Wing/module part meshes**: `compiled/meshes/RedStar/parts/_defaults.fbx.*.compiled`
   are 13 compiled DX11 vertex/index buffers — format looked parseable (header + raw
   buffers), would give exact wing shapes instead of markers. Kind id ↔ part mapping
   would need the resource-id hash (names carry it: `.NNNNNNNNN.compiled`).
2. **Exe revival**: `settings.bin` was overwritten by the failed run today
   (236 B vs 237 B backup `_settings.bin` from 2020). Restoring `_settings.bin` →
   `settings.bin` may fix the "fails after first start" issue. Not attempted
   (didn't want to touch the app state without a go-ahead).
3. Slot bools (per-plate flags) semantics — unneeded since occlusion is recomputed.
4. Tail-element kind ↔ class mapping (0/1/2/3 → Wing/CubeModule/CubePlaceholder/?) —
   kind 1 (73 pcs, always in symmetric pairs) is almost certainly Wing.
