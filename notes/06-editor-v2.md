# Editor v2 — requirements, decisions, plan

Written 2026-07-31 from user feedback on the first constructor build, plus the
decision to grow the parts base toward new ships. Supersedes nothing — the
format facts in `02-format-final.md`/`05-status.md` stay frozen.

Two thrusts:

- **A. UX overhaul** — the editor stops looking like a viewer with tools bolted
  on and becomes a mode-driven constructor.
- **B. Extensible parts base** — the engine accepts new systems, new plate
  meshes and new element kinds without touching core code; authors get a
  documented, to-scale Blender template (`notes/07-authoring.md`).

---

## A. UX requirements and decisions

### R1 — Load flow
The permanent left rail is a viewer idiom, not an editor one.
**Decision:** remove the left rail. File operations (New · Open JSON ·
Save JSON · Export GLB) move into the header. Fleet designs load through a
**"Load template design" modal** (grid of the 43 ships with name/class/cube
count; click to load, Esc to cancel). Startup state: empty new ship.

### R2 — Toolbar
**Decision:** icon buttons (emoji glyphs — zero assets, readable at 20 px)
with tooltips = English name + shortcut. Tools are reduced to five:

| # | tool | icon | note |
|---|------|------|------|
| 1 | Select | 🖱️/⬚ | move, delete, per-selection ops |
| 2 | Build  | 🧱 | places the active *item* — shapes AND wings (unified, R9) |
| 3 | Erase  | ✖️ | cubes and wings |
| 4 | Systems | ⚛️ | was "paint" — assigns the system/compartment of a cube |
| 5 | Plates | 🛡️ | per-face decoration (mount / remove / spin / choose mesh) |

A tool that edits state invisible in the current view mode **auto-switches the
view** and restores the previous mode when you leave the tool:
Systems tool → Systems view; Plates tool → Mesh view. Build/Erase/Select leave
the view alone.

### R3 — Terminology
"Paint" was never painting. **Decision:** tool renamed **Systems**; the
"naked" render mode renamed **Systems view** (it already shows the m1* cages
over the untinted palette — it *is* the systems view).

### R4 — Language
**Decision:** all UI chrome — buttons, tools, tabs, tooltips, hints, status
bar, validation messages — in **English**. Data text stays as-is: ship display
names, class/nation/rank strings, the ГОСТ-style info stamp. (The stamp is a
document, not chrome.)

### R5 — Viewports
Quad view earns nothing: the ortho panes are too small to edit in and duplicate
what view snapping gives for free. **Decision:** quad layout **removed**
(`Viewports` collapses to the single perspective viewport). In its place a
**view cube gizmo** in the top-right corner of the viewport: click a face/edge
to snap the orbit to that axis (camera stays perspective — no second
projection pipeline), drag the cube to orbit, click the corner house icon =
fit (same as F). Damped orbit stays on MMB/Alt+LMB as today.

### R6 — Keymap
Full rebind; every binding is shown in tooltips and the context panel.

| key | action |
|-----|--------|
| 1–5 | tools (Select, Build, Erase, Systems, Plates) |
| 7 8 9 0 | view mode: Box · Panels · Mesh · Systems |
| X / C / V | rotate active item (or selection) +90° about world X / Y / Z |
| Shift+X/C/V | same, −90° |
| Alt+X/C/V | **mirror** along world X / Y / Z (through reflection tables — one keystroke instead of a rotation dance) |
| R / Shift+R | cycle the 24 orientations; in Plates tool: spin plate about the face normal |
| Q / E | cycle item (Build) / system (Systems) / plate mesh (Plates) |
| M | symmetry toggle |
| F | fit view |
| P | toggle plates overlay |
| G | toggle edges |
| Del, Ctrl+Z/Y, Esc | delete / undo / redo / deselect |

