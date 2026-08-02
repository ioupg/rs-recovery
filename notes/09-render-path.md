# Editor render path — review for correctness and improvements (2026-08-01)

Audit of the lighting/shading pipeline behind the reported symptoms: IBL + PBR
mesh mode looks overbright, key-light shadows are nearly invisible, speculars
leak into occluded areas, baked AO barely reads — while the flat/textureless
modes stay consistent. Findings are ranked; §3 explains the symptoms, §4 is the
recommended change set. three.js r185 throughout.

## 1. The path as built

Four independent WebGL contexts, each its own renderer + light rig:

| context | file | lights | IBL | tone mapping |
|---|---|---|---|---|
| main viewport | `render/scene.ts:24` | hemi 0.9 + key 1.15 (shadowed) + rim 0.45 | own-envMap × 0.35 | **none** |
| shape preview | `render/shapePreview.ts:55` | hemi 1.1 + key 1.2 | none | **none** |
| shared thumbnails | `render/shapePreview.ts:150` | hemi 1.15 + key 1.2 | scene env × 0.9, bound lazily | **none** |
| material preview | `render/shapePreview.ts:336` | hemi 1.0 + key 1.2 | own-envMap × 0.9 | **none** |

- **Renderer** (`scene.ts:24-27`): PCFSoftShadowMap, pixel ratio ≤ 2, defaults
  otherwise — `outputColorSpace = SRGB` (correct), `toneMapping =
  NoToneMapping` (the root problem, §3.1). No post pipeline; the reference
  viewer's `postfx.js` has no editor counterpart.
- **Environment** (`render/environment.ts`): PMREM per (renderer, env id),
  decoded .hdr shared. Because three overwrites `envMapIntensity` with
  `scene.environmentIntensity` for materials that inherit `scene.environment`,
  every ship material binds its **own** envMap
  (`libMaterial.ts:57 bindEnvMap`), with intensity = scene strength
  (`VIEWPORT_ENV_INTENSITY 0.35` / `PREVIEW_ENV_INTENSITY 0.9`) × the
  material's `envIntensity` slider. Verified correct for r185.
- **Materials** (`render/materialCache.ts`, `render/libMaterial.ts`): cached
  `MeshPhysicalMaterial` per (slot, variant), patched in place;
  `vertexColors: true` always. Map routing is correct: albedo/emissive SRGB,
  normal/ORM/roughness `NoColorSpace`, ORM as glTF-style G=roughness
  B=metalness, `flipY` off for the D3D-authored UVs, OpenGL green-up normals.
- **Geometry shading** (`render/geometry.ts:51-120`): vertex colour carries a
  single premultiplied grayscale — `AO × facetTone(±6%) × brightness`
  (`MODULE_BRIGHT 0.78`, `PLATE_BRIGHT 1.06`). AO itself
  (`render/ao.ts:37 vertexAO`) is cosine-weighted obscurance over a 4³ cell
  neighbourhood — the bake is fine; how it enters the shader is not (§3.2).
- **Shadows**: one 2048² map on the key light, frustum fit to ship bounds
  (`scene.ts:74 fitShadow`); bias −0.0004 / normalBias 0.02 — sane.

## 2. What is correct

Worth stating so the fixes don't churn it: the sRGB/linear texture routing,
ORM channel convention, flipY choice, PMREM-per-renderer caching, the
own-envMap workaround for the reflections slider, the clone/version
bookkeeping in `textureCache.ts`, the patch-in-place material discipline with
`needsUpdate` only on program-changing transitions, and the shadow-frustum
fit. None of the symptoms trace to these.

## 3. Findings

### 3.1 No tone mapping — the primary overbrightness (all four contexts)

`renderer.toneMapping` is never set, so HDR radiance (IBL texels, the recently
×10'd deep-space HDRI, key+hemi+rim sums) **clips at 1.0**. Consequences
compound: highlights blow to flat white, anything already near white can't get
brighter so *lit vs shadowed* compresses, and specular hotspots read as leaks
because their falloff is amputated. This alone accounts for most of
"overbrighten with little visible shadow".

Fix: `renderer.toneMapping = THREE.NeutralToneMapping` (Khronos PBR Neutral —
near-identity below ~0.8, hue-preserving; the right default for an editor
where colour fidelity matters more than filmic look; `AgXToneMapping` is the
alternative if a softer roll-off wins by eye). Apply in **all four contexts**
or thumbnails stop matching the viewport. Side effect to handle: tone mapping
runs in every material's output, so overlay `MeshBasicMaterial`s (ghost,
selection, symmetry plane, edge lines, grid) should set `toneMapped = false`
to keep their exact UI hues. A `Color` scene.background is not tone mapped —
no change needed there.

### 3.2 Vertex-colour AO never occludes specular — why AO vanishes in mesh mode

