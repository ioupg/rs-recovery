/* "Materials" tab: assignment rows (archive texture → library material, mesh
   mode) plus the Schematic colors section (box/facet/plate modes and systems
   view — unchanged MaterialStore slot-def behavior). The old per-texture
   slider section and "tint by system" are gone: mesh-mode materials are now
   fully library-driven via the material browser modal. */

import type { UiContext } from '../context';
import type { LibMaterial, MaterialDef, MaterialSlot } from '../../core/types';
import { collectTextureNames } from '../../data/loader';
import { renderMaterialThumb } from '../../render/shapePreview';
import { subscribeTextureLoads } from '../../render/textureCache';
import { openMaterialBrowser } from '../materialBrowser';
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

const shortName = (name: string): string => name.replace(/\.(bmp|png|jpg)$/i, '');

/** the assigned library material for a texture name, falling back to its own
    legacy wrap if the assigned id has gone missing (defensive) */
function resolveAssigned(ctx: UiContext, name: string): LibMaterial | undefined {
  return ctx.library.byId(ctx.assignments.get(name)) ?? ctx.library.byId(name);
}

/** one row per archive texture name — click opens the material browser to
    reassign it; thumb + assigned material name reflect the current mapping */
function buildAssignmentSection(host: HTMLElement, ctx: UiContext): void {
  host.append(h('h3', 'mat-section', 'Materials'));

  const rows: { name: string; img: HTMLImageElement; matName: HTMLElement }[] = [];
  for (const name of collectTextureNames(ctx.data)) {
    const row = h('button', 'matlib-row');
    row.type = 'button';

    const img = document.createElement('img');
    img.className = 'matlib-thumb';
    img.alt = name;

    const matName = h('span', 'matlib-mat');
    const info = h('span', 'matlib-info');
    info.append(h('span', 'matlib-tex', shortName(name)), matName);
    row.append(img, info);
    row.onclick = () => openMaterialBrowser(ctx, { assignFor: name });
    host.append(row);

    rows.push({ name, img, matName });
  }

  const refresh = (): void => {
    for (const r of rows) {
      const mat = resolveAssigned(ctx, r.name);
      if (!mat) continue;
      r.img.src = renderMaterialThumb(mat);
      r.matName.textContent = mat.name;
    }
  };
  refresh();

  ctx.assignments.subscribe(refresh);
  ctx.library.subscribe(refresh);
  subscribeTextureLoads(refresh);
}

/** the box/facet/plate/systems-view slot palette — unchanged behavior,
    formerly titled "Part colors" */
function buildSchematicSection(host: HTMLElement, ctx: UiContext): void {
  host.append(h('h3', 'mat-section', 'Schematic colors'));
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

export function buildMaterialsTab(host: HTMLElement, ctx: UiContext): void {
  buildAssignmentSection(host, ctx);
  buildSchematicSection(host, ctx);
}
