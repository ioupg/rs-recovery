/* Contextual tool tab: one page per tool, switched with the active tool.
   Build unifies hull shapes and wings in a single visual item picker
   (thumbnails via the shared offscreen renderer). Every page ends with the
   tool's shortcut legend. */

import type { UiContext } from '../context';
import type { ShapeId } from '../../core/types';
import type { Tool } from '../../editor/state';
import { SHAPE_NAMES, WING_KINDS, WING_NAMES } from '../../core/tables';
import { compSlot } from '../../core/materials';
import { renderThumbnail } from '../../render/shapePreview';
import { TOOL_DEFS, toolDef } from '../../editor/tools';
import { button, h } from '../dom';

const SHAPE_IDS = [0, 1, 2, 3] as ShapeId[];

function legend(lines: string[]): HTMLElement {
  const box = h('div', 'shortcut-legend');
  for (const l of lines) box.append(h('div', undefined, l));
  return box;
}

const GLOBAL_KEYS = 'M symmetry · F fit · 7–0 view · G edges · P plates · Ctrl+Z/Y undo';

/** system palette; live counts when a counter is supplied */
function systemPalette(ctx: UiContext, host: HTMLElement, counts: boolean): () => void {
  const grid = h('div', 'comp-grid');
  const btns = new Map<number, { b: HTMLButtonElement; ct: HTMLElement | null }>();
  for (const def of ctx.data.systems.all()) {
    const b = h('button', 'comp-btn');
    const sw = h('span', 'sw');
    sw.style.background = ctx.materials.get(compSlot(def.id)).color;
    const ct = counts ? h('span', 'ct') : null;
    b.append(sw, h('span', 'cn', def.name));
    if (ct) b.append(ct);
    b.title = def.nameRu ?? def.key;
    b.onclick = () => ctx.state.update({ activeComp: def.id });
    btns.set(def.id, { b, ct });
    grid.append(b);
  }
  host.append(grid);
  return () => {
    const hist = new Map<number, number>();
    if (counts)
      for (const c of ctx.model.doc.cubes) hist.set(c.comp, (hist.get(c.comp) ?? 0) + 1);
    for (const [id, { b, ct }] of btns) {
      b.classList.toggle('active', ctx.state.activeComp === id);
      if (ct) ct.textContent = String(hist.get(id) ?? '');
    }
  };
}

/** rotate + mirror button rows (X/C/V per axis; Shift+click = reverse spin) */
function orientOps(ctx: UiContext, host: HTMLElement): void {
  const AXES = ['X', 'C', 'V'];
  const AXIS_NAMES = ['x', 'y', 'z'];
  const rotRow = h('div', 'op-row');
  rotRow.append(h('span', 'op-label', 'rotate'));
  AXES.forEach((k, a) => {
    const b = button(AXIS_NAMES[a], { title: `Rotate 90° about world ${AXIS_NAMES[a].toUpperCase()} (${k}, Shift reverses)` });
    b.onclick = e => ctx.actions.rotateActive(a as 0 | 1 | 2, e.shiftKey ? -1 : 1);
    rotRow.append(b);
  });
  const mirRow = h('div', 'op-row');
  mirRow.append(h('span', 'op-label', 'mirror'));
  AXES.forEach((k, a) => {
    const b = button(AXIS_NAMES[a], { title: `Mirror along world ${AXIS_NAMES[a].toUpperCase()} (Alt+${k})` });
    b.onclick = () => ctx.actions.mirrorActive(a as 0 | 1 | 2);
    mirRow.append(b);
  });
  host.append(rotRow, mirRow);
}

