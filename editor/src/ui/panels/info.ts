/* "Инфо" tab: ГОСТ-stamp ship card + compartment ledger + validation list.
   Re-renders its own subtree on model/materials change (debounced). */

import type { UiContext } from '../context';
import type { Issue } from '../../core/types';
import { WING_NAMES } from '../../core/tables';
import { compSlot } from '../../core/materials';
import { debounce, h } from '../dom';

export function buildInfoTab(host: HTMLElement, ctx: UiContext): void {
  const render = (): void => {
    host.innerHTML = '';

    const meta = ctx.model.doc.meta;
    const cubes = ctx.model.doc.cubes;
    const wings = ctx.model.doc.wings;

    let min: [number, number, number] | null = null;
    let max: [number, number, number] | null = null;
    for (const e of [...cubes, ...wings]) {
      if (!min || !max) { min = [e.x, e.y, e.z]; max = [e.x, e.y, e.z]; continue; }
      min = [Math.min(min[0], e.x), Math.min(min[1], e.y), Math.min(min[2], e.z)];
      max = [Math.max(max[0], e.x), Math.max(max[1], e.y), Math.max(max[2], e.z)];
    }
    const size = min && max
      ? [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1]
      : [0, 0, 0];

    const wingHist = new Map<number, number>();
    for (const w of wings) wingHist.set(w.kind, (wingHist.get(w.kind) ?? 0) + 1);
    const wingText = wings.length
      ? '· крылья ' + [...wingHist.entries()].sort((a, b) => a[0] - b[0])
          .map(([k, n]) => `${WING_NAMES[k]}×${n}`).join(' ')
      : '';

    const stamp = h('div', 'stamp');

    const row1 = h('div', 'row');
    const cellShip = h('div', 'cell grow');
    cellShip.append(h('span', 'lab', 'корабль'), h('div', 'big', meta.display || meta.name));
    const cellHull = h('div', 'cell');
    cellHull.append(h('span', 'lab', 'борт №'), h('div', 'num', meta.name.split('-')[0].toUpperCase()));
    row1.append(cellShip, cellHull);

    const row2 = h('div', 'row');
    const cellClass = h('div', 'cell grow');
    cellClass.append(h('span', 'lab', 'класс'), document.createTextNode(meta.class ?? '—'));
    const cellNation = h('div', 'cell grow');
    cellNation.append(h('span', 'lab', 'принадлежность'), document.createTextNode(meta.nation ?? '—'));
    const cellRank = h('div', 'cell');
    cellRank.append(h('span', 'lab', 'ранг'), document.createTextNode(meta.rank ?? '—'));
    row2.append(cellClass, cellNation, cellRank);

    const row3 = h('div', 'row');
    const cellSize = h('div', 'cell grow');
    cellSize.append(h('span', 'lab', 'габариты (клетки)'), document.createTextNode(`${size[0]} × ${size[1]} × ${size[2]}`));
    const cellStruct = h('div', 'cell grow');
    cellStruct.append(h('span', 'lab', 'структура'), document.createTextNode(`${cubes.length} блоков ${wingText}`));
    row3.append(cellSize, cellStruct);

    const hist = new Map<number, number>();
    for (const c of cubes) hist.set(c.comp, (hist.get(c.comp) ?? 0) + 1);
    const maxCount = Math.max(1, ...hist.values());
    const ledger = h('div', 'comp-ledger');
    for (const def of ctx.data.systems.all()) {
      const id = def.id;
      const n = hist.get(id);
      if (!n) continue;
      const color = ctx.materials.get(compSlot(id)).color;
      const crow = h('div', 'crow');
      const sw = h('span', 'sw'); sw.style.background = color;
      const bar = h('span', 'bar');
      const i = document.createElement('i');
      i.style.background = color; i.style.width = `${100 * n / maxCount}%`;
      bar.append(i);
      /* the stamp is a document — it keeps the exe's own names */
      crow.append(sw, h('span', 'cn', def.nameRu ?? def.name), bar, h('span', 'ct', String(n)));
      ledger.append(crow);
    }

    stamp.append(row1, row2, row3, ledger);
    host.append(stamp);

    const issues = ctx.actions.validateNow();
    const issuesBox = h('div', 'issues');
    if (issues.length === 0) issuesBox.append(h('div', 'issues-empty', 'проблем не найдено'));
    else for (const issue of issues) issuesBox.append(renderIssue(issue));
    host.append(issuesBox);
  };

  const scheduled = debounce(render, 200);
  render();
  ctx.model.subscribe(scheduled);
  ctx.materials.subscribe(scheduled);
}

function renderIssue(issue: Issue): HTMLElement {
  const el = h('div', `issue ${issue.level}`);
  el.append(h('span', 'code', issue.code), document.createTextNode(issue.message));
  return el;
}
