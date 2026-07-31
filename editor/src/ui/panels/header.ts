/* Header toolbar: file ops, tools (icons), render modes, toggles, symmetry,
   undo/redo, fit. Tools and modes come from the shared registry in
   editor/tools.ts — the keymap reads the same table. */

import type { UiContext } from '../context';
import { MODE_DEFS, TOOL_DEFS } from '../../editor/tools';
import { button, divider, h } from '../dom';

type ToggleKey = 'edges' | 'compColors' | 'textures' | 'ao' | 'plates';
const TOGGLES: { key: ToggleKey; label: string; title: string }[] = [
  { key: 'edges', label: 'edges', title: 'Edge overlay (G)' },
  { key: 'compColors', label: 'tint', title: 'Tint by system' },
  { key: 'textures', label: 'tex', title: 'Archive textures (mesh view)' },
  { key: 'ao', label: 'ao', title: 'Baked ambient occlusion' },
  { key: 'plates', label: 'plates', title: 'Decoration plates (P)' },
];

export function buildHeader(host: HTMLElement, ctx: UiContext): void {
  host.className = 'topbar';

  host.append(h('span', 'star', '★'));
  const title = h('h1');
  title.innerHTML = '<em>Ред Стар</em> · constructor';
  host.append(title, h('span', 'spacer'));

  /* ── file ── */
  const fileGroup = h('div', 'group');
  const newBtn = button('New', { title: 'New empty ship' });
  newBtn.onclick = () => ctx.actions.newShip();
  const loadBtn = button('Load…', { title: 'Load a template design from the fleet' });
  loadBtn.onclick = () => ctx.actions.openLoadDialog();
  const importBtn = button('Import', { title: 'Import ship JSON' });
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  importBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    if (f) ctx.actions.importJsonFile(f);
    fileInput.value = '';
  };
  const exportBtn = button('Save', { title: 'Export ship JSON' });
  exportBtn.onclick = () => ctx.actions.exportJson();
  const glbBtn = button('GLB', { title: 'Export GLB model' });
  glbBtn.onclick = () => ctx.actions.exportGlb();
  fileGroup.append(newBtn, loadBtn, importBtn, fileInput, exportBtn, glbBtn);
  host.append(fileGroup, divider());

  /* ── tools ── */
  const toolGroup = h('div', 'group');
  const toolBtns = new Map<string, HTMLButtonElement>();
  for (const t of TOOL_DEFS) {
    const b = button(t.icon, { title: `${t.name} (${t.key})`, class: 'icon-btn' });
    b.onclick = () => ctx.state.update({ tool: t.id });
    toolBtns.set(t.id, b);
    toolGroup.append(b);
  }
  host.append(toolGroup, divider());

  /* ── render mode ── */
  const modeGroup = h('div', 'group seg');
  const modeBtns = new Map<string, HTMLButtonElement>();
  for (const m of MODE_DEFS) {
    const b = button(m.name, { title: `${m.hint} (${m.key})` });
    b.onclick = () => ctx.state.update({ render: { ...ctx.state.render, mode: m.id } });
    modeBtns.set(m.id, b);
    modeGroup.append(b);
  }
  host.append(modeGroup, divider());

  /* ── toggles ── */
  const toggleGroup = h('div', 'group');
  const toggleBtns = new Map<ToggleKey, HTMLButtonElement>();
  for (const tg of TOGGLES) {
    const b = button(tg.label, { title: tg.title });
    b.onclick = () => ctx.state.update({
      render: { ...ctx.state.render, [tg.key]: !ctx.state.render[tg.key] },
    });
    toggleBtns.set(tg.key, b);
    toggleGroup.append(b);
  }
  host.append(toggleGroup, divider());

  /* ── symmetry ── */
  const symGroup = h('div', 'group');
  const symBtn = button('symmetry', { title: 'Mirror edits across the X plane (M)' });
  symBtn.onclick = () => ctx.state.update({
    symmetry: { ...ctx.state.symmetry, on: !ctx.state.symmetry.on },
  });
  const stepper = h('span', 'plane-stepper');
  const minusBtn = button('−', { class: 'stepbtn' });
  const planeVal = h('span', 'plane-val');
  planeVal.tabIndex = 0;
  planeVal.title = 'Set the symmetry plane';
  const plusBtn = button('+', { class: 'stepbtn' });
  const refreshPlane = () => { planeVal.textContent = String(ctx.state.symmetry.planeX2 / 2); };
  minusBtn.onclick = () => ctx.state.update({
    symmetry: { ...ctx.state.symmetry, planeX2: ctx.state.symmetry.planeX2 - 1 },
  });
  plusBtn.onclick = () => ctx.state.update({
    symmetry: { ...ctx.state.symmetry, planeX2: ctx.state.symmetry.planeX2 + 1 },
  });
  planeVal.onclick = () => {
    const raw = prompt('Symmetry plane (X):', String(ctx.state.symmetry.planeX2 / 2));
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

  /* ── undo/redo ── */
  const undoBtn = button('⟲', { title: 'Undo (Ctrl+Z)' });
  const redoBtn = button('⟳', { title: 'Redo (Ctrl+Y)' });
  undoBtn.onclick = () => ctx.history.undo();
  redoBtn.onclick = () => ctx.history.redo();
  host.append(undoBtn, redoBtn, divider());

  /* ── fit view ── */
  const fitBtn = button('fit', { title: 'Fit view (F)' });
  fitBtn.onclick = () => ctx.actions.fitView();
  host.append(fitBtn);

  /* ── reactive refresh ── */
  const refreshTool = () => {
    for (const [id, b] of toolBtns) b.setAttribute('aria-pressed', String(ctx.state.tool === id));
  };
  const refreshRender = () => {
    for (const [id, b] of modeBtns) b.setAttribute('aria-pressed', String(ctx.state.render.mode === id));
    for (const [key, b] of toggleBtns) b.setAttribute('aria-pressed', String(ctx.state.render[key]));
  };
  const refreshSymmetry = () => {
    symBtn.setAttribute('aria-pressed', String(ctx.state.symmetry.on));
    refreshPlane();
  };
  const refreshHistory = () => {
    undoBtn.disabled = !ctx.history.canUndo;
    redoBtn.disabled = !ctx.history.canRedo;
  };

  refreshTool(); refreshRender(); refreshSymmetry(); refreshHistory();

  ctx.state.subscribe(keys => {
    if (keys.includes('tool')) refreshTool();
    if (keys.includes('render')) refreshRender();
    if (keys.includes('symmetry')) refreshSymmetry();
  });
  ctx.history.subscribe(refreshHistory);
}
