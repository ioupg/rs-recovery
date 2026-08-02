/* Integration: data → core model/history/materials → scene/view/viewports →
   controller → UI chrome. Everything reactive flows through EditorState,
   ShipModel and MaterialStore subscriptions. */

import { collectTextureNames, loadGameData } from './data/loader';
import { deleteDesign, getDesign, listDesigns, saveDesign } from './data/localDesigns';
import { loadLibraryOverlay, loadShippedLibrary, saveLibraryOverlay } from './data/libraryStore';
import { ShipModel } from './core/model';
import { History } from './core/history';
import { AssignmentStore, buildDefaultMaterials, MaterialStore } from './core/materials';
import { buildLibraryDefaults, legacyMaterials, MaterialLibrary } from './core/library';
import { exportShipJson, importShip, importShipJson } from './core/io';
import { validate } from './core/validation';
import type { ShipDoc } from './core/types';
import { EditorState } from './editor/state';
import { EditorController } from './editor/controller';
import { createScene } from './render/scene';
import { environmentTexture } from './render/environment';
import { MaterialCache } from './render/materialCache';
import { getManifest, initTextureMaps } from './render/textureCache';
import { ShipView } from './render/shipView';
import { ScreenAO } from './render/ssao';
import { Viewports } from './render/viewports';
import { ShapePreview } from './render/shapePreview';
import { ViewCube } from './render/viewCube';
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
  const [data, shipped] = await Promise.all([loadGameData(), loadShippedLibrary()]);
  await initTextureMaps();

  const state = new EditorState();
  const model = new ShipModel(emptyDoc());
  const history = new History(model);
  const materials = new MaterialStore(buildDefaultMaterials(data.systems.all()));
  const legacy = legacyMaterials(collectTextureNames(data), getManifest());
  const library = new MaterialLibrary(buildLibraryDefaults(legacy, shipped), legacy);
  library.applyOverlay(loadLibraryOverlay());
  /* persist tweaks debounced — a slider drag emits per frame, and diff() +
     localStorage serialization per frame is real jank on a large library */
  let overlaySavePending = false;
  let overlaySaveTimer: number | undefined;
  const flushOverlaySave = (): void => {
    if (!overlaySavePending) return;
    overlaySavePending = false;
    saveLibraryOverlay(library.diff());
  };
  library.subscribe(() => {
    overlaySavePending = true;
    clearTimeout(overlaySaveTimer);
    overlaySaveTimer = window.setTimeout(flushOverlaySave, 300);
  });
  window.addEventListener('pagehide', flushOverlaySave);
  const assignments = new AssignmentStore();

  /* forward references filled after the scene exists */
  let view: ShipView;
  let viewports: Viewports;
  let controller: EditorController;
  let fitShadow: (b: { min: readonly number[]; max: readonly number[] }) => void;

  const loadDoc = (doc: ShipDoc): void => {
    model.load(doc);
    materials.load(doc.materials);
    assignments.load(doc.assignments);
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
        .catch(e => refs.setStatus(`import failed: ${String(e)}`));
    },
    exportJson: () => {
      const doc: ShipDoc = { ...model.doc, materials: materials.diff(), assignments: assignments.diff() };
      download(`${model.doc.meta.name}.json`,
        JSON.stringify(exportShipJson(doc, data.slotDefaults), null, 1), 'application/json');
    },
    saveLocal: () => {
      const suggested = model.doc.meta.display || model.doc.meta.name;
      const name = prompt('Save design as:', suggested)?.trim();
      if (!name) return;
      const doc: ShipDoc = {
        ...model.doc,
        meta: { ...model.doc.meta, name, display: name },
        materials: materials.diff(),
        assignments: assignments.diff(),
      };
      const existed = getDesign(name) !== undefined;
      const ok = saveDesign({
        name, display: name,
        savedAt: new Date().toISOString(),
        cubes: model.doc.cubes.length,
        wings: model.doc.wings.length,
        data: exportShipJson(doc, data.slotDefaults),
      });
      refs.setStatus(ok
        ? `“${name}” ${existed ? 'overwritten in' : 'saved to'} browser storage`
        : 'save failed — browser storage unavailable or full');
      if (ok) model.setMeta({ name, display: name });
    },
    loadLocalDesign: (name) => {
      const d = getDesign(name);
      if (!d) { refs.setStatus(`no saved design “${name}”`); return; }
      try {
        loadDoc(importShipJson(d.data, name));
        refs.setStatus(`loaded “${name}” from browser storage`);
      } catch (e) {
        refs.setStatus(`load failed: ${String(e)}`);
      }
    },
    deleteLocalDesign: (name) => deleteDesign(name),
    listLocalDesigns: () => listDesigns(),
    exportGlb: () => {
      exportGlb(sceneCtx.shipRoot, model.doc.meta.name)
        .catch(e => refs.setStatus(`GLB export failed: ${String(e)}`));
    },
    fitView: () => {
      const b = view?.boundsOfDoc();
      if (b && viewports) { viewports.fit(b); fitShadow(b); }
    },
    validateNow: () => validate(model, data.systems),
    openLoadDialog: () => refs.openLoadDialog(),
    rotateActive: (axis, dir) => controller.rotateAxis(axis, dir),
    mirrorActive: axis => controller.mirrorAxis(axis),
    deleteSelection: () => controller.deleteSelection(),
    highlightTexture: name => cache.highlightTexture(name),
  };

  const ctx: UiContext = { state, history, materials, library, assignments, model, data, actions };
  const refs = buildUi(root, ctx);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  refs.stage.appendChild(canvas);

  const sceneCtx = createScene(canvas);
  fitShadow = b => sceneCtx.fitShadow(b as { min: [number, number, number]; max: [number, number, number] });
  viewports = new Viewports(refs.stage, sceneCtx.renderer);
  const ssao = new ScreenAO(sceneCtx.renderer);
  ssao.enabled = state.render.ao;
  const cache = new MaterialCache(materials, library, assignments,
    () => environmentTexture(sceneCtx.renderer));
  view = new ShipView(sceneCtx, cache, data, uid => model.byUid(uid));
  view.setDoc(model.doc);
  view.setOptions(state.render);

  controller = new EditorController({
    state, model, history, view, viewports, canvas, data,
    overlay: sceneCtx.overlayRoot,
    setStatus: refs.setStatus,
    fitView: actions.fitView,
  });

  const viewCube = new ViewCube(refs.stage, viewports, actions.fitView);

  /* active-piece preview in the Build page */
  const piecePreview = new ShapePreview(refs.preview);
  const refreshPreview = (): void => {
    const wing = state.buildKind === 'wing';
    piecePreview.update({
      kind: wing ? 'wing' : 'cube',
      shape: state.activeShape,
      wingKind: state.activeWingKind,
      o: state.activeOrient,
      color: wing ? materials.get('wing').color : materials.get(compSlot(state.activeComp)).color,
    });
  };
  state.subscribe(keys => {
    if (keys.some(k => k === 'activeShape' || k === 'activeOrient' || k === 'buildKind'
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
    if (keys.includes('render')) {
      view.setOptions(state.render);
      ssao.enabled = state.render.ao;
      scheduleRebuild();
    }
    if (keys.includes('selection')) view.setSelection(state.selection);
  });

  new ResizeObserver(() => viewports.onResize()).observe(refs.stage);
  viewports.onResize();

  let last = performance.now();
  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    viewports.update((now - last) / 1000);
    last = now;
    ssao.render(sceneCtx.scene, viewports.camera);
    viewports.render(sceneCtx.scene);
    viewCube.update();
  };
  requestAnimationFrame(tick);

  actions.loadFleetShip('m12-centurion');
}

init().catch(e => {
  const el = document.getElementById('app');
  if (el) el.textContent = `startup failed: ${String(e)}`;
});
