# Red Star — .rsconstruction recovery

Reverse-engineering of `.rsconstruction`, the ship-design format of **RedStarEditor**
(2014, in-house "SharedTec" engine), and a browser viewer for the recovered fleet.

**Live viewer: https://rs.ioupg.com** · mesh catalogue: https://rs.ioupg.com/parts

**Picking this up again? Read [`notes/05-status.md`](notes/05-status.md)** — what is
solved, what is provably blocked, and where work stopped.

Ships are voxel constructions: a grid of `CarcassCube` hull blocks, each with a shape
(cube / corner-cut / wedge / tetra), an orientation from the 24-element rotation group
of the cube, and a compartment type (engines, guns, tanks, bridge, …), plus attached
wing/module elements.

## Layout

| path | what |
|---|---|
| `source/original-data.zip` | the original 2014 backup: 43 ship designs + `temp`, the engine asset cache (`compiled/` — textures, shaders, part meshes), editor settings, and `ship-roster.csv` (design-stats table used to validate the decode) |
| `parse_rsconstruction.py` | ship parser → JSON + viewer data |
| `decode_meshes.py` | part-mesh decoder → catalogue, hull shapes, plates, module cages |
| `recovered/*.json` | decoded ships and meshes |
| `viewer/` | offline three.js viewer (self-contained; also what's deployed) |
| `notes/` | working notes: inventory, format spec, results, screenshots |
| `wrangler.jsonc` | Cloudflare Worker config for the deployment |

The 33 MB debug executable the format was reversed from is not in the repo;
everything learned from it lives in `notes/02-format-final.md` and
`notes/03-results.md`, with disassembly addresses.

## Rebuild and deploy

The decoders expect the original data extracted beside them, so first:

```sh
unzip source/original-data.zip          # or: Expand-Archive source/original-data.zip .
```

then:

```sh
python parse_rsconstruction.py   # ships  -> recovered/*.json + viewer/ships.js
python decode_meshes.py          # meshes -> recovered/parts.json, viewer/parts.js, viewer/shapes.js
wrangler deploy                  # publishes viewer/ to rs.ioupg.com
```

The viewer also runs straight from disk — open `viewer/index.html`.
