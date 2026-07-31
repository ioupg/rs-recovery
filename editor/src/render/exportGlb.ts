/* Exports a scene subtree to a downloaded .glb file. */

import type * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export async function exportGlb(root: THREE.Object3D, name: string): Promise<void> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(root, { binary: true });
  if (!(result instanceof ArrayBuffer)) throw new Error('GLTFExporter binary export did not return an ArrayBuffer');

  const blob = new Blob([result], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.glb`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
