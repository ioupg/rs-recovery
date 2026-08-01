/* "Load template design" modal — replaces the old permanent left rail. Fleet
   designs grouped by rank; click loads and closes, Esc / backdrop cancels. */

import type { UiContext } from '../context';
import { h } from '../dom';

const RANKS = ['I', 'I+', 'II', 'III', 'IV', 'V', 'VI', '-', '?'];
const RANK_LABEL = (r: string): string =>
  r === '-' ? 'civilian' : r === '?' ? 'unregistered' : `rank ${r}`;

export function buildLoadModal(root: HTMLElement, ctx: UiContext): { open(): void } {
  const backdrop = h('div', 'modal-backdrop');
  const modal = h('div', 'modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', 'Load template design');

  const head = h('div', 'modal-head');
  head.append(h('h2', undefined, 'Load template design'));
  const closeBtn = h('button', 'modal-close', '✕');
  closeBtn.type = 'button';
  closeBtn.title = 'Close (Esc)';
  head.append(closeBtn);
  modal.append(head);

  const body = h('div', 'modal-body');

  /* ── saved designs (browser storage) — rebuilt on every open ── */
  const savedSection = h('div', 'saved-section');
  body.append(savedSection);
  const refreshSaved = (): void => {
    savedSection.innerHTML = '';
    const designs = ctx.actions.listLocalDesigns();
    if (!designs.length) return;
    savedSection.append(h('div', 'rank', 'saved designs — this browser'));
    const grid = h('div', 'ship-grid');
    for (const d of designs) {
      const card = h('div', 'ship-card saved-card');
      const b = h('button', 'saved-load');
      b.type = 'button';
      b.append(
        h('span', 'nm', d.display),
        h('span', 'cls', `${d.cubes} blocks · ${d.wings} wings · ${new Date(d.savedAt).toLocaleString()}`),
      );
      b.onclick = () => { ctx.actions.loadLocalDesign(d.name); close(); };
      const del = h('button', 'saved-del', '✕');
      del.type = 'button';
      del.title = `Delete “${d.display}” from browser storage`;
      del.onclick = e => {
        e.stopPropagation();
        if (!confirm(`Delete saved design “${d.display}”?`)) return;
        ctx.actions.deleteLocalDesign(d.name);
        refreshSaved();
      };
      card.append(b, del);
      grid.append(card);
    }
    savedSection.append(grid);
  };

  const byRank = new Map<string, { name: string; display: string; class: string; cubes: number }[]>();
  for (const [name, s] of Object.entries(ctx.data.ships)) {
    const list = byRank.get(s.rank) ?? [];
    list.push({ name, display: s.display, class: s.class, cubes: s.cubes.length });
    byRank.set(s.rank, list);
  }
  for (const r of RANKS) {
    const list = byRank.get(r);
    if (!list) continue;
    body.append(h('div', 'rank', RANK_LABEL(r)));
    const grid = h('div', 'ship-grid');
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const s of list) {
      const b = h('button', 'ship-card');
      b.type = 'button';
      b.append(
        h('span', 'hull', s.name.split('-')[0].toUpperCase()),
        h('span', 'nm', s.display),
        h('span', 'cls', `${s.class} · ${s.cubes} blocks`),
      );
      b.onclick = () => { ctx.actions.loadFleetShip(s.name); close(); };
      grid.append(b);
    }
    body.append(grid);
  }
  modal.append(body);
  backdrop.append(modal);
  backdrop.style.display = 'none';
  root.append(backdrop);

  const close = (): void => { backdrop.style.display = 'none'; };
  const open = (): void => { refreshSaved(); backdrop.style.display = 'flex'; modal.focus(); };

  closeBtn.onclick = close;
  backdrop.onclick = e => { if (e.target === backdrop) close(); };
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && backdrop.style.display !== 'none') { e.stopPropagation(); close(); }
  }, true);

  return { open };
}
