/* Browser-local design library: named saves in localStorage, surviving
   sessions. The payload is exactly the exported ship JSON (materials,
   surfaces, plateKinds, extras included), so save/load round-trips through
   the same io path as file export/import. */

export interface SavedDesign {
  name: string;
  display: string;
  savedAt: string;          // ISO
  cubes: number;
  wings: number;
  data: unknown;            // exportShipJson payload
}

const KEY = 'rs.editor.designs.v1';

type Store = Record<string, SavedDesign>;

function read(): Store {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return parsed && typeof parsed === 'object' ? parsed as Store : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  localStorage.setItem(KEY, JSON.stringify(store));
}

/** newest first */
export function listDesigns(): SavedDesign[] {
  return Object.values(read())
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function getDesign(name: string): SavedDesign | undefined {
  return read()[name];
}

/** returns false when storage is unavailable or the quota is exceeded */
export function saveDesign(d: SavedDesign): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const store = read();
    store[d.name] = d;
    write(store);
    return true;
  } catch {
    return false;
  }
}

export function deleteDesign(name: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const store = read();
    if (name in store) {
      delete store[name];
      write(store);
    }
  } catch { /* nothing to lose */ }
}