export function buildToolPanel(host: HTMLElement, ctx: UiContext): { preview: HTMLCanvasElement } {
  const pages = new Map<Tool, HTMLElement>();
  const page = (id: Tool): HTMLElement => {
    const p = h('div', 'tool-page');
    pages.set(id, p);
    host.append(p);
    return p;
  };
  const refreshers: (() => void)[] = [];

  /* ── select ── */
  {
    const p = page('select');
    const info = h('div', 'sel-info');
    p.append(h('section', 'panel-section'), info);
    orientOps(ctx, p);
    const del = button('delete selection', { title: 'Del' });
    del.onclick = () => ctx.actions.deleteSelection();
    p.append(del);
    p.append(legend([toolDef('select').hint, GLOBAL_KEYS]));
    refreshers.push(() => {
      const uids = ctx.state.selection;
      let cubes = 0, wings = 0;
      for (const u of uids) {
        const en = ctx.model.byUid(u);
        if (en && 'shape' in en) cubes++; else if (en) wings++;
      }
      info.textContent = uids.size
        ? `selected: ${cubes} blocks · ${wings} wings`
        : 'nothing selected — click an entity';
      del.disabled = !uids.size;
    });
  }

  /* ── build ── */
  let preview: HTMLCanvasElement;
  {
    const p = page('build');
    const previewSection = h('section', 'panel-section');
    previewSection.append(h('h3', undefined, 'piece'));
    preview = document.createElement('canvas');
    preview.className = 'preview-canvas';
    previewSection.append(preview);
    previewSection.append(h('div', 'preview-legend', 'axes: X red · Y green · Z blue'));
    p.append(previewSection);

    const itemSection = h('section', 'panel-section');
    itemSection.append(h('h3', undefined, 'item'));
    const grid = h('div', 'item-grid');
    const itemBtns: { b: HTMLButtonElement; kind: 'shape' | 'wing'; id: number }[] = [];
    const mkItem = (kind: 'shape' | 'wing', id: number, name: string, thumb: string): void => {
      const b = h('button', 'item-btn');
      const img = document.createElement('img');
      img.src = thumb;
      img.alt = name;
      b.append(img, h('span', 'item-name', name));
      b.onclick = () => ctx.state.update(kind === 'shape'
        ? { buildKind: 'shape', activeShape: id as ShapeId }
        : { buildKind: 'wing', activeWingKind: id });
      itemBtns.push({ b, kind, id });
      grid.append(b);
    };
    const shapeColor = ctx.materials.get(compSlot(8)).color;
    const wingColor = ctx.materials.get('wing').color;
    for (const s of SHAPE_IDS)
      mkItem('shape', s, SHAPE_NAMES[s], renderThumbnail({ kind: 'cube', shape: s, color: shapeColor }));
    for (const k of WING_KINDS)
      mkItem('wing', k, WING_NAMES[k], renderThumbnail({ kind: 'wing', wingKind: k, color: wingColor }));
    itemSection.append(grid);
    p.append(itemSection);

    const orientSection = h('section', 'panel-section');
    orientSection.append(h('h3', undefined, 'orientation'));
    const stepper = h('div', 'orient-stepper');
    const prevBtn = button('◀', { title: 'Previous orientation (Shift+R)' });
    const orientVal = h('span', 'orient-val', String(ctx.state.activeOrient));
    const nextBtn = button('▶', { title: 'Next orientation (R)' });
    prevBtn.onclick = () => ctx.state.update({ activeOrient: (ctx.state.activeOrient + 23) % 24 });
    nextBtn.onclick = () => ctx.state.update({ activeOrient: (ctx.state.activeOrient + 1) % 24 });
    stepper.append(prevBtn, orientVal, nextBtn);
    orientSection.append(stepper);
    orientOps(ctx, orientSection);
    p.append(orientSection);

    const compSection = h('section', 'panel-section');
    compSection.append(h('h3', undefined, 'system'));
    refreshers.push(systemPalette(ctx, compSection, false));
    p.append(compSection);

    p.append(legend([toolDef('build').hint, GLOBAL_KEYS]));
    refreshers.push(() => {
      orientVal.textContent = String(ctx.state.activeOrient);
      for (const { b, kind, id } of itemBtns)
        b.classList.toggle('active', ctx.state.buildKind === kind
          && (kind === 'shape' ? ctx.state.activeShape === id : ctx.state.activeWingKind === id));
    });
  }

  /* ── erase ── */
  {
    const p = page('erase');
    p.append(h('div', 'tool-hint', 'Click a block or wing to remove it. Symmetry removes the mirror twin too.'));
    p.append(legend([toolDef('erase').hint, GLOBAL_KEYS]));
  }

  /* ── systems ── */
  {
    const p = page('systems');
    const s = h('section', 'panel-section');
    s.append(h('h3', undefined, 'system'));
    refreshers.push(systemPalette(ctx, s, true));
    p.append(s);
    p.append(legend([toolDef('systems').hint, GLOBAL_KEYS]));
  }

  /* ── plate: visual mesh picker from the registry ── */
  {
    const p = page('plate');
    const plateBtns: { b: HTMLButtonElement; id: string | null }[] = [];
    const plateColor = '#9a8a68';
    const mkCard = (host: HTMLElement, id: string | null, name: string, thumb: string, title: string): void => {
      const b = h('button', 'item-btn');
      const img = document.createElement('img');
      img.src = thumb;
      img.alt = name;
      b.title = title;
      b.append(img, h('span', 'item-name', name));
      b.onclick = () => ctx.state.update({ activePlate: id });
      plateBtns.push({ b, id });
      host.append(b);
    };

    const quadSection = h('section', 'panel-section');
    quadSection.append(h('h3', undefined, 'quad faces'));
    const quadGrid = h('div', 'item-grid');
    mkCard(quadGrid, null, 'default',
      renderThumbnail({ kind: 'mesh', color: plateColor,
        sub: ctx.data.plates.defaultFor('quad')?.mesh.sub ?? [] }),
      'Face default (the flat panel)');
    for (const def of ctx.data.plates.byFaceType('quad'))
      mkCard(quadGrid, def.id, def.name,
        renderThumbnail({ kind: 'mesh', color: plateColor, sub: def.mesh.sub }),
        `${def.name} · ${def.tris} tris`);
    quadSection.append(quadGrid);
    p.append(quadSection);

    const otherSection = h('section', 'panel-section');
    otherSection.append(h('h3', undefined, 'other faces'));
    const otherGrid = h('div', 'item-grid');
    for (const t of ['tri', 'slope', 'diag', 'cut'] as const)
      for (const def of ctx.data.plates.byFaceType(t))
        mkCard(otherGrid, def.id, `${t} ${def.name}`,
          renderThumbnail({ kind: 'mesh', color: plateColor, sub: def.mesh.sub }),
          `${def.name} · ${def.tris} tris`);
    otherSection.append(otherGrid);
    p.append(otherSection);

    p.append(legend([toolDef('plate').hint, GLOBAL_KEYS]));
    refreshers.push(() => {
      for (const { b, id } of plateBtns)
        b.classList.toggle('active', ctx.state.activePlate === id);
    });
  }

  const refreshPage = (): void => {
    for (const [id, p] of pages) p.classList.toggle('active', ctx.state.tool === id);
  };
  const refreshAll = (): void => { refreshPage(); for (const fn of refreshers) fn(); };
  refreshAll();

  ctx.state.subscribe(() => refreshAll());
  ctx.model.subscribe(() => { for (const fn of refreshers) fn(); });

  return { preview };
}

export const toolTabLabel = (tool: Tool): string =>
  TOOL_DEFS.find(t => t.id === tool)!.name;
