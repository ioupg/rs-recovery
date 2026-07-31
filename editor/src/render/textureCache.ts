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
   normal case until that pipeline has run. */

import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();
let loader: THREE.TextureLoader | null = null;

type TextureManifest = Record<string, { d?: boolean; n?: boolean; r?: boolean }>;
let manifest: TextureManifest = {};

/** Loads textures/manifest.json once; call from main before building any
    materials. Any failure (404, absent pipeline, bad JSON) just leaves the
    manifest empty — that's the normal no-PBR-yet state, not an error. */
export async function initTextureMaps(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}textures/manifest.json`);
    manifest = res.ok ? (await res.json()) as TextureManifest : {};
  } catch {
    manifest = {};
  }
}

function load(url: string, colorSpace: THREE.ColorSpace): THREE.Texture {
  let t = cache.get(url);
  if (!t) {
    loader ??= new THREE.TextureLoader();
    t = loader.load(url);
    t.flipY = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = colorSpace;
    t.anisotropy = 8;
    cache.set(url, t);
  }
  return t;
}

export interface PartMaps {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
}

/** name is the archive reference, e.g. 'craftHull.bmp' → textures/craftHull.bmp.png,
    plus _n/_r siblings when manifest[name] marks them present. */
export function getPartMaps(name: string): PartMaps {
  if (typeof document === 'undefined') return { map: null, normalMap: null, roughnessMap: null };
  const base = `${import.meta.env.BASE_URL}textures/${name}`;
  const entry = manifest[name];
  return {
    map: load(`${base}.png`, THREE.SRGBColorSpace),
    normalMap: entry?.n ? load(`${base}_n.png`, THREE.NoColorSpace) : null,
    roughnessMap: entry?.r ? load(`${base}_r.png`, THREE.NoColorSpace) : null,
  };
}

/** Diffuse-only convenience wrapper over getPartMaps. */
export function getPartTexture(name: string): THREE.Texture | null {
  return getPartMaps(name).map;
}
