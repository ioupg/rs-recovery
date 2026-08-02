/* App-global render tuning for the main viewport: tone curve, exposure, IBL
   strength, light rig, SSAO shape, backdrop. One observable store (persisted
   like the environment selection) that scene.ts, ssao.ts and materialCache.ts
   consume; the Render tab is a plain view over it. Preview contexts
   (shapePreview.ts) deliberately stay on fixed defaults — thumbnails are
   product shots, not part of the tuned viewport. Routing the IBL strength
   through here also keeps scene.environmentIntensity and the materials'
   EnvBinding on one dial (they used to be two constants that could drift). */

import * as THREE from 'three';
import type { Unsubscribe } from '../core/types';

export const TONE_CURVES = [
  { id: 'neutral', name: 'Neutral (PBR)', tm: THREE.NeutralToneMapping },
  { id: 'agx', name: 'AgX', tm: THREE.AgXToneMapping },
  { id: 'aces', name: 'ACES filmic', tm: THREE.ACESFilmicToneMapping },
  { id: 'linear', name: 'Linear (off)', tm: THREE.NoToneMapping },
] as const;
export type ToneCurveId = typeof TONE_CURVES[number]['id'];

export interface RenderTuning {
  toneCurve: ToneCurveId;
  exposure: number;
  /** scene-level IBL strength; each material's own envIntensity multiplies it */
  envIntensity: number;
  keyIntensity: number; keyColor: string;
  fillIntensity: number; fillColor: string;
  rimIntensity: number; rimColor: string;
  aoIntensity: number;
  /** AO occluder search radius, cell units */
  aoRadius: number;
  background: string;
}

/** the rig as shipped (notes/09-render-path.md §5) */
export const TUNING_DEFAULTS: Readonly<RenderTuning> = {
  toneCurve: 'neutral',
  exposure: 1,
  envIntensity: 0.5,
  keyIntensity: 1.3, keyColor: '#fff2dc',
  fillIntensity: 0.3, fillColor: '#9fb6c9',
  rimIntensity: 0.2, rimColor: '#4a90d9',
  aoIntensity: 2, aoRadius: 0.7,
  background: '#0a0e14',
};

const TUNE_KEY = 'rs.editor.rendertune.v1';

function loadStored(): RenderTuning {
  try {
    const raw = localStorage.getItem(TUNE_KEY);
    if (!raw) return { ...TUNING_DEFAULTS };
    const t = { ...TUNING_DEFAULTS, ...(JSON.parse(raw) as Partial<RenderTuning>) };
    if (!TONE_CURVES.some(c => c.id === t.toneCurve)) t.toneCurve = 'neutral';
    return t;
  } catch {
    return { ...TUNING_DEFAULTS };   // no storage (tests) or corrupt JSON
  }
}

let current = loadStored();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function getTuning(): Readonly<RenderTuning> { return current; }

export function patchTuning(patch: Partial<RenderTuning>): void {
  current = { ...current, ...patch };
  /* a slider drag patches per frame — batch the storage write */
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(TUNE_KEY, JSON.stringify(current)); } catch { /* quota tolerated */ }
  }, 300);
  for (const fn of listeners) fn();
}

export function resetTuning(): void { patchTuning({ ...TUNING_DEFAULTS }); }

export function subscribeTuning(fn: () => void): Unsubscribe {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
