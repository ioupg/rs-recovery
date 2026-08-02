/* Base three.js scene: renderer, environment, lights, grid + floor. Ship
   visuals and overlays mount into shipRoot / overlayRoot (owned by
   shipView.ts); everything else here is fixed scene furniture. Port of the
   reference viewer's scene setup (../viewer/index.html:472-509) minus fog
   and the space-mode extras, which the editor doesn't use. */

import * as THREE from 'three';
import { VIEWPORT_ENV_INTENSITY, applyEnvironment, subscribeEnvironment } from './environment';
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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  /* Khronos PBR Neutral: compresses HDR highlights (IBL + summed lights used
     to clip at 1.0 and wash out shadow/AO contrast) while staying
     near-identity in the midtones — colour-true, unlike ACES/AgX.
     notes/09-render-path.md §3.1 */
  renderer.toneMapping = THREE.NeutralToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  // no fog — editor wants a flat, legible background at any zoom

  applyEnvironment(renderer, scene);
  scene.environmentIntensity = VIEWPORT_ENV_INTENSITY;
  /* the main loop renders every frame, so an env swap shows up by itself */
  const unsubEnv = subscribeEnvironment(() => applyEnvironment(renderer, scene));

  /* Rig rebalanced for shadow legibility (notes/09-render-path.md §3.3-3.4):
     the IBL is the ambient — hemi is only a faint colour wash on dielectrics
     (it contributes no specular, so metals never see it), and the key must
     dominate the unshadowed fill or the shadow term drowns. */
  const hemi = new THREE.HemisphereLight(0x9fb6c9, 0x2a3542, 0.3);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff2dc, 1.3);
  key.position.set(6, 10, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);
  scene.add(key.target);

  /* unshadowed, so kept faint — any more and it reads as specular leaking
     into occluded areas (it has no shadow map to stop it) */
  const rim = new THREE.DirectionalLight(0x4a90d9, 0.2);
  rim.position.set(-8, -4, -6);
  scene.add(rim);

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
  }

  function dispose(): void {
    unsubEnv();
    floor.geometry.dispose();
    (floor.material as THREE.Material).dispose();
    grid.geometry.dispose();
    (grid.material as THREE.Material).dispose();
    // the environment texture is owned by the environment.ts cache
    renderer.dispose();
  }

  return { renderer, scene, shipRoot, overlayRoot, grid, floor, fitShadow, dispose };
}
