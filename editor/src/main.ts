/* Integration: data → core model/history/materials → scene/view/viewports →
   controller → UI chrome. Everything reactive flows through EditorState,
   ShipModel and MaterialStore subscriptions. */

import { loadGameData } from './data/loader';
import { ShipModel } from './core/model';
import { History } from './core/history';
import { MaterialStore } from './core/materials';
import { exportShipJson, importShip, importShipJson } from './core/io';
import { validate } from './core/validation';
import type { ShipDoc } from './core/types';
import { EditorState } from './editor/state';
import { EditorController } from './editor/controller';
import { createScene } from './render/scene';
import { MaterialCache } from './render/materialCache';
import { ShipView } from './render/shipView';
import { Viewports } from './render/viewports';
import { ShapePreview } from './render/shapePreview';
import { exportGlb } from './render/exportGlb';
import { compSlot } from './core/materials';
import { buildUi } from './ui/ui';
import type { UiContext } from './ui/context';

const emptyDoc = (): ShipDoc => ({
  meta: { name: 'novyi-korabl', display: 'Новый корабль' },
  cubes: [],
  wings: [],
});

function download(name: string, data: BlobPart, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function init(): Promise<void> {
  const root = document.getElementById('app')!;
  const data = await loadGameData();

  const state = new EditorState();
  const model = new ShipModel(emptyDoc());
  const history = new History(model);
  const materials = new MaterialStore();

  /* forward references filled after the scene exists */
  let view: ShipView;
  let viewports: Viewports;
  let fitShadow: (b: { min: readonly number[]; max: readonly number[] }) => void;

  const loadDoc = (doc: ShipDoc): void => {
    model.load(doc);
    materials.load(doc.materials);
    history.clear();
    state.select([]);
    actions.fitView();
  };

  const actions: UiContext['actions'] = {
    newShip: () => loadDoc(emptyDoc()),
    loadFleetShip: (name) => {
      const entry = data.ships[name];
      if (entry) loadDoc(importShip(entry, name));
    },
    importJsonFile: (file) => {
      file.text()
        .then(t => loadDoc(importShipJson(JSON.parse(t), file.name.replace(/\.json$/i, ''))))
        .catch(e => refs.setStatus(`импорт: ${String(e)}`));
    },
    exportJson: () => {
      const doc: ShipDoc = { ...model.doc, materials: materials.diff() };
      download(`${model.doc.meta.name}.json`,
        JSON.stringify(exportShipJson(doc, data.slotDefaults), null, 1), 'application/json');
    },
    exportGlb: () => {
      exportGlb(sceneCtx.shipRoot, model.doc.meta.name)
        .catch(e => refs.setStatus(`GLB: ${String(e)}`));
    },
    fitView: () => {
      const b = view?.boundsOfDoc();
      if (b && viewports) { viewports.fit(b); fitShadow(b); }
    },
    validateNow: () => validate(model),
  };

  const ctx: UiContext = { state, history, materials, model, data, actions };
  const refs = buildUi(root, ctx);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  refs.stage.appendChild(canvas);

  const sceneCtx = createScene(canvas);
  fitShadow = b => sceneCtx.fitShadow(b as { min: [number, number, number]; max: [number, number, number] });
  viewports = new Viewports(refs.stage, sceneCtx.renderer);
  const cache = new MaterialCache(materials);
  view = new ShipView(sceneCtx, cache, data, uid => model.byUid(uid));
  view.setDoc(model.doc);
  view.setOptions(state.render);

  new EditorController({
    state, model, history, view, viewports, canvas, data,
    overlay: sceneCtx.overlayRoot,
    setStatus: refs.setStatus,
    fitView: actions.fitView,
  });

  /* active-piece preview in the Сборка tab */
  const piecePreview = new ShapePreview(refs.preview);
  const refreshPreview = (): void => {
    const wing = state.tool === 'wing';
    piecePreview.update({
      kind: wing ? 'wing' : 'cube',
      shape: state.activeShape,
      wingKind: state.activeWingKind,
      o: state.activeOrient,
      color: wing ? materials.get('wing').color : materials.get(compSlot(state.activeComp)).color,
    });
  };
  state.subscribe(keys => {
    if (keys.some(k => k === 'activeShape' || k === 'activeOrient'
        || k === 'activeComp' || k === 'activeWingKind' || k === 'tool'))
      refreshPreview();
  });
  materials.subscribe(() => refreshPreview());
  refreshPreview();

  /* coalesced rebuild — model edits and render-option changes both land here */
  let dirty = false;
  const scheduleRebuild = (): void => {
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(() => {
      dirty = false;
      view.rebuild();
      view.setSelection(state.selection);
    });
  };

  model.subscribe(kind => {
    if (kind === 'reset') view.setDoc(model.doc);
    if (kind !== 'meta' && kind !== 'materials') scheduleRebuild();
  });
  state.subscribe(keys => {
    if (keys.includes('render')) { view.setOptions(state.render); scheduleRebuild(); }
    if (keys.includes('selection')) view.setSelection(state.selection);
    if (keys.includes('layout')) viewports.layout = state.layout;
  });

  new ResizeObserver(() => viewports.onResize()).observe(refs.stage);
  viewports.onResize();

  let last = performance.now();
  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    viewports.update((now - last) / 1000);
    last = now;
    viewports.render(sceneCtx.scene);
  };
  requestAnimationFrame(tick);

  actions.loadFleetShip('m12-centurion');
}

init().catch(e => {
  const el = document.getElementById('app');
  if (el) el.textContent = `ошибка запуска: ${String(e)}`;
});
