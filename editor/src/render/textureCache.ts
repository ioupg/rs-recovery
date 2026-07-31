/* Recovered 2014 archive textures (decoded by decode_textures.py into
   recovered/textures/, copied to public/textures/ by the vite data plugin).
   UVs are D3D-authored: v=0 is the texture's top row, which matches raw
   top-down row order — so flipY stays OFF and UVs pass through unchanged.
   Tiling UVs (up to ~4) need RepeatWrapping. */

import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();
let loader: THREE.TextureLoader | null = null;

/** name is the archive reference, e.g. 'craftHull.bmp' → textures/craftHull.bmp.png */
export function getPartTexture(name: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  let t = cache.get(name);
  if (!t) {
    loader ??= new THREE.TextureLoader();
    t = loader.load(`${import.meta.env.BASE_URL}textures/${name}.png`);
    t.flipY = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    cache.set(name, t);
  }
  return t;
}
