/* App-global IBL environment for every PBR scene (main viewport, material
   preview, shared thumbnail context). 'room' is three's synthetic
   RoomEnvironment; the HDRI entries are CC0/public-domain equirects under
   env/ (provenance in notes/08-materials.md §5), copied to public/env/ by
   the vite plugin. PMREM output is bound to its WebGLRenderer, so processed
   environments cache per (renderer, id) while the decoded .hdr caches once.
   Selection is app-global, persisted, and observable. */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { Unsubscribe } from '../core/types';

export interface EnvironmentDef {
  id: string;
  name: string;
  /** equirect .hdr under the site base; absent = built-in RoomEnvironment */
  url?: string;
}

export const ENVIRONMENTS: readonly EnvironmentDef[] = [
  { id: 'room', name: 'Room (neutral)' },
  { id: 'studio', name: 'Studio', url: 'env/studio_small_08_1k.hdr' },
  { id: 'machine-shop', name: 'Machine shop', url: 'env/machine_shop_02_1k.hdr' },
  { id: 'sunset', name: 'Sunset', url: 'env/venice_sunset_1k.hdr' },
  { id: 'space', name: 'Deep space (NASA)', url: 'env/nasa_starmap_2020_1k.hdr' },
];

const ENV_KEY = 'rs.editor.env.v1';

function loadStored(): string {
  try {
    const v = localStorage.getItem(ENV_KEY);
    return v && ENVIRONMENTS.some(e => e.id === v) ? v : 'room';
  } catch {
    return 'room';
  }
}

let current = loadStored();
const listeners = new Set<() => void>();
const emit = (): void => { for (const fn of listeners) fn(); };

export function currentEnvironment(): string { return current; }

export function setEnvironment(id: string): void {
  if (id === current || !ENVIRONMENTS.some(e => e.id === id)) return;
  current = id;
  try { localStorage.setItem(ENV_KEY, id); } catch { /* quota tolerated */ }
  emit();
}

/** Fires on selection change AND after an async HDR swap lands, because the
    swap invalidates every already-rendered thumbnail. Subscribers re-apply +
    re-render; both are cheap no-ops when nothing actually changed. */
export function subscribeEnvironment(fn: () => void): Unsubscribe {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** decoded equirects, renderer-agnostic, shared by every context */
const hdrCache = new Map<string, Promise<THREE.DataTexture>>();
/** PMREM results are render targets on their own GL context — never share */
const pmremCache = new WeakMap<THREE.WebGLRenderer, Map<string, THREE.Texture>>();

function rendererCache(renderer: THREE.WebGLRenderer): Map<string, THREE.Texture> {
  let m = pmremCache.get(renderer);
  if (!m) pmremCache.set(renderer, m = new Map());
  return m;
}

function roomTexture(renderer: THREE.WebGLRenderer): THREE.Texture {
  const cache = rendererCache(renderer);
  let tex = cache.get('room');
  if (!tex) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const src = new RoomEnvironment();
    tex = pmrem.fromScene(src, 0.04).texture;
    src.dispose();
    pmrem.dispose();
    cache.set('room', tex);
  }
  return tex;
}

/** Point scene.environment at the current selection. Cached environments
    (and the built-in room) apply synchronously; a cold HDRI applies the room
    as a stand-in and swaps in place once decoded — or drops the swap if the
    selection moved on meanwhile (the PMREM is cached either way). A failed
    fetch keeps the room and logs: offline dev is a normal state, and the
    next apply retries. Textures are cache-owned for the app's life — scenes
    must never dispose what this hands them. */
export function applyEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  const id = current;
  const def = ENVIRONMENTS.find(e => e.id === id)!;
  if (!def.url) {
    scene.environment = roomTexture(renderer);
    return;
  }
  const cache = rendererCache(renderer);
  const hit = cache.get(def.id);
  if (hit) {
    scene.environment = hit;
    return;
  }
  scene.environment = roomTexture(renderer);
  let p = hdrCache.get(def.url);
  if (!p) hdrCache.set(def.url, p = new HDRLoader().loadAsync(import.meta.env.BASE_URL + def.url));
  p.then(hdr => {
    let tex = cache.get(def.id);
    if (!tex) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      tex = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      cache.set(def.id, tex);
    }
    if (current !== id) return;
    scene.environment = tex;
    emit();
  }).catch(() => {
    hdrCache.delete(def.url!);
    console.info(`environment "${def.id}" failed to load — keeping the room env`);
  });
}