Rationale: X-C-V sit under three adjacent fingers and X anchors the mnemonic
(X key = X axis); the old X/Y/Z scatter is gone. Digits stay mnemonic:
left hand row = tools, right half = views. (Implementation settled on X/C/V
over the draft's Z/X/C — same adjacency, better anchor.)

### R7 — Contextual right panel
The right panel's first tab is **bound to the active tool** (switching tool
switches the tab):

- **Select** — selection info; rotate/mirror buttons; system reassign; delete.
- **Build** — the unified item picker (R9); orientation readout with the
  rotated-axes preview; rotate/mirror buttons.
- **Systems** — system palette (swatch + name + count in ship).
- **Plates** — visual plate-mesh list (R10); spin control; bare/mounted stats.

Every tool page ends with an **active-shortcuts legend** for that tool.
Materials and Info remain as second/third tabs.

### R8 — Materials tab, reordered priorities
Mesh mode is the real look; its PBR response must be tunable.
**Decision:** Materials tab gets two sections, in this order:

1. **Surface textures** — per-texture PBR params for the mesh-mode materials
   (normal scale, roughness factor, metalness, env intensity), sliders, reset;
   persisted in exported JSON (`meshMaterials` extension) and applied by the
   texture/material cache.
2. **Part colors** — the existing per-system color/PBR sliders (secondary).

### R9 — Unified item picker (elements + wings)
Wings stop being a separate tool with abbreviation tabs. **Decision:** the
Build tool has one **visual picker grid**: 4 hull shapes + 5 wing kinds,
each rendered as a real 3-D thumbnail (offscreen `shapePreview` renders),
name underneath, active item highlighted. Q/E cycles through the same list.
Placement semantics stay as today (cubes occupy cells; wings anchor to hull).

### R10 — Plate painting
Plate presence editing exists (tool 6 today); what's missing is *choice*.
**Decision:** the Plates panel lists the available plate meshes **visually**
(thumbnail renders from the registry, B2): the archive defaults per type
first, greeble variants after. Click a mesh → it becomes the active plate;
click a hull face → mounts it (symmetry-aware); R spins it about the face
normal (the free decoration parameter). Per-face mesh choice is stored as a
`plateVariants` extension in the doc/JSON (the archive never stored variants,
so this is an editor-only field; absent = default mesh).

### R11 — Rotation gizmo (tried and dropped)
Two variants were built and shown live — free drag-rings and discrete
click-to-step arrows per axis — and both were judged not useful enough for
the 24-element group (2026-07-31, user decision). **Rotation lives on
X/C/V + Alt mirror + the panel button rows.** Revisit only with a genuinely
better idiom.

---

## B. Extensibility requirements and decisions

### R12 — Systems registry
Today comp 0..9 and `MATERIAL_SLOTS` are hardcoded unions. **Decision:** a
data-driven **systems registry** (`systems.json`, generated + user-extendable):

```jsonc
{ "id": 0, "key": "power", "name": "Power", "nameRu": "энергия",
  "color": "#E8C34A", "cage": "m1*power", "archive": true }
```

- ids 0–9 are the archive systems — frozen, `archive: true`, byte-exact
  round-trip guaranteed;
- new systems take ids ≥ 10, JSON-only (a validation note flags them if a
  binary `.rsconstruction` export is ever requested);
- material slots become string keys derived from the registry (`comp<N>`
  stays the storage key for compat); validation ranges, palette UI, GLB
  grouping and cage lookup all read the registry, not literals.

### R13 — Plate-mesh registry
**Decision:** plate meshes move behind a **registry**: `{ id, name, faceType
(quad | tri | slope | diag | cut), source (archive rid | custom), mesh }`.
The five `=default` archive types and the greeble variants are seeded from
the current data files; new entries can come from decoded archive meshes or
(later) imported GLB. The editor's plate picker (R10) and the geometry
builder resolve through the registry only. This is the "engine ready for new
plate meshes" requirement — the import UI itself stays out of scope.

### R14 — New element kinds (engine prototyping only — no editor UI yet)
The doc model grows a discriminated `elements` union next to cubes/wings.
Three prototypes, behind a dev flag, each with a procedural builder in
`render/` (wings set the precedent — procedural, not archive meshes):

