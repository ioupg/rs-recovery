/* "Сборка" tab: shape/orientation/compartment/wing pickers that feed the
   editor's active-placement state. */

import type { UiContext } from '../context';
import type { ShapeId } from '../../core/types';
import type { Tool } from '../../editor/state';
import { SHAPE_NAMES, WING_KINDS, WING_NAMES } from '../../core/tables';
import { compSlot } from '../../core/materials';
import { button, h } from '../dom';

export function buildBuildTab(host: HTMLElement, ctx: UiContext): { preview: HTMLCanvasElement } {
  /* ── live piece preview (rendered by render/shapePreview via main.ts) ── */
  const previewSection = h('section', 'panel-section');
  previewSection.append(h('h3', undefined, 'элемент'));
  const preview = document.createElement('canvas');
  preview.className = 'preview-canvas';
  previewSection.append(preview);
  previewSection.append(h('div', 'preview-legend',
    'оси: X красная · Y зелёная · Z синяя'));

  /* ── shape ── */
  const shapeSection = h('section', 'panel-section');
  shapeSection.append(h('h3', undefined, 'форма'));
  const shapeGrid = h('div', 'shape-grid');
  const shapeBtns = new Map<ShapeId, HTMLButtonElement>();
  const shapeIds = Object.keys(SHAPE_NAMES).map(Number) as ShapeId[];
  for (const id of shapeIds) {
    const b = button(SHAPE_NAMES[id], { class: 'swatch-btn' });
    b.onclick = () => ctx.state.update({ activeShape: id });
    shapeBtns.set(id, b);
    shapeGrid.append(b);
  }
  shapeSection.append(shapeGrid);

  /* ── orientation ── */
  const orientSection = h('section', 'panel-section');
  orientSection.append(h('h3', undefined, 'ориентация'));
  const orientStepper = h('div', 'orient-stepper');
  const prevBtn = button('◀');
  const orientVal = h('span', 'orient-val', String(ctx.state.activeOrient));
  const nextBtn = button('▶');
  prevBtn.onclick = () => ctx.state.update({ activeOrient: (ctx.state.activeOrient + 23) % 24 });
  nextBtn.onclick = () => ctx.state.update({ activeOrient: (ctx.state.activeOrient + 1) % 24 });
  orientStepper.append(prevBtn, orientVal, nextBtn);
  orientSection.append(orientStepper);
  orientSection.append(h('div', 'preview-legend',
    'X/Y/Z — поворот вокруг оси · Shift — обратно · R — перебор'));

  /* ── compartment ── */
  const compSection = h('section', 'panel-section');
  compSection.append(h('h3', undefined, 'отсек'));
  const compGrid = h('div', 'comp-grid');
  const compBtns = new Map<number, HTMLButtonElement>();
  for (const def of ctx.data.systems.all()) {
    const id = def.id;
    const b = h('button', 'comp-btn');
    const sw = h('span', 'sw');
    sw.style.background = ctx.materials.get(compSlot(id)).color;
    b.append(sw, h('span', 'cn', def.name));
    b.title = def.nameRu ?? def.key;
    b.onclick = () => ctx.state.update({ activeComp: id });
    compBtns.set(id, b);
    compGrid.append(b);
  }
  compSection.append(compGrid);

  /* ── wing kind ── */
  const wingSection = h('section', 'panel-section');
  wingSection.append(h('h3', undefined, 'крыло'));
  const wingGrid = h('div', 'wing-grid');
  const wingBtns = new Map<number, HTMLButtonElement>();
  for (const k of WING_KINDS) {
    const b = button(WING_NAMES[k], { class: 'swatch-btn' });
    b.onclick = () => ctx.state.update({ activeWingKind: k });
    wingBtns.set(k, b);
    wingGrid.append(b);
  }
  wingSection.append(wingGrid);

  host.append(previewSection, shapeSection, orientSection, compSection, wingSection);

  /* ── reactive refresh ── */
  const refreshActive = () => {
    for (const [id, b] of shapeBtns) b.classList.toggle('active', ctx.state.activeShape === id);
    for (const [id, b] of compBtns) b.classList.toggle('active', ctx.state.activeComp === id);
    for (const [id, b] of wingBtns) b.classList.toggle('active', ctx.state.activeWingKind === id);
  };
  const refreshRelevance = () => {
    const tool: Tool = ctx.state.tool;
    const shapeRelevant = tool === 'add';
    const compRelevant = tool === 'add' || tool === 'paint';
    const wingRelevant = tool === 'wing';
    shapeSection.classList.toggle('irrelevant', !shapeRelevant);
    orientSection.classList.toggle('irrelevant', !(shapeRelevant || wingRelevant));
    compSection.classList.toggle('irrelevant', !compRelevant);
    wingSection.classList.toggle('irrelevant', !wingRelevant);
    previewSection.classList.toggle('irrelevant', !(shapeRelevant || wingRelevant));
  };
  refreshActive();
  refreshRelevance();

  ctx.state.subscribe(keys => {
    if (keys.includes('activeOrient')) orientVal.textContent = String(ctx.state.activeOrient);
    if (keys.includes('activeShape') || keys.includes('activeComp') || keys.includes('activeWingKind')) refreshActive();
    if (keys.includes('tool')) refreshRelevance();
  });

  return { preview };
}
