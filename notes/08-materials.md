# Materials library — app-level PBR provision

The editor ships with a curated library of PBR materials and a system for
per-ship texture remapping. Archive texture names (the 14 recovered files)
are wrapped as legacy entries; new curated materials live in `materials/`
and are bundled into a shipped JSON file. Tweaks are persisted to browser
localStorage and exported back into materials.json to commit.

## 1. Model: library, assignments, and persistence

**MaterialLibrary** (`editor/src/core/library.ts`) is the app-level registry.
It merges three sources in order:

1. **Legacy wraps** (14 archive textures): recovered from the vite plugin's
   manifest pass. Each texture name becomes a library entry with `legacy: true`
   and its id matching the texture name exactly (e.g. `bareMetalGrey.bmp` →
   id=`bareMetalGrey.bmp`, name="Bare Metal Grey"). Legacy entries carry a
   single `maps.albedo` pointing at the decoded/enhanced PNG in
   `public/textures/`.
2. **Shipped curated entries** from `materials/materials.json` (8 map-less
   scalar materials as of 2026-08-01). These are sparse — library.ts
   normalizeMaterial() fills in LIB_DEFAULTS for all missing fields.
3. **Browser-local tweaks** from localStorage key `rs.editor.library.v1`: a
   per-id overlay of fields changed since load (serialized by diff()).

**AssignmentStore** (`core/materials.ts`) is a per-ship remapping layer: it
holds a sparse map of texture name → material id, defaulting to the name
itself (identity; every archive texture has a legacy wrap by design). When
mesh geometry groups triangles by `(slot, archive texture name)`, MaterialCache
resolves the texture name through `assignments.get(name)` to a library material
id, then looks it up in the library. Assignments persist to the ship JSON's
`assignments` key; the old `surfaces` key is ignored on import with a console
note.

**Persistence:** MaterialLibrary emits change events; main.ts subscribes and
serializes `library.diff()` (fields changed from shipped defaults) to localStorage
whenever the library changes. On startup, the library loads defaults and applies
the overlay. Users export tweaks back into materials.json via the browser UI
"Export library" button (downloads the JSON); committing the download updates
`materials/materials.json`.

## 2. Texture provision convention for new curated materials

New entries take a **folder `materials/<id>/`** with the name matching a unique
id string (alphanumeric and hyphens only; e.g. `bare-metal`, `hull-paint-white`).

**Map files** (all optional, PNGs):

- **albedo.png** — sRGB color/diffuse, 1K (1024²) target. Color-only; the alpha
  channel (if present) is ignored. Seamless/tileable is recommended.
- **normal.png** — OpenGL normal-map convention (green = +Y / up; DirectX green=−Y maps
  render with inverted bumps). Provided at 1K; the vite plugin does NOT currently
  pack with BC5 compression, so raw OpenGL is expected. flipY=false in the loader
  — the sign chain is pinned by reference implementation in the viewer.
- **orm.png** — glTF-packed ORM texture (one 1K texture, three channels):
  R = ambient occlusion (baked only, never used as a map in the render path),
  G = roughness, B = metalness. All values 0–1 physical range. Tiling/seamless.
  Do NOT export an orm if the material is map-less (scalar only).
- **emissive.png** — sRGB emit, optional. Only meaningful with a non-zero
  `emissiveIntensity` scalar in the library entry.

**Resolution:** 1K (1024×1024) is the baseline; 2K accepted if the fileset is
coherent (all maps at 2K or all at 1K). The vite plugin copies map files into
`editor/public/materials/<id>/` on build; URL paths in the JSON entry are
relative: `materials/<id>/albedo.png`, `materials/<id>/normal.png`, etc.

**Library entry shape** (sparse, normalized at load):

```jsonc
{
  "id": "bare-metal",
  "name": "Bare metal",
  "maps": {
    "albedo": "materials/bare-metal/albedo.png",
    "normal": "materials/bare-metal/normal.png",
    "orm": "materials/bare-metal/orm.png"
  },
  "color": "#c8cdd2",
  "roughness": 0.35,
  "metalness": 0.95,
  "normalScale": 0.5,     // strength of the normal map
  "envIntensity": 1,      // reflection/specular brightness
  "emissive": "#000000",  // emissive tint (black = off)
  "emissiveIntensity": 0, // emit strength multiplier
  "clearcoat": 0,         // top coat / lacquer layer
  "clearcoatRoughness": 0.3,
  "uvScale": 1,           // uniform texture repeat
  "uvRotation": 0         // degrees CCW about UV centre (0.5, 0.5)
}
```

All scalars except `maps` have defaults in LIB_DEFAULTS; omit them from the
materials.json entry to keep the file sparse and legible.

## 3. Deferred decisions (recorded 2026-08-01)

**KTX2/Basis compression (next optimization):** Albedo as ETC1S sRGB; normal as
UASTC+Zstd (ETC1S destroys normals); ORM as UASTC-or-ETC1S. Build step using
toktx (KTX-Software) with mtime caching in the vite data plugin; runtime KTX2Loader
+ basis transcoder wasm in public/. Motivation: ≈8× VRAM savings (block-compressed
on GPU) and wire size ≈0.3–1 MB per 1K map. PNG fallback remains dev-path.

**Per-assignment UV overrides:** UV transform lives on the material today; later
assignments may grow `uvMode: 'archive' | 'planar'` with per-assignment overrides
(scale/rotation per (ship, texture name)) for fine-tuning without library edits.

**Viewer parity:** The viewer still renders raw archive textures with no material
library remapping. Library drive is editor-only for now. Backport to the viewer
is blocked on viewer-side MaterialCache wiring (both apps share the three.js
material model but the viewer's ship/render architecture differs).

**Flood-fill remap — planar-projected world UVs per coplanar region:** The recovered
archive UVs have per-cube-face discontinuities (seams every 1m). Planar-projected
world-space UVs per coplanar-face region would tile seamlessly over large runs.
Geometry rebuild required (breaking render contract 2026-07-31 frozen); stored as
`uvMode: 'planar'` on assignments. Requires planar-region geometry + UV generator;
coordinates flow unchanged, render path adds geometry flag for tiling-aware sampler.

**Decals editor mode:** DecalGeometry for non-destructive surface detail (painted greeble,
weapon hardpoints, system badges). Stored like ShipDoc.extras (render-only, no binary
export). Needs decal capture in GLB export + viewer render layer for decals.

## 4. Starter set and workflow

**materials/materials.json** ships 8 map-less scalar materials (bare-metal variants,
hull paints, rubber) as a curated starting set. No associated map files — they are
pure color/roughness/metalness definitions.

**Workflow:**

1. Author maps in the texture editor of choice (Substance Painter, Blender, Photoshop +
   normal-map plugin). Export albedo (sRGB), normal (OpenGL), orm (RGB packed per
   spec §2) as 1K PNGs.
2. Create folder `materials/<id>/` and place the PNGs.
3. Add an entry to materials.json with id, name, and `maps` pointing at the files.
4. Run `cd editor && npm run build` — the vite plugin copies maps into public/ and
   generates the asset inventory.
5. Test in the editor: load a ship, switch to mesh mode, open Materials panel, click
   a texture name to open the browser. Your new material appears in the grid.
6. Tweak scalars (roughness, metalness, normal strength, etc.) in the preview.
7. Click "Export library" to download the updated materials.json and commit it.
