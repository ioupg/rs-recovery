/* Base three.js scene: renderer, environment, lights, grid + floor. Ship
   visuals and overlays mount into shipRoot / overlayRoot (owned by
   shipView.ts); everything else here is fixed scene furniture. Port of the
   reference viewer's scene setup (../viewer/index.html:472-509) minus fog
   and the space-mode extras, which the editor doesn't use. */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  // no fog — editor wants a flat, legible background at any zoom

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envSource = new RoomEnvironment();
  const envMap = pmrem.fromScene(envSource, 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.35;
  envSource.dispose();
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(0x9fb6c9, 0x2a3542, 0.9);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff2dc, 1.15);
  key.position.set(6, 10, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);
  scene.add(key.target);

  const rim = new THREE.DirectionalLight(0x4a90d9, 0.45);
  rim.position.set(-8, -4, -6);
  scene.add(rim);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ color: 0x10171f, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(40, 40, 0x2a3948, 0x1a2430);
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
    floor.geometry.dispose();
    (floor.material as THREE.Material).dispose();
    grid.geometry.dispose();
    (grid.material as THREE.Material).dispose();
    envMap.dispose();
    renderer.dispose();
  }

  return { renderer, scene, shipRoot, overlayRoot, grid, floor, fitShadow, dispose };
}
