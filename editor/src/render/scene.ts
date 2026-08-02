/* Base three.js scene: renderer, environment, lights, grid + floor. Ship
   visuals and overlays mount into shipRoot / overlayRoot (owned by
   shipView.ts); everything else here is fixed scene furniture. Port of the
   reference viewer's scene setup (../viewer/index.html:472-509) minus fog
   and the space-mode extras, which the editor doesn't use. */

import * as THREE from 'three';
import { applyEnvironment, subscribeEnvironment } from './environment';
import { TONE_CURVES, getTuning, subscribeTuning } from './renderTuning';
import { requestFrame } from './invalidate';
import type { Vec3 } from '../core/types';

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  shipRoot: THREE.Group;
  overlayRoot: THREE.Group;
  grid: THREE.GridHelper;
  floor: THREE.Mesh;
  /** fit key light + shadow frustum to a world-space bounds, viewer finishShip 1106-1113 */
  fitShadow(bounds: { min: Vec3; max: Vec3 }): void;
  dispose(): void;
}

export function createScene(canvas: HTMLCanvasElement): SceneCtx {
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  /* r185 deprecated PCFSoftShadowMap (it silently falls back to PCF, which
     honours shadow.radius) — ask for PCF directly */
  renderer.shadowMap.type = THREE.PCFShadowMap;
  /* lights are world-fixed, so the shadow map depends only on geometry and
     the key light frustum — re-rendered on rebuild/fitShadow, not per frame */
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  // no fog — editor wants a flat, legible background at any zoom

  applyEnvironment(renderer, scene);
  /* rendering is on-demand — an env swap (or its async HDR landing) must
     arm a frame itself */
  const unsubEnv = subscribeEnvironment(() => {
    applyEnvironment(renderer, scene);
    requestFrame();
  });

  /* Rig rebalanced for shadow legibility (notes/09-render-path.md §3.3-3.4):
     the IBL is the ambient — hemi is only a faint colour wash on dielectrics
     (it contributes no specular, so metals never see it), and the key must
     dominate the unshadowed fill or the shadow term drowns. Colours and
     intensities are dials (renderTuning.ts, the Render tab) — applyTuning
     below stamps them over these construction placeholders; only the hemi
     ground colour is fixed. */
  const hemi = new THREE.HemisphereLight(0xffffff, 0x2a3542, 1);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.position.set(6, 10, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);
  scene.add(key.target);

  /* unshadowed, so kept faint by default — any more and it reads as specular
     leaking into occluded areas (it has no shadow map to stop it) */
  const rim = new THREE.DirectionalLight(0xffffff, 1);
  rim.position.set(-8, -4, -6);
  scene.add(rim);

  /* Every look dial routes through the tuning store (Render tab). The default
     curve is Khronos PBR Neutral: compresses HDR highlights (IBL + summed
     lights used to clip at 1.0 and wash out shadow/AO contrast) while staying
     near-identity in the midtones — colour-true, unlike ACES/AgX.
     notes/09-render-path.md §3.1 */
  const applyTuning = (): void => {
    const t = getTuning();
    const tm = TONE_CURVES.find(c => c.id === t.toneCurve)!.tm;
    if (renderer.toneMapping !== tm) {
      renderer.toneMapping = tm;
      /* three bakes the curve into every program — a switch must recompile */
      scene.traverse(o => {
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!mat) return;
        for (const m of Array.isArray(mat) ? mat : [mat]) m.needsUpdate = true;
      });
    }
    renderer.toneMappingExposure = t.exposure;
    scene.environmentIntensity = t.envIntensity;
    (scene.background as THREE.Color).set(t.background);
    hemi.color.set(t.fillColor);
    hemi.intensity = t.fillIntensity;
    key.color.set(t.keyColor);
    key.intensity = t.keyIntensity;
    rim.color.set(t.rimColor);
    rim.intensity = t.rimIntensity;
    requestFrame();
  };
  applyTuning();
  const unsubTune = subscribeTuning(applyTuning);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ color: 0x10171f, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  /* the solid plane occludes the hull from below while editing — the thin grid
     alone carries the ground reference */
  floor.visible = false;
  scene.add(floor);

  const grid = new THREE.GridHelper(40, 40, 0x2a3948, 0x1a2430);
  (grid.material as THREE.Material).toneMapped = false;
  scene.add(grid);

  const shipRoot = new THREE.Group();
  scene.add(shipRoot);
  const overlayRoot = new THREE.Group();
  scene.add(overlayRoot);

  function fitShadow(bounds: { min: Vec3; max: Vec3 }): void {
    const sizeX = bounds.max[0] - bounds.min[0];
    const sizeY = bounds.max[1] - bounds.min[1];
    const sizeZ = bounds.max[2] - bounds.min[2];
    const cx = (bounds.min[0] + bounds.max[0]) / 2;
    const cy = (bounds.min[1] + bounds.max[1]) / 2;
    const cz = (bounds.min[2] + bounds.max[2]) / 2;
    const rad = Math.hypot(sizeX, sizeY, sizeZ) / 2 + 2;
    key.position.set(cx + rad * 0.7, cy + rad * 1.15, cz + rad * 0.45);
    key.target.position.set(cx, cy, cz);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -rad;
    sc.right = sc.top = rad;
    sc.near = 0.1;
    sc.far = rad * 3.2;
    sc.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
    requestFrame();
  }

  function dispose(): void {
    unsubEnv();
    unsubTune();
    floor.geometry.dispose();
    (floor.material as THREE.Material).dispose();
    grid.geometry.dispose();
    (grid.material as THREE.Material).dispose();
    // the environment texture is owned by the environment.ts cache
    renderer.dispose();
  }

  return { renderer, scene, shipRoot, overlayRoot, grid, floor, fitShadow, dispose };
}
