/* Header toolbar: tools, render mode, toggles, symmetry, layout, undo/redo, fit. */

import type { UiContext } from '../context';
import type { Tool } from '../../editor/state';
import { button, divider, h } from '../dom';

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'select', key: '1' },
  { id: 'add', label: 'add', key: '2' },
  { id: 'erase', label: 'erase', key: '3' },
  { id: 'paint', label: 'paint', key: '4' },
  { id: 'wing', label: 'wing', key: '5' },
];

const RENDER_MODES: { id: 'box' | 'plate' | 'mesh'; label: string }[] = [
  { id: 'box', label: 'box' },
  { id: 'plate', label: 'plate' },
  { id: 'mesh', label: 'mesh' },
];

type ToggleKey = 'edges' | 'compColors' | 'textures' | 'chamfer' | 'ao';
const TOGGLES: { key: ToggleKey; label: string }[] = [
  { key: 'edges', label: 'edges' },
  { key: 'compColors', label: 'comp' },
  { key: 'textures', label: 'tex' },
  { key: 'chamfer', label: 'chamfer' },
  { key: 'ao', label: 'ao' },
];

export function buildHeader(host: HTMLElement, ctx: UiContext): void {
  host.className = 'topbar';

  host.append(h('span', 'star', '★'));
  const title = h('h1');
  title.innerHTML = '<em>Ред Стар</em> · конструктор';
  host.append(title, h('span', 'spacer'));

  /* ── tools ── */
  const toolGroup = h('div', 'group');
  const toolBtns = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOLS) {
    const b = button(t.label, { title: `${t.label} (${t.key})` });
    b.onclick = () => ctx.state.update({ tool: t.id });
    toolBtns.set(t.id, b);
    toolGroup.append(b);
  }
  host.append(toolGroup, divider());

  /* ── render mode ── */
  const modeGroup = h('div', 'group seg');
  const modeBtns = new Map<string, HTMLButtonElement>();
  for (const m of RENDER_MODES) {
    const b = button(m.label);
    b.onclick = () => ctx.state.update({ render: { ...ctx.state.render, mode: m.id } });
    modeBtns.set(m.id, b);
    modeGroup.append(b);
  }
  host.append(modeGroup, divider());

  /* ── toggles + plate variant ── */
  const toggleGroup = h('div', 'group');
  const toggleBtns = new Map<ToggleKey, HTMLButtonElement>();
  for (const tg of TOGGLES) {
    const b = button(tg.label);
    b.onclick = () => ctx.state.update({
      render: { ...ctx.state.render, [tg.key]: !ctx.state.render[tg.key] },
    });
    toggleBtns.set(tg.key, b);
    toggleGroup.append(b);
  }
  const plateN = ctx.data.plateMesh.quad_all.length;
  const plateBtn = button('', { title: 'варианты декоративной плиты (только mesh)' });
  const refreshPlateBtn = () => {
    plateBtn.textContent = plateN > 0 ? `plate ${ctx.state.render.plateVariant + 1}/${plateN}` : 'plate —';
    plateBtn.classList.toggle('irrelevant', ctx.state.render.mode !== 'mesh');
  };
  plateBtn.onclick = () => {
    if (plateN === 0) return;
    const next = (ctx.state.render.plateVariant + 1) % plateN;
    ctx.state.update({ render: { ...ctx.state.render, plateVariant: next } });
  };
  refreshPlateBtn();
  toggleGroup.append(plateBtn);
  host.append(toggleGroup, divider());

  /* ── symmetry ── */
  const symGroup = h('div', 'group');
  const symBtn = button('симметрия', { title: 'переключить симметрию (X)' });
  symBtn.onclick = () => ctx.state.update({
    symmetry: { ...ctx.state.symmetry, on: !ctx.state.symmetry.on },
  });
  const stepper = h('span', 'plane-stepper');
  const minusBtn = button('−', { class: 'stepbtn' });
  const planeVal = h('span', 'plane-val');
  planeVal.tabIndex = 0;
  planeVal.title = 'ввести плоскость симметрии';
  const plusBtn = button('+', { class: 'stepbtn' });
  const refreshPlane = () => { planeVal.textContent = String(ctx.state.symmetry.planeX2 / 2); };
  minusBtn.onclick = () => ctx.state.update({
    symmetry: { ...ctx.state.symmetry, planeX2: ctx.state.symmetry.planeX2 - 1 },
  });
  plusBtn.onclick = () => ctx.state.update({
    symmetry: { ...ctx.state.symmetry, planeX2: ctx.state.symmetry.planeX2 + 1 },
  });
  planeVal.onclick = () => {
    const raw = prompt('Плоскость симметрии (X):', String(ctx.state.symmetry.planeX2 / 2));
    if (raw === null) return;
    const v = Number(raw);
    if (Number.isFinite(v)) ctx.state.update({
      symmetry: { ...ctx.state.symmetry, planeX2: Math.round(v * 2) },
    });
  };
  refreshPlane();
  stepper.append(minusBtn, planeVal, plusBtn);
  symGroup.append(symBtn, stepper);
  host.append(symGroup, divider());

  /* ── layout ── */
  const layoutGroup = h('div', 'group seg');
  const singleBtn = button('single', { title: 'Tab' });
  const quadBtn = button('quad', { title: 'Tab' });
  singleBtn.onclick = () => ctx.state.update({ layout: 'single' });
  quadBtn.onclick = () => ctx.state.update({ layout: 'quad' });
  layoutGroup.append(singleBtn, quadBtn);
  host.append(layoutGroup, divider());

  /* ── undo/redo ── */
  const undoBtn = button('⟲', { title: 'Ctrl+Z' });
  const redoBtn = button('⟳', { title: 'Ctrl+Y' });
  undoBtn.onclick = () => ctx.history.undo();
  redoBtn.onclick = () => ctx.history.redo();
  host.append(undoBtn, redoBtn, divider());

  /* ── fit view ── */
  const fitBtn = button('вписать', { title: 'F' });
  fitBtn.onclick = () => ctx.actions.fitView();
  host.append(fitBtn);

  /* ── reactive refresh ── */
  const refreshTool = () => {
    for (const [id, b] of toolBtns) b.setAttribute('aria-pressed', String(ctx.state.tool === id));
  };
  const refreshRender = () => {
    for (const [id, b] of modeBtns) b.setAttribute('aria-pressed', String(ctx.state.render.mode === id));
    for (const [key, b] of toggleBtns) b.setAttribute('aria-pressed', String(ctx.state.render[key]));
    refreshPlateBtn();
  };
  const refreshSymmetry = () => {
    symBtn.setAttribute('aria-pressed', String(ctx.state.symmetry.on));
    refreshPlane();
  };
  const refreshLayout = () => {
    singleBtn.setAttribute('aria-pressed', String(ctx.state.layout === 'single'));
    quadBtn.setAttribute('aria-pressed', String(ctx.state.layout === 'quad'));
  };
  const refreshHistory = () => {
    undoBtn.disabled = !ctx.history.canUndo;
    redoBtn.disabled = !ctx.history.canRedo;
  };

  refreshTool(); refreshRender(); refreshSymmetry(); refreshLayout(); refreshHistory();

  ctx.state.subscribe(keys => {
    if (keys.includes('tool')) refreshTool();
    if (keys.includes('render')) refreshRender();
    if (keys.includes('symmetry')) refreshSymmetry();
    if (keys.includes('layout')) refreshLayout();
  });
  ctx.history.subscribe(refreshHistory);
}
