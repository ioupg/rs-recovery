import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteDesign, getDesign, listDesigns, saveDesign, type SavedDesign } from './localDesigns';

/* minimal localStorage stub for the node test environment */
function stubStorage(backing: Map<string, string>): Storage {
  return {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => { backing.set(k, String(v)); },
    removeItem: (k: string) => { backing.delete(k); },
    clear: () => backing.clear(),
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() { return backing.size; },
  } as Storage;
}

const design = (name: string, savedAt: string): SavedDesign => ({
  name, display: name, savedAt, cubes: 3, wings: 1,
  data: { cubes: [{ o: 0, x: 0, y: 0, z: 0, shape: 0, comp: 8 }], elements: [] },
});

describe('localDesigns', () => {
  const backing = new Map<string, string>();

  beforeEach(() => {
    backing.clear();
    (globalThis as { localStorage?: Storage }).localStorage = stubStorage(backing);
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('saves, lists newest-first, loads and deletes', () => {
    expect(listDesigns()).toEqual([]);
    expect(saveDesign(design('alpha', '2026-07-31T10:00:00Z'))).toBe(true);
    expect(saveDesign(design('beta', '2026-07-31T12:00:00Z'))).toBe(true);
    expect(listDesigns().map(d => d.name)).toEqual(['beta', 'alpha']);
    expect(getDesign('alpha')?.cubes).toBe(3);
    deleteDesign('alpha');
    expect(getDesign('alpha')).toBeUndefined();
    expect(listDesigns().map(d => d.name)).toEqual(['beta']);
  });

  it('overwrites an existing name and round-trips the payload verbatim', () => {
    saveDesign(design('alpha', '2026-07-31T10:00:00Z'));
    const v2 = design('alpha', '2026-07-31T13:00:00Z');
    saveDesign(v2);
    expect(listDesigns().length).toBe(1);
    expect(getDesign('alpha')).toEqual(v2);
  });

  it('survives corrupted storage and missing localStorage', () => {
    backing.set('rs.editor.designs.v1', '{not json');
    expect(listDesigns()).toEqual([]);
    expect(saveDesign(design('alpha', '2026-07-31T10:00:00Z'))).toBe(true);
    expect(getDesign('alpha')).toBeDefined();

    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(listDesigns()).toEqual([]);
    expect(saveDesign(design('x', '2026-07-31T10:00:00Z'))).toBe(false);
    expect(() => deleteDesign('x')).not.toThrow();
  });

  it('reports quota failures as false', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      ...stubStorage(backing),
      setItem: () => { throw new DOMException('quota'); },
    } as Storage;
    expect(saveDesign(design('big', '2026-07-31T10:00:00Z'))).toBe(false);
  });
});
