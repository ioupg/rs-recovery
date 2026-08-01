/* Material library browser — modal card grid + orbitable preview + tweak
   sliders over the SELECTED library material, opened from the "Materials"
   assignment rows (panels/materials.ts) to reassign a texture, or standalone
   to just browse/tune the library. Built fresh per call (no persistent
   instance to own) and torn down on close, unlike the load-template modal
   which is built once at startup and only hidden. */

import type { UiContext } from './context';
import type { LibMaterial } from '../core/types';
import { acquireMaterialPreview, renderMaterialThumb } from '../render/shapePreview';
import { subscribeTextureLoads } from '../render/textureCache';
import { button, h } from './dom';

const shortName = (name: string): string => name.replace(/\.(bmp|png|jpg)$/i, '');

function slider(label: string, min: number, max: number, step: number):
    { row: HTMLLabelElement; input: HTMLInputElement; val: HTMLSpanElement } {
  const row = document.createElement('label');
  row.append(label);
  const input = document.createElement('input');
  input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
  const val = h('span', 'val');
  row.append(input, val);
  return { row, input, val };
}

/** one browser at a time — a second open (opener button still focused and
    re-fired by Space/Enter, say) must not stack another modal */
let browserOpen = false;

export function openMaterialBrowser(ctx: UiContext, opts: { assignFor?: string } = {}): void {
  if (browserOpen) return;
  const entries = ctx.library.all();
  if (!entries.length) return; // nothing curated yet — defensive, shouldn't happen
  browserOpen = true;

  let selectedId = opts.assignFor ? ctx.assignments.get(opts.assignFor) : entries[0].id;
  if (!ctx.library.byId(selectedId)) selectedId = entries[0].id;

  /* ── chrome (loadModal idiom) ── */
  const backdrop = h('div', 'modal-backdrop');
  const modal = h('div', 'modal matlib-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', 'Material library');
  modal.tabIndex = -1;   // else focus() is a no-op and the opener keeps focus

  const head = h('div', 'modal-head');
  const title = h('div', 'matlib-title');
  title.append(h('h2', undefined, 'Material library'));
  /* assign mode: show the target texture and what it currently wears */
  const subtitle = opts.assignFor ? h('span', 'matlib-subtitle') : null;
  if (subtitle) title.append(subtitle);
  head.append(title);
  const closeBtn = h('button', 'modal-close', '✕');
  closeBtn.type = 'button';
  closeBtn.title = 'Close (Esc)';
  head.append(closeBtn);
  modal.append(head);

  const body = h('div', 'modal-body matlib-body');

  /* ── left: card grid ── */
  const grid = h('div', 'matlib-grid');
  const cards = new Map<string, { btn: HTMLButtonElement; img: HTMLImageElement }>();
  for (const m of entries) {
    const card = h('button', 'item-btn matlib-card');
    card.type = 'button';
    card.title = m.name;
    const img = document.createElement('img');
    img.alt = m.name;
    img.src = renderMaterialThumb(m, 84);
    card.append(img, h('span', 'item-name', m.name));
    if (m.legacy) card.append(h('span', 'matlib-badge', 'archive'));
    card.onclick = () => selectCard(m.id);
    cards.set(m.id, { btn: card, img });
    grid.append(card);
  }
  body.append(grid);

  /* ── right: orbitable preview + tweaks ── */
  const right = h('div', 'matlib-right');

  const previewWrap = h('div', 'matlib-preview');
  /* session singleton (WebGL contexts are precious) — re-parent its canvas
     into this modal; closing detaches it, the context lives on */
  const preview = acquireMaterialPreview();
  const canvas = preview.canvas;
  canvas.className = 'matlib-canvas';
  const shapeToggle = h('div', 'seg matlib-shape');
  const sphereBtn = button('sphere');
  const cubeBtn = button('cube');
  shapeToggle.append(sphereBtn, cubeBtn);
  previewWrap.append(canvas, shapeToggle);
  right.append(previewWrap);
  const setShape = (s: 'sphere' | 'cube'): void => {
    preview.setShape(s);
    sphereBtn.classList.toggle('active', s === 'sphere');
    cubeBtn.classList.toggle('active', s === 'cube');
  };
  sphereBtn.onclick = () => setShape('sphere');
  cubeBtn.onclick = () => setShape('cube');

  const tweaks = h('div', 'mat-body matlib-tweaks');

  const colorRow = document.createElement('label');
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorRow.append('color', colorInput);
  tweaks.append(colorRow);

  const roughness = slider('roughness', 0, 1, 0.01);
  const metalness = slider('metalness', 0, 1, 0.01);
  const normalScale = slider('normal strength', 0, 2, 0.01);
  const envIntensity = slider('reflections', 0, 2, 0.01);
  tweaks.append(roughness.row, metalness.row, normalScale.row, envIntensity.row);

  const emissiveRow = document.createElement('label');
  const emissiveInput = document.createElement('input');
  emissiveInput.type = 'color';
  emissiveRow.append('emissive', emissiveInput);
  const emissiveIntensity = slider('emissive intensity', 0, 2, 0.01);
  tweaks.append(emissiveRow, emissiveIntensity.row);

  const clearcoat = slider('clearcoat', 0, 1, 0.01);
  const clearcoatRoughness = slider('clearcoat rough.', 0, 1, 0.01);
  tweaks.append(clearcoat.row, clearcoatRoughness.row);

  const uvScale = slider('UV scale', 0.1, 8, 0.05);
  const uvRotation = slider('UV rotation', 0, 360, 1);
  tweaks.append(uvScale.row, uvRotation.row);

  /* input texture set, read-only — which files feed this material */
  const mapsBlock = h('div', 'matlib-maps');
  tweaks.append(mapsBlock);

  right.append(tweaks);

  const actions = h('div', 'matlib-actions');
  const assignBtn = opts.assignFor ? button(`Apply to ${shortName(opts.assignFor)}`) : null;
  if (assignBtn) {
    assignBtn.classList.add('active');
    assignBtn.title = `assign the selected material to every face textured with ${shortName(opts.assignFor!)}`;
  }
  const resetBtn = button('Reset');
  const exportBtn = button('Export library');
  const closeActionBtn = button('Close');
  if (assignBtn) actions.append(assignBtn);
  actions.append(resetBtn, exportBtn, closeActionBtn);
  right.append(actions);

  body.append(right);
  modal.append(body);
  backdrop.append(modal);
  document.body.append(backdrop);

  /* ── wiring ── */
  const currentMat = (): LibMaterial => ctx.library.byId(selectedId) ?? entries[0];

  const basename = (url: string): string => url.split('/').pop() ?? url;

  const refreshMaps = (m: LibMaterial): void => {
    mapsBlock.textContent = '';
    const slots: [string, string | undefined][] = [
      ['albedo', m.maps.albedo], ['normal', m.maps.normal],
      ['orm', m.maps.orm], ['roughness', m.maps.orm ? undefined : m.maps.roughness],
      ['emissive', m.maps.emissive],
    ];
    const used = slots.filter((s): s is [string, string] => !!s[1]);
    mapsBlock.append(h('span', 'matlib-maps-head', 'input textures'));
    if (!used.length) {
      mapsBlock.append(h('span', 'matlib-map-row', 'none — scalar material'));
      return;
    }
    for (const [kind, url] of used) {
      const row = h('span', 'matlib-map-row');
      row.title = url;
      row.append(h('b', undefined, kind), ` ${basename(url)}`);
      mapsBlock.append(row);
    }
  };

  const refreshSubtitle = (): void => {
    if (!subtitle || !opts.assignFor) return;
    const cur = ctx.library.byId(ctx.assignments.get(opts.assignFor));
    subtitle.textContent = `for ${shortName(opts.assignFor)} · currently ${cur?.name ?? '—'}`;
  };
  refreshSubtitle();

  const refreshTweaks = (): void => {
    const m = currentMat();
    refreshMaps(m);
    colorInput.value = m.color;
    emissiveInput.value = m.emissive;
    const set = (s: { input: HTMLInputElement; val: HTMLSpanElement }, v: number, digits = 2): void => {
      s.input.value = String(v);
      s.val.textContent = v.toFixed(digits);
    };
    set(roughness, m.roughness);
    set(metalness, m.metalness);
    set(normalScale, m.normalScale);
    set(envIntensity, m.envIntensity);
    set(emissiveIntensity, m.emissiveIntensity);
    set(clearcoat, m.clearcoat);
    set(clearcoatRoughness, m.clearcoatRoughness);
    set(uvScale, m.uvScale);
    set(uvRotation, m.uvRotation, 0);
  };

  const refreshCardThumb = (id: string): void => {
    const c = cards.get(id);
    const m = ctx.library.byId(id);
    if (c && m) c.img.src = renderMaterialThumb(m);
  };

  /* thumb re-renders are a synchronous GPU render + readback each — coalesce
     them to one batch per frame so a slider drag or texture-load burst costs
     at most one render per dirty card per frame */
  const dirtyThumbs = new Set<string>();
  let thumbRaf = 0;
  const scheduleCardThumb = (id: string): void => {
    dirtyThumbs.add(id);
    thumbRaf ||= requestAnimationFrame(() => {
      thumbRaf = 0;
      for (const id of dirtyThumbs) refreshCardThumb(id);
      dirtyThumbs.clear();
    });
  };

  const usesUrl = (m: LibMaterial, url: string): boolean =>
    Object.values(m.maps).includes(url);

  const selectCard = (id: string): void => {
    selectedId = id;
    for (const [cid, c] of cards) c.btn.classList.toggle('active', cid === id);
    refreshTweaks();
    preview.update(currentMat());
  };

  const patch = (p: Partial<LibMaterial>): void => ctx.library.patch(selectedId, p);

  colorInput.oninput = () => patch({ color: colorInput.value });
  emissiveInput.oninput = () => patch({ emissive: emissiveInput.value });
  roughness.input.oninput = () => patch({ roughness: Number(roughness.input.value) });
  metalness.input.oninput = () => patch({ metalness: Number(metalness.input.value) });
  normalScale.input.oninput = () => patch({ normalScale: Number(normalScale.input.value) });
  envIntensity.input.oninput = () => patch({ envIntensity: Number(envIntensity.input.value) });
  emissiveIntensity.input.oninput = () => patch({ emissiveIntensity: Number(emissiveIntensity.input.value) });
  clearcoat.input.oninput = () => patch({ clearcoat: Number(clearcoat.input.value) });
  clearcoatRoughness.input.oninput = () => patch({ clearcoatRoughness: Number(clearcoatRoughness.input.value) });
  uvScale.input.oninput = () => patch({ uvScale: Number(uvScale.input.value) });
  uvRotation.input.oninput = () => patch({ uvRotation: Number(uvRotation.input.value) });

  /* library/texture-load changes (ours or external) keep preview, sliders and
     the affected card thumbs in sync */
  const unsubLib = ctx.library.subscribe(() => {
    refreshTweaks();
    preview.update(currentMat());
    scheduleCardThumb(selectedId);
  });
  const unsubTex = subscribeTextureLoads(url => {
    if (usesUrl(currentMat(), url)) preview.update(currentMat());
    for (const id of cards.keys()) {
      const m = ctx.library.byId(id);
      if (m && usesUrl(m, url)) scheduleCardThumb(id);
    }
  });

  resetBtn.onclick = () => ctx.library.reset(selectedId);
  exportBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ctx.library.exportJson()], { type: 'application/json' }));
    a.download = 'materials.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  if (assignBtn) assignBtn.onclick = () => {
    ctx.assignments.assign(opts.assignFor!, selectedId);
    refreshSubtitle();
    close();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
    /* the modal is the top layer: no keydown may reach the editor hotkeys
       behind it (Delete, tool keys, …). Native input behavior — typing,
       slider arrows, Enter-clicks-button — is a default action, not a
       listener, so it survives stopPropagation. */
    e.stopPropagation();
  };
  function close(): void {
    unsubLib();
    unsubTex();
    if (thumbRaf) cancelAnimationFrame(thumbRaf);
    window.removeEventListener('keydown', onKey, true);
    backdrop.remove();   // detaches the singleton preview canvas with it
    browserOpen = false;
  }

  closeBtn.onclick = close;
  closeActionBtn.onclick = close;
  backdrop.onclick = e => { if (e.target === backdrop) close(); };
  window.addEventListener('keydown', onKey, true);

  selectCard(selectedId);
  setShape('sphere');
  modal.focus();
}
