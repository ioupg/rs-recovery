# Red Star — .rsconstruction recovery

Reverse-engineering of `.rsconstruction`, the ship-design format of **RedStarEditor**
(2014, in-house "SharedTec" engine), and a browser viewer for the recovered fleet.

**Live viewer: https://rs.ioupg.com**

Ships are voxel constructions: a grid of `CarcassCube` hull blocks, each with a shape
(cube / corner-cut / wedge / tetra), an orientation from the 24-element rotation group
of the cube, and a compartment type (engines, guns, tanks, bridge, …), plus attached
wing/module elements.

## Layout

| path | what |
|---|---|
| `*.rsconstruction` | original 2014 ship files (43 designs + `temp`) |
| `ship-roster.csv` | design-stats table that came with the backup, used to validate the decode |
| `parse_rsconstruction.py` | parser → JSON + viewer data |
| `recovered/*.json` | decoded ships |
| `viewer/` | offline three.js viewer (self-contained; also what's deployed) |
| `notes/` | working notes: inventory, format spec, results, screenshots |
| `compiled/` | engine asset cache from the backup (textures, shaders, part meshes) |
| `wrangler.jsonc` | Cloudflare Worker config for the deployment |

The 33 MB debug executable the format was reversed from is gitignored; everything
learned from it lives in `notes/02-format-final.md` and `notes/03-results.md`.

## Rebuild and deploy

```sh
python parse_rsconstruction.py   # re-parses every ship, regenerates viewer/ships.js
wrangler deploy                  # publishes viewer/ to rs.ioupg.com
```

The viewer also runs straight from disk — open `viewer/index.html`.