Vertex colours multiply `diffuseColor` (three's `color_fragment`). The library
is metal-dominated (metalness mean 0.845 across `materials/materials.json`;
scalars 1 passing the ORM map through), and for metals:

- diffuse lobe ≈ 0 → the diffuse darkening AO relies on has nothing to darken;
- vColor does scale metallic F0, but Schlick's F90 = 1 regardless — at grazing
  angles env specular reaches full strength through any AO value;
- dielectric F0 (0.04) and the clearcoat lobe ignore vColor entirely.

Meanwhile **HemisphereLight contributes irradiance only** — on metals it does
nothing — so a metal's entire appearance is unoccluded IBL specular plus two
unshadowed-or-clipped highlights. That is exactly "leaking unshadowed
speculars, almost no visible AO". The flat slot defs (roughness 0.72,
metalness 0.18, `core/materials.ts:13`) are diffuse-dominant, which is why
those modes still read.

Fix (the real one): stop premultiplying, split the channels, and feed AO into
three's own occlusion path.

1. `SlotBuckets.vertex` takes `(ao, tone)` and writes `col = (ao, tone, 1)`
   instead of the single gray (`geometry.ts:61-72`); callers pass the factors
   they already compute separately (AO vs `facetTone × MODULE/PLATE_BRIGHT`).
2. One `onBeforeCompile` on the cached materials (set once at creation in
   `MaterialCache.get`, plus a constant `customProgramCacheKey`):

```glsl
// replace #include <color_fragment>
#if defined( USE_COLOR )
  diffuseColor.rgb *= vColor.g;              // facet tone × brightness only
#endif

// append after #include <aomap_fragment>
#if defined( USE_COLOR )
  float vAO = vColor.r;
  reflectedLight.indirectDiffuse *= vAO;
  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= vAO;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float vDotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( vDotNV, vAO, material.roughness );
  #endif
#endif
```

`computeSpecularOcclusion` is three's own roughness/angle-aware attenuation —
identical treatment to a real `aoMap` (which stays impossible here: the bake
is per-vertex, not per-texel, and an aoMap would double-darken —
`libMaterial.ts:86`). Direct light is deliberately not AO'd; the shadow map
owns that. Grazing Fresnel still wins over any AO scheme — that residue is
physics, not a bug. Note this widens the deliberate deviation from the viewer
(which bakes tint into vColor); parity note in `geometry.ts:6-10` should grow
a line.

### 3.3 Double-provisioned ambient — why shadows wash out

Shadowed hull still receives hemi 0.9 + rim 0.45 + full IBL (env shadows don't
exist in a rasterizer); only the key 1.15 is subtracted. Lit:shadow ends up
≈ 2:1 *before* the clipping of §3.1 compresses it further. The hemisphere
light predates the IBL and now duplicates its job.

Fix, after tone mapping is in: drop hemi to ~0.3 (or remove and let the IBL be
the ambient, raising `VIEWPORT_ENV_INTENSITY` to compensate), keep or
slightly raise the key (~1.3) so the shadow term dominates. Rebalance by eye
per environment — numbers here are starting points, not gospel.

### 3.4 Rim light leaks specular by construction

The rim (`scene.ts:51`, from below at −8,−4,−6, no shadow) writes speculars
onto surfaces that face away from every conceivable occluder check. On the
metal-heavy library it reads as a second sun. Either halve it (~0.2) and
accept the residue as intentional fill, or make it `castShadow` (second 2048
map — probably not worth it for a stylistic accent).

### 3.5 Atlas CanvasTexture is treated as linear

`atlas.ts:100` sets no `colorSpace` on the `CanvasTexture`; canvas pixels are
sRGB-authored, so plate-mode colours render brighter than drawn (a 214/255
gray gains ~×1.4 in linear light). Fix: `tex.colorSpace = SRGBColorSpace`.
The palette was tuned by eye against the wrong decode, so expect to retouch
the atlas grays (or `PLATE_BRIGHT`) after flipping it — do this in the same
pass as §3.1 since both shift plate brightness.

### 3.6 Nits

- `key.shadow.radius = 4` (`scene.ts:47`) is ignored under `PCFSoftShadowMap`
  — dead line; radius only drives PCF/VSM.
- Thumbnail lighting is order-dependent: `ensureThumbEnv`
  (`shapePreview.ts:264`) binds the env to the shared thumb scene only when
  the first *material* thumb renders, so shape thumbnails rendered before that
  moment are lit differently from ones rendered after. Bind the env in
  `thumbCtx` unconditionally.
- `scene.environmentIntensity = VIEWPORT_ENV_INTENSITY` (`scene.ts:34`) only
  affects materials without an own envMap — today the invisible floor. Keep it
  in lockstep with the `EnvBinding` intensity or route both through one
  constant to avoid silent divergence.

## 4. Recommended order of application

1. **Tone mapping** (§3.1) in all four contexts + `toneMapped = false` on
   overlay materials. Biggest visible win, prerequisite for judging the rest.
2. **Light rebalance** (§3.3, §3.4): hemi ~0.3, rim ~0.2, key ~1.3, then tune
   per environment by eye.
3. **AO channel split + occlusion hook** (§3.2). Restores AO and kills most
   env-specular leak in crevices.
4. **Atlas colorSpace** (§3.5) with palette retouch.
5. Nits (§3.6) opportunistically.

Deferred / optional: an SSAO-class pass (N8AO or three's GTAO) would add
contact occlusion at plate-relief scale that the cell-grid bake cannot see —
real cost and a new post pipeline, so only if §3.2 proves insufficient; an
exposure slider next to the environment picker is cheap once tone mapping
exists and makes the ×10-style HDRI hand-scaling unnecessary.
