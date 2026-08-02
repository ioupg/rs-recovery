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

/** scene-level IBL strengths: the viewport keeps reflections restrained so
    the editing read stays flat; previews push them so materials pop. These
    multiply each material's own envIntensity (the "reflections" slider). */
/* 0.35 → 0.5 after Neutral tone mapping landed: the top end is compressed
   now, so more ambient lifts the midtones without clipping — and gives the
   AO more indirect light to carve visibly out of. */
export const VIEWPORT_ENV_INTENSITY = 0.5;
export const PREVIEW_ENV_INTENSITY = 0.9;

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

/** one in-flight PMREM per (renderer, env id) — thumbnails may ask dozens of
    times per frame while an HDRI is still decoding */
const pendingByRenderer = new WeakMap<THREE.WebGLRenderer, Set<string>>();

/** The current environment texture for this renderer, synchronously: cached
    entries (and the built-in room) return immediately; a cold HDRI kicks off
    its load and hands back the room as a stand-in — when the load lands, the
    change event fires and subscribers re-pull. A failed fetch keeps the room
    and logs (offline dev is a normal state); the next call retries. Textures
    are cache-owned for the app's life — callers must never dispose them. */
export function environmentTexture(renderer: THREE.WebGLRenderer): THREE.Texture {
  const def = ENVIRONMENTS.find(e => e.id === current)!;
  if (!def.url) return roomTexture(renderer);
  const cache = rendererCache(renderer);
  const hit = cache.get(def.id);
  if (hit) return hit;

  let pending = pendingByRenderer.get(renderer);
  if (!pending) pendingByRenderer.set(renderer, pending = new Set());
  if (!pending.has(def.id)) {
    pending.add(def.id);
    const url = def.url;
    let p = hdrCache.get(url);
    if (!p) hdrCache.set(url, p = new HDRLoader().loadAsync(import.meta.env.BASE_URL + url));
    p.then(hdr => {
      pending.delete(def.id);
      if (!cache.has(def.id)) {
        const pmrem = new THREE.PMREMGenerator(renderer);
        cache.set(def.id, pmrem.fromEquirectangular(hdr).texture);
        pmrem.dispose();
      }
      emit();
    }).catch(() => {
      pending.delete(def.id);
      hdrCache.delete(url);
      console.info(`environment "${def.id}" failed to load — keeping the room env`);
    });
  }
  return roomTexture(renderer);
}

/** Point scene.environment at the current selection (stand-in + re-emit
    semantics of environmentTexture). Note three's asymmetry: materials that
    inherit scene.environment have their envMapIntensity IGNORED — the
    renderer overwrites that uniform with scene.environmentIntensity
    (WebGLRenderer "material.envMap === null" branch). Per-material
    reflection strength therefore requires binding the material's own
    envMap — applyLibMaterial's env parameter — which is how the library
    materials get their working "reflections" slider. */
export function applyEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  scene.environment = environmentTexture(renderer);
}
