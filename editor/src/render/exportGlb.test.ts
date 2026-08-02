/* Regression for the GLB "vertex pollution" report (5,386 tris shown as
   403,950 vertices): GLTFExporter gives every per-group primitive the FULL
   shared attribute accessors, so viewers count groups × vertexCount. The
   export must instead slice each group to its own attributes (and weld the
   soup into indexed geometry while at it). */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildExportScene } from './exportGlb';

/** two-triangle quad soup on z=0 (welds 6 → 4) followed by two triangles of
    a second group sharing no vertices */
function makeGroupedMesh(): THREE.Mesh {
  const quad = [
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    0, 0, 0, 1, 1, 0, 0, 1, 0,
  ];
  const far = [
    5, 0, 0, 6, 0, 0, 6, 1, 0,
    7, 0, 0, 8, 0, 0, 8, 1, 0,
  ];
  const pos = new Float32Array([...quad, ...far]);
  const nrm = new Float32Array(12 * 3);
  for (let i = 0; i < 12; i++) nrm.set([0, 0, 1], i * 3);
  const col = new Float32Array(12 * 3);
  for (let i = 0; i < 12; i++) col.set([0.5, 0.8, 1], i * 3);  // R=AO G=tone B=1
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.addGroup(0, 6, 0);
  g.addGroup(6, 6, 1);
  const mats = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()];
  return new THREE.Mesh(g, mats);
}

describe('buildExportScene', () => {
  it('splits groups into meshes with tightly sliced, welded attributes', () => {
    const src = makeGroupedMesh();
    const root = new THREE.Group();
    root.add(src);
    const out = buildExportScene(root);
    const meshes = out.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
    expect(meshes.length).toBe(2);

    const [a, b] = meshes;
    // group 0: coplanar quad soup welds 6 vertices down to 4, still 2 tris
    expect(a.geometry.getAttribute('position').count).toBe(4);
    expect(a.geometry.index!.count).toBe(6);
    // group 1: nothing shared, 6 stay 6
    expect(b.geometry.getAttribute('position').count).toBe(6);
    expect(b.geometry.index!.count).toBe(6);
    // no primitive references the other group's vertices — the 25× pollution
    const total = meshes.reduce((s, m) => s + m.geometry.getAttribute('position').count, 0);
    expect(total).toBeLessThanOrEqual(12);

    // material routing follows the group table
    expect(a.material).toBe((src.material as THREE.Material[])[0]);
    expect(b.material).toBe((src.material as THREE.Material[])[1]);
  });

  it('bakes the AO/tone data channels to grayscale R×G on the copies only', () => {
    const src = makeGroupedMesh();
    const root = new THREE.Group();
    root.add(src);
    const out = buildExportScene(root);
    const mesh = out.children[0] as THREE.Mesh;
    const col = mesh.geometry.getAttribute('color');
    for (let i = 0; i < col.count; i++) {
      expect(col.getX(i)).toBeCloseTo(0.4);          // 0.5 × 0.8
      expect(col.getY(i)).toBeCloseTo(0.4);
      expect(col.getZ(i)).toBeCloseTo(0.4);
    }
    // the live attribute is untouched
    const live = (src.geometry as THREE.BufferGeometry).getAttribute('color');
    expect(live.getX(0)).toBeCloseTo(0.5);
    expect(live.getY(0)).toBeCloseTo(0.8);
    expect(live.getZ(0)).toBeCloseTo(1);
  });

  it('skips invisible objects, passes lines through, keeps world transforms', () => {
    const root = new THREE.Group();
    const hidden = makeGroupedMesh();
    hidden.visible = false;
    root.add(hidden);
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        'position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1]), 3)),
      new THREE.LineBasicMaterial());
    root.add(lines);
    const moved = makeGroupedMesh();
    moved.position.set(3, 0, 0);
    root.add(moved);

    const out = buildExportScene(root);
    expect(out.children.some(o => o instanceof THREE.LineSegments)).toBe(true);
    const meshes = out.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
    expect(meshes.length).toBe(2);                   // only the visible mesh's groups
    for (const m of meshes) expect(m.position.x).toBe(3);
  });
});
