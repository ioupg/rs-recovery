/* Exports a scene subtree to a downloaded .glb file.

   The ship geometry's vertex colour is a data channel, not a colour
   (geometry.ts: R = baked AO, G = tone, B = 1 — decoded by the ssao.ts
   shader patch). External viewers know nothing of that patch and would
   multiply the raw RGB into albedo as a red-green tint, so the export
   temporarily swaps in a grayscale bake-down (R x G in all channels — the
   legacy pre-split shading) and restores the live attribute afterwards. */

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export async function exportGlb(root: THREE.Object3D, name: string): Promise<void> {
  const swapped: { geo: THREE.BufferGeometry; live: THREE.BufferAttribute }[] = [];
  root.traverse(obj => {
    const geo = (obj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    const col = geo?.getAttribute('color');
    if (!geo || !col || col.itemSize !== 3) return;
    const flat = new Float32Array(col.count * 3);
    for (let i = 0; i < col.count; i++) {
      const shade = col.getX(i) * col.getY(i);
      flat[i * 3] = flat[i * 3 + 1] = flat[i * 3 + 2] = shade;
    }
    swapped.push({ geo, live: col as THREE.BufferAttribute });
    geo.setAttribute('color', new THREE.BufferAttribute(flat, 3));
  });

  try {
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
  } finally {
    for (const s of swapped) s.geo.setAttribute('color', s.live);
  }
}
