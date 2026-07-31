/* "Materials" tab: one expandable row per material slot, live-editing the
   MaterialStore; reflects external changes (e.g. resetSlot) via subscribe. */

import type { UiContext } from '../context';
import type { MaterialDef, MaterialSlot } from '../../core/types';
import { button, h } from '../dom';

type SliderKey = 'roughness' | 'metalness' | 'clearcoat' | 'clearcoatRoughness';
const SLIDERS: { key: SliderKey; label: string }[] = [
  { key: 'roughness', label: 'roughness' },
  { key: 'metalness', label: 'metalness' },
  { key: 'clearcoat', label: 'clearcoat' },
  { key: 'clearcoatRoughness', label: 'clearcoat rough.' },
];

function slider(label: string, min: number, max: number): { row: HTMLLabelElement; input: HTMLInputElement; val: HTMLSpanElement } {
  const row = document.createElement('label');
  row.append(label);
  const input = document.createElement('input');
  input.type = 'range'; input.min = String(min); input.max = String(max); input.step = '0.01';
  const val = h('span', 'val');
  row.append(input, val);
  return { row, input, val };
}

/** every archive texture the meshes reference — the Surface list */
function textureNames(ctx: UiContext): string[] {
  const names = new Set<string>(['wing_solar']);
  const walk = (subs?: { tex?: string[] }[]): void => {
    for (const s of subs ?? []) for (const t of s.tex ?? []) names.add(t);
  };
  for (const v of Object.values(ctx.data.shapeMesh)) walk(v.sub);
  for (const d of ctx.data.plates.all()) walk(d.mesh.sub);
  for (const m of ctx.data.moduleMesh) walk(m?.sub);
  for (const w of ctx.data.wingMesh) walk(w?.sub);
  return [...names].sort();
}

type SurfKey = 'normalScale' | 'roughnessK' | 'metalnessK' | 'envIntensity';
const SURF_SLIDERS: { key: SurfKey; label: string; max: number }[] = [
  { key: 'normalScale', label: 'normal strength', max: 2 },
  { key: 'roughnessK', label: 'roughness ×', max: 2 },
  { key: 'metalnessK', label: 'metalness ×', max: 2 },
  { key: 'envIntensity', label: 'reflections', max: 2 },
];

/** per-texture PBR response of the mesh-mode materials — the primary control */
function buildSurfaceSection(host: HTMLElement, ctx: UiContext): void {
  host.append(h('h3', 'mat-section', 'Surface textures'));
  for (const name of textureNames(ctx)) {
    const row = h('div', 'mat-row');
    const head = h('button', 'mat-head');
    head.type = 'button';
    const short = name.replace(/\.(bmp|png|jpg)$/i, '');
    head.append(h('span', 'mat-name', short), h('span', 'mat-caret', '▸'));
    const body = h('div', 'mat-body');

    const sliderEls = new Map<SurfKey, { input: HTMLInputElement; val: HTMLSpanElement }>();
    for (const s of SURF_SLIDERS) {
      const built = slider(s.label, 0, s.max);
      sliderEls.set(s.key, { input: built.input, val: built.val });
      body.append(built.row);
    }
    const tintRow = document.createElement('label');
    const tintInput = document.createElement('input');
    tintInput.type = 'checkbox';
    tintRow.append('tint by system', tintInput);
    const resetBtn = button('reset', { class: 'reset-btn' });
    body.append(tintRow, resetBtn);
    row.append(head, body);
    host.append(row);

    const refresh = (): void => {
      const def = ctx.surfaces.get(name);
      for (const s of SURF_SLIDERS) {
        const e = sliderEls.get(s.key)!;
        e.input.value = String(def[s.key]);
        e.val.textContent = def[s.key].toFixed(2);
      }
      tintInput.checked = def.tint;
    };
    refresh();

    for (const s of SURF_SLIDERS) {
      const e = sliderEls.get(s.key)!;
      e.input.oninput = () => {
        const v = Number(e.input.value);
        e.val.textContent = v.toFixed(2);
        ctx.surfaces.patch(name, { [s.key]: v });
      };
    }
    tintInput.onchange = () => ctx.surfaces.patch(name, { tint: tintInput.checked });
    resetBtn.onclick = () => ctx.surfaces.reset(name);
    head.onclick = () => row.classList.toggle('open');
    ctx.surfaces.subscribe(refresh);
  }
}

export function buildMaterialsTab(host: HTMLElement, ctx: UiContext): void {
  buildSurfaceSection(host, ctx);
  host.append(h('h3', 'mat-section', 'Part colors'));
  const slotName = (slot: MaterialSlot): string => {
    if (slot === 'wing') return 'wing';
    const def = ctx.data.systems.byId(Number(slot.slice(4)));
    return def ? def.name : slot;
  };
  for (const slot of ctx.materials.slots()) {
    const row = h('div', 'mat-row');
    const head = h('button', 'mat-head');
    head.type = 'button';
    const sw = h('span', 'sw');
    head.append(sw, h('span', 'mat-name', slotName(slot)), h('span', 'mat-caret', '▸'));

    const body = h('div', 'mat-body');

    const colorRow = document.createElement('label');
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorRow.append('color', colorInput);

    const sliderEls = new Map<SliderKey, { input: HTMLInputElement; val: HTMLSpanElement }>();
    for (const s of SLIDERS) {
      const built = slider(s.label, 0, 1);
      sliderEls.set(s.key, { input: built.input, val: built.val });
      body.append(built.row);
    }
    body.append(colorRow);

    const emissiveRow = document.createElement('label');
    const emissiveInput = document.createElement('input');
    emissiveInput.type = 'color';
    emissiveRow.append('emissive', emissiveInput);
    const ei = slider('emissive intensity', 0, 2);
    body.append(emissiveRow, ei.row);

    const resetBtn = button('reset', { class: 'reset-btn' });
    body.append(resetBtn);

    row.append(head, body);
    host.append(row);

    const refresh = () => {
      const def = ctx.materials.get(slot);
      sw.style.background = def.color;
      colorInput.value = def.color;
      emissiveInput.value = def.emissive;
      for (const s of SLIDERS) {
        const e = sliderEls.get(s.key)!;
        const v = def[s.key];
        e.input.value = String(v);
        e.val.textContent = v.toFixed(2);
      }
      ei.input.value = String(def.emissiveIntensity);
      ei.val.textContent = def.emissiveIntensity.toFixed(2);
    };
    refresh();

    colorInput.oninput = () => ctx.materials.patch(slot, { color: colorInput.value });
    emissiveInput.oninput = () => ctx.materials.patch(slot, { emissive: emissiveInput.value });
    for (const s of SLIDERS) {
      const e = sliderEls.get(s.key)!;
      e.input.oninput = () => {
        const v = Number(e.input.value);
        e.val.textContent = v.toFixed(2);
        const patch: Partial<MaterialDef> = { [s.key]: v };
        ctx.materials.patch(slot, patch);
      };
    }
    ei.input.oninput = () => {
      const v = Number(ei.input.value);
      ei.val.textContent = v.toFixed(2);
      ctx.materials.patch(slot, { emissiveIntensity: v });
    };
    resetBtn.onclick = () => ctx.materials.resetSlot(slot);

    head.onclick = () => row.classList.toggle('open');

    ctx.materials.subscribe(refresh);
  }
}
