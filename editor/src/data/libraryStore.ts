/* Library persistence: the shipped materials/materials.json (curated, copied
   into public/ by the vite plugin) and the browser-local tweak overlay.
   Same tolerance stance as the texture manifest — a missing or unreadable
   file is the normal "nothing curated yet" state, not an error. */

import type { LibMaterialSpec, LibraryOverlay } from '../core/library';

const OVERLAY_KEY = 'rs.editor.library.v1';

/** curated defs from public/materials/materials.json ({ materials: [...] }) */
export async function loadShippedLibrary(): Promise<LibMaterialSpec[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}materials/materials.json`);
    if (!res.ok) return [];
    const json = await res.json() as { materials?: LibMaterialSpec[] };
    return (json.materials ?? []).filter(m => typeof m?.id === 'string');
  } catch {
    return [];
  }
}

export function loadLibraryOverlay(): LibraryOverlay | undefined {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    return raw ? JSON.parse(raw) as LibraryOverlay : undefined;
  } catch {
    return undefined;
  }
}

/** persist the diff-vs-shipped; undefined clears the entry */
export function saveLibraryOverlay(overlay: LibraryOverlay | undefined): void {
  try {
    if (overlay) localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
    else localStorage.removeItem(OVERLAY_KEY);
  } catch {
    /* quota/corruption tolerated, same stance as localDesigns */
  }
}
