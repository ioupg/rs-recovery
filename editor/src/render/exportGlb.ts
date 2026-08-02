/* Exports a scene subtree to a downloaded .glb file.

   The live ship is ONE non-indexed soup with a material-group table. Fed
   straight to GLTFExporter that becomes G primitives which all reference the
   full-size shared attribute accessors (only the forced index is sliced per
   group) — external viewers then report G × vertexCount vertices (the
   403,950-for-5,386-tris pollution). The export therefore rebuilds a scene
   copy first: every group becomes its own mesh with attributes sliced to its
   exact range and welded into indexed geometry (the soup carries 3 vertices
   per triangle; flat-shaded neighbours weld wherever all attributes agree).

   The ship's vertex colour is a data channel, not a colour (geometry.ts:
   R = baked AO, G = tone, B = 1 — decoded by the ssao.ts shader patch).
   External viewers know nothing of that patch and would multiply the raw RGB
   into albedo as a red-green tint, so the rebuild bakes a grayscale R×G into
   the copies (the legacy pre-split shading); the live scene is never touched. */

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** slice [start, start+count) vertices out of a plain (non-interleaved,
    non-indexed) attribute */
function sliceAttr(a: THREE.BufferAttribute, start: number, count: number): THREE.BufferAttribute {
  const arr = (a.array as Float32Array).slice(start * a.itemSize, (start + count) * a.itemSize);
  return new THREE.BufferAttribute(arr, a.itemSize, a.normalized);
}

/** grayscale bake of the AO/tone data channels: every channel becomes R×G */
function bakeColorChannel(g: THREE.BufferGeometry): void {
  const col = g.getAttribute('color');
  if (!col || col.itemSize !== 3) return;
  for (let i = 0; i < col.count; i++) {
    const shade = col.getX(i) * col.getY(i);
    col.setXYZ(i, shade, shade, shade);
  }
}

/** Export-ready copy of a subtree: grouped multi-material meshes split into
    per-group meshes with tightly sliced, welded, colour-baked geometry;
    everything else (lines, single-material meshes) copied with the same
    bake+weld treatment where it applies. World transforms are preserved. */
export function buildExportScene(root: THREE.Object3D): THREE.Group {
  const out = new THREE.Group();
  root.updateWorldMatrix(true, true);

  const place = (src: THREE.Object3D, obj: THREE.Object3D): void => {
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(src.matrixWorld);
    obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
    out.add(obj);
  };

  root.traverse(obj => {
    if (!obj.visible) return;
    if (obj instanceof THREE.LineSegments) {
      place(obj, new THREE.LineSegments(obj.geometry, obj.material));
      return;
    }
    if (!(obj instanceof THREE.Mesh)) return;
    const geo = obj.geometry as THREE.BufferGeometry;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const groups = geo.groups.length && Array.isArray(obj.material)
      ? geo.groups
      : [{ start: 0, count: geo.getAttribute('position').count, materialIndex: 0 }];
    groups.forEach((grp, gi) => {
      const g = new THREE.BufferGeometry();
      for (const name of Object.keys(geo.attributes)) {
        const a = geo.getAttribute(name);
        if (a instanceof THREE.BufferAttribute)              // interleaved: not ours
          g.setAttribute(name, sliceAttr(a, grp.start, grp.count));
      }
      bakeColorChannel(g);
      const welded = mergeVertices(g);
      g.dispose();
      const mesh = new THREE.Mesh(welded, mats[grp.materialIndex ?? 0] ?? mats[0]);
      mesh.name = obj.name ? `${obj.name}_${gi}` : '';
      place(obj, mesh);
    });
  });
  return out;
}

export async function exportGlb(root: THREE.Object3D, name: string): Promise<void> {
  const scene = buildExportScene(root);
  try {
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(scene, { binary: true });
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
    /* the export copies own their geometries; the live scene shares nothing */
    scene.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}
