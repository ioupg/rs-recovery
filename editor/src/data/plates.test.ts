import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameData } from './loader';
import { buildPlateRegistry } from './plates';

function consts(file: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of readFileSync(new URL(file, import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^const (\w+) = (.*);\s*$/);
    if (m) out[m[1]] = JSON.parse(m[2]);
  }
  return out;
}

const plateMesh = consts('../../../viewer/shapes.js').PLATE_MESH as GameData['plateMesh'];

describe('PlateRegistry', () => {
  const reg = buildPlateRegistry(plateMesh);

  it('seeds every archive plate mesh', () => {
    expect(reg.byFaceType('quad').length).toBe(plateMesh.quad_all!.length);
    expect(reg.byFaceType('tri').length).toBeGreaterThan(0);
    for (const t of ['slope', 'diag', 'cut'] as const)
      expect(reg.byFaceType(t).length).toBe(1);
    expect(reg.all().every(d => d.source === 'archive' && d.mesh.sub.length > 0)).toBe(true);
  });

  it('the default quad is the 12-tri flat panel, not the hazard placeholder', () => {
    const d = reg.defaultFor('quad')!;
    expect(d.tris).toBe(12);
    expect(d.rid).toBe('1550655785');
    expect(d.name).toBe('flat panel');
  });

  it('ids are stable and resolvable', () => {
    for (const d of reg.all()) expect(reg.get(d.id)).toBe(d);
    expect(() => reg.register(reg.all()[0])).toThrow();
  });
});
