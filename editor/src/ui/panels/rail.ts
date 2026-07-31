/* Left rail: file operations + fleet registry (renders once; selection is
   reflected by toggling a class on the pre-built buttons). */

import type { UiContext } from '../context';
import { button, h } from '../dom';

const RANKS = ['I', 'I+', 'II', 'III', 'IV', 'V', 'VI', '-', '?'];

export function buildRail(host: HTMLElement, ctx: UiContext): void {
  host.className = 'rail';
  host.setAttribute('aria-label', 'Файл и реестр флота');

  /* ── file ops ── */
  const file = h('div', 'rail-file');
  const newBtn = button('новый');
  newBtn.onclick = () => ctx.actions.newShip();

  const importBtn = button('импорт JSON');
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

  const exportJsonBtn = button('экспорт JSON');
  exportJsonBtn.onclick = () => ctx.actions.exportJson();

  const exportGlbBtn = button('экспорт GLB');
  exportGlbBtn.onclick = () => ctx.actions.exportGlb();

  file.append(newBtn, importBtn, fileInput, exportJsonBtn, exportGlbBtn);
  host.append(file);

  /* ── fleet registry, grouped by rank ── */
  const byRank = new Map<string, { name: string; display: string; class: string }[]>();
  for (const [name, s] of Object.entries(ctx.data.ships)) {
    const list = byRank.get(s.rank) ?? [];
    list.push({ name, display: s.display, class: s.class });
    byRank.set(s.rank, list);
  }

  const shipBtns = new Map<string, HTMLButtonElement>();
  for (const r of RANKS) {
    const list = byRank.get(r);
    if (!list) continue;
    host.append(h('div', 'rank', r === '-' ? 'гражданские' : r === '?' ? 'без реестра' : `ранг ${r}`));
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const s of list) {
      const b = h('button', 'ship');
      b.append(
        h('span', 'hull', s.name.split('-')[0].toUpperCase()),
        h('span', 'nm', s.display),
        h('span', 'cls', s.class),
      );
      b.onclick = () => ctx.actions.loadFleetShip(s.name);
      shipBtns.set(s.name, b);
      host.append(b);
    }
  }

  const refreshSelection = () => {
    const current = ctx.model.doc.meta.name;
    for (const [name, b] of shipBtns) b.classList.toggle('sel', name === current);
  };
  refreshSelection();
  ctx.model.subscribe(refreshSelection);
}
