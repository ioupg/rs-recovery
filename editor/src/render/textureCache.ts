/* Recovered 2014 archive textures (decoded by decode_textures.py into
   recovered/textures/, copied to public/textures/ by the vite data plugin).
   UVs are D3D-authored: v=0 is the texture's top row, which matches raw
   top-down row order — so flipY stays OFF and UVs pass through unchanged.
   Tiling UVs (up to ~4) need RepeatWrapping.

   A parallel recovery pipeline may additionally drop enhanced PBR layers
   into recovered/textures-pbr/ (same vite plugin copies *.png over the
   originals + manifest.json into public/textures/): `<name>_n.png` tangent
   normal maps (OpenGL green-up) and `<name>_r.png` roughness modulators.
   manifest.json marks which of {d,n,r} exist per name; its absence is the
   normal case until that pipeline has run.

   Everything above textures/ is now resolved through the material library
   (libMaterial.ts): a LibMaterial names its maps as base-relative URLs and
   getMapTexture() below is the only entry point that turns those into live
   THREE.Texture objects, base-cached per (url, colorSpace) plus a uv-clone
   per (url, colorSpace, scale, rotation). */

import * as THREE from 'three';
import type { PbrFlags } from '../core/library';
import { requestFrame } from './invalidate';

let manifest: PbrFlags = {};

/** Loads textures/manifest.json once; call from main before building any
    materials. Any failure (404, absent pipeline, bad JSON) just leaves the
    manifest empty — that's the normal no-PBR-yet state, not an error. */
export async function initTextureMaps(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}textures/manifest.json`);
    manifest = res.ok ? (await res.json()) as PbrFlags : {};
  } catch {
    manifest = {};
  }
}

/** the loaded manifest — legacyMaterials() consumes it to decide which
    archive textures got enhanced normal/roughness siblings */
export function getManifest(): PbrFlags {
  return manifest;
}

/* ── base textures, per (url, colorSpace) ────────────────────── */

const base = new Map<string, THREE.Texture>();
const loadedBase = new Set<string>();
/** clones registered against a base entry that hasn't finished loading yet;
    their needsUpdate flips true in the base's onLoad (see the CRITICAL note
    on getMapTexture below) */
const pendingClones = new Map<string, Set<THREE.Texture>>();
let loader: THREE.TextureLoader | null = null;

const loadListeners = new Set<(url: string) => void>();

/** fires once per base texture that finishes loading, with the map URL that
    landed — the UI refreshes only the material thumbnails/previews whose maps
    reference it, since maps arrive asynchronously */
export function subscribeTextureLoads(fn: (url: string) => void): () => void {
  loadListeners.add(fn);
  return () => loadListeners.delete(fn);
}

const baseKey = (url: string, colorSpace: THREE.ColorSpace): string => `${url}|${colorSpace}`;

function getBase(url: string, colorSpace: THREE.ColorSpace): THREE.Texture {
  const key = baseKey(url, colorSpace);
  let t = base.get(key);
  if (!t) {
    loader ??= new THREE.TextureLoader();
    t = loader.load(`${import.meta.env.BASE_URL}${url}`, () => {
      loadedBase.add(key);
      const clones = pendingClones.get(key);
      if (clones) {
        for (const c of clones) c.needsUpdate = true;
        pendingClones.delete(key);
      }
      requestFrame();   // a map landing changes the next frame
      for (const fn of loadListeners) fn(url);
    });
    t.flipY = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = colorSpace;
    t.anisotropy = 8;
    base.set(key, t);
  }
  return t;
}

/* ── uv-transformed clones, per (url, colorSpace, scale, rotation) ──── */

const clones = new Map<string, THREE.Texture>();

/** Resolve a LibMaterial map URL to a live texture. Identity uv (scale 1,
    rotation 0, or omitted) returns the shared base texture; any other
    transform returns a cached clone (sharing the base's `.source`, so the
    GPU image itself is only ever uploaded once).

    CRITICAL: a clone made before the base image finishes loading has no
    pixels yet and will never upload on its own — three tracks upload need
    per Texture instance, not per shared Source. getBase()'s onLoad callback
    is what flips needsUpdate on every clone registered against it; clones
    made after the base has already loaded get a bind-ready version right
    here (direct assignment — see the shared-Source note below). */
export function getMapTexture(
  url: string, colorSpace: THREE.ColorSpace, uv?: { scale: number; rotationDeg: number },
): THREE.Texture {
  const b = getBase(url, colorSpace);
  const scale = uv?.scale ?? 1;
  const rotationDeg = uv?.rotationDeg ?? 0;
  if (scale === 1 && rotationDeg === 0) return b;

  const bKey = baseKey(url, colorSpace);
  const cKey = `${bKey}|${scale}|${rotationDeg}`;
  let c = clones.get(cKey);
  if (!c) {
    /* Texture.copy() (inside clone) sets needsUpdate on the fresh clone, which
       also bumps the SHARED Source version — that would force every texture on
       this image to fully re-upload (mipmap rebuild included) on next use.
       Snapshot/restore around the clone; the clone's own upload is driven by
       the version bookkeeping below. */
    const sourceVersion = b.source.version;
    c = b.clone();
    b.source.version = sourceVersion;
    c.repeat.set(scale, scale);
    c.center.set(0.5, 0.5);
    c.rotation = rotationDeg * Math.PI / 180;
    clones.set(cKey, c);
    if (loadedBase.has(bKey)) {
      /* bind-ready. Direct version assignment, NOT the needsUpdate setter:
         the setter also bumps the shared Source version, which would force
         the very re-upload the snapshot above just prevented. */
      c.version = 1;
    } else {
      /* Texture.copy() bumps the clone's version, and a versioned texture
         with no pixels makes the renderer warn every frame until the image
         lands — park it at 0; the base's onLoad flips needsUpdate for us. */
      c.version = 0;
      let pending = pendingClones.get(bKey);
      if (!pending) { pending = new Set(); pendingClones.set(bKey, pending); }
      pending.add(c);
    }
  }
  return c;
}
