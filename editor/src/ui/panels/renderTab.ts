/* "Render" tab: the viewport's global look — tone curve, exposure,
   environment + IBL strength, light rig, SSAO shape, backdrop. A plain view
   over the renderTuning store (render/renderTuning.ts, persisted); the
   environment picker drives the same app-global selection the material
   browser shows. The ao/tex/etc. on-off toggles stay in the header — this
   tab is the continuous dials. */

import {
  ENVIRONMENTS, currentEnvironment, setEnvironment, subscribeEnvironment,
} from '../../render/environment';
import {
  TONE_CURVES, getTuning, patchTuning, resetTuning, subscribeTuning,
} from '../../render/renderTuning';
import type { RenderTuning, ToneCurveId } from '../../render/renderTuning';
import { button, h } from '../dom';

type NumKey =
  'exposure' | 'envIntensity' | 'keyIntensity' | 'fillIntensity' | 'rimIntensity'
  | 'aoIntensity' | 'aoRadius';
type ColorKey = 'keyColor' | 'fillColor' | 'rimColor' | 'background';

export function buildRenderTab(host: HTMLElement): void {
  const refreshers: (() => void)[] = [];

  const section = (title: string): HTMLElement => {
    host.append(h('h3', 'mat-section', title));
    const box = h('div', 'mat-body render-tune');
    host.append(box);
    return box;
  };

  const row = (box: HTMLElement, label: string, title?: string): HTMLLabelElement => {
    const r = document.createElement('label');
    if (title) r.title = title;
    r.append(h('span', 'rt-lab', label));
    box.append(r);
    return r;
  };

  const range = (min: number, max: number): HTMLInputElement => {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = '0.01';
    return input;
  };

  const sliderRow = (
    box: HTMLElement, label: string, key: NumKey, min: number, max: number, title?: string,
  ): void => {
    const r = row(box, label, title);
    const input = range(min, max);
    const val = h('span', 'val');
    r.append(input, val);
    input.oninput = () => {
      const patch: Partial<RenderTuning> = { [key]: Number(input.value) };
      patchTuning(patch);
    };
    refreshers.push(() => {
      const v = getTuning()[key];
      input.value = String(v);
      val.textContent = v.toFixed(2);
    });
  };

  /* one row per light: colour swatch + intensity */
  const lightRow = (
    box: HTMLElement, label: string, colorKey: ColorKey, intensityKey: NumKey,
    max: number, title: string,
  ): void => {
    const r = row(box, label, title);
    const color = document.createElement('input');
    color.type = 'color';
    const input = range(0, max);
    const val = h('span', 'val');
    r.append(color, input, val);
    color.oninput = () => {
      const patch: Partial<RenderTuning> = { [colorKey]: color.value };
      patchTuning(patch);
    };
    input.oninput = () => {
      const patch: Partial<RenderTuning> = { [intensityKey]: Number(input.value) };
      patchTuning(patch);
    };
    refreshers.push(() => {
      const t = getTuning();
      color.value = t[colorKey];
      input.value = String(t[intensityKey]);
      val.textContent = t[intensityKey].toFixed(2);
    });
  };

  /* ── tone ── */
  const tone = section('Tone');
  const curveRow = row(tone, 'curve', 'how HDR radiance folds into the display range');
  const curveSel = document.createElement('select');
  for (const c of TONE_CURVES) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    curveSel.append(o);
  }
  curveRow.append(curveSel);
  curveSel.onchange = () => patchTuning({ toneCurve: curveSel.value as ToneCurveId });
  refreshers.push(() => { curveSel.value = getTuning().toneCurve; });
  sliderRow(tone, 'exposure', 'exposure', 0.2, 2.5, 'pre-curve exposure multiplier');

  /* ── environment ── */
  const env = section('Environment');
  const envRow = row(env, 'world', 'reflection environment (applies to the whole editor)');
  const envSel = document.createElement('select');
  for (const e of ENVIRONMENTS) {
    const o = document.createElement('option');
    o.value = e.id;
    o.textContent = e.name;
    envSel.append(o);
  }
  envRow.append(envSel);
  envSel.value = currentEnvironment();
  envSel.onchange = () => setEnvironment(envSel.value);
  subscribeEnvironment(() => { envSel.value = currentEnvironment(); });
  sliderRow(env, 'ambient', 'envIntensity', 0, 1.5,
    'IBL strength in the viewport — multiplies each material’s reflections slider');
  const back = row(env, 'backdrop');
  const backInput = document.createElement('input');
  backInput.type = 'color';
  back.append(backInput);
  backInput.oninput = () => patchTuning({ background: backInput.value });
  refreshers.push(() => { backInput.value = getTuning().background; });

  /* ── lights ── */
  const lights = section('Lights');
  lightRow(lights, 'key', 'keyColor', 'keyIntensity', 3, 'main sun — the only shadowed light');
  lightRow(lights, 'fill', 'fillColor', 'fillIntensity', 1.5,
    'hemisphere wash — diffuse only, metals never see it');
  lightRow(lights, 'rim', 'rimColor', 'rimIntensity', 1.5,
    'cool accent from below — unshadowed, keep faint');

  /* ── ambient occlusion ── */
  const ao = section('Ambient occlusion');
  sliderRow(ao, 'intensity', 'aoIntensity', 0, 4,
    'SSAO strength (the header “ao” toggle switches the pass off entirely)');
  sliderRow(ao, 'radius', 'aoRadius', 0.2, 2,
    'occluder search radius in cell units — small = contact shading, large = cavity gloom');

  const foot = h('div', 'mat-body render-tune');
  const resetBtn = button('reset to defaults', { class: 'reset-btn' });
  resetBtn.onclick = () => resetTuning();
  foot.append(resetBtn);
  host.append(foot);

  const refresh = (): void => { for (const fn of refreshers) fn(); };
  refresh();
  subscribeTuning(refresh);
}