1. **Lattice spine/mast** — a truss element spanning a straight run of cells
   (or replacing a solid element): `{ kind: 'lattice', from: cell, to: cell,
   profile: 'square'|'tri', chord, brace }` → generated strut mesh.
2. **Attached decorative mesh** — `{ kind: 'deco', meshId, anchor: { cell,
   face, offset }, o }` — registry-resolved mesh glued to a hull face/cell.
3. **Guyline** — `{ kind: 'guy', a: vertex, b: vertex, sag }` where a vertex
   is a cell corner `(cell, corner 0..7)`; rendered as a thin segment
   (straight at sag 0, sagged quadratic otherwise).

JSON schema for all three is documented in `07-authoring.md`; the validation
layer learns the new kinds; the binary format ignores them by design.

### R15 — Authoring spec + Blender template
`notes/07-authoring.md` + `templates/authoring-template.glb`: the full
to-scale contract for modeling new parts (cell = 1 unit, shell rim 0.05,
window 0.9, plate authored on z=0 with relief −z, module cage 0.88, wing
rings, vertex format, winding). The GLB opens directly in Blender (importer
converts Y-up→Z-up) and contains named reference objects: cell bounds, the
real k8 shell, a default plate at mounting pose, module cage + bounds, a wing
ring, axis markers.

---

## Implementation plan

| phase | contents | tasks |
|-------|----------|-------|
| 0 | this document | #1 |
| 1 | authoring spec + template GLB (unblocks the user's Blender work immediately) | #2 |
| 2 | core registries: systems, plate meshes; element-kind plumbing in types/validation/io | #3 |
| 3 | UI overhaul: English chrome, icon toolbar + auto view switch, load modal, quad removal, view cube, view shortcuts | #4 #5 |
| 4 | contextual panel, unified visual picker, Z/X/C + mirror keys | #6 #7 |
| 5 | plate painting with mesh choice; surface-texture PBR editor | #8 #9 |
| 6 | engine prototypes: lattice, deco, guylines (dev flag) | #10 |

Commit per phase; `npm test` green before each commit; parity invariants
(byte-exact round-trip of all 43 ships, frozen tables) are regression-tested
and non-negotiable. Deploy (`npm run build` + `wrangler deploy`) at the end.

**Deferred / non-goals:** GLB import UI for custom meshes; binary
`.rsconstruction` export; editing UI for lattice/deco/guylines; box-select;
quad-view resurrection.

---

## Current-state findings folded into the work (2026-07-31 audit)

- No i18n layer exists and none is wanted: chrome goes **mono-language
  English**, literals replaced in place. Data strings (COMP_NAMES from the
  exe, ship names, the stamp) stay Russian by design.
- The tool table is duplicated (`ui/panels/header.ts` vs the key handler in
  `editor/controller.ts`) — the overhaul introduces a single tool registry
  both read.
- `validation.ts` messages are already English — after R4 the app becomes
  consistent for free.
- `ShapePreview` binds one WebGL context per canvas; thumbnails (R9/R10)
  need a `renderToDataURL(spec)` path on one shared hidden renderer —
  browsers cap contexts at ~16.
- `PlateVariants` already has 4 slots but only `quad` has UI and only
  `quad`/`tri` are consumed — R10's registry + picker replaces this.
- `normalScale` is hardcoded (0.5) at material *creation* and never patched —
  R8 moves map params into `apply()` so edits are live.
- Mesh-mode diffuse is tinted by slot color unless flagged `untinted` — the
  Surface-textures section (R8) gets an explicit tint toggle.
- Status-bar hotkey hint is stale; replaced by the per-tool shortcut legend
  (R7) plus a rewritten global hint incl. mouse navigation.
- `ARCHITECTURE.md` drifted (lists a nonexistent `tools.ts`, 5 tools, wrong
  symmetry key) — updated as part of phase 3.
