/* Bottom status bar: transient status text (left), live block/wing counts and
   the hotkey hint line (right). */

import type { UiContext } from '../context';
import { h } from '../dom';

const HINT = '1–5 tools · 7–0 view · X/C/V rotate (Alt mirror, Shift reverse) · R orient · M symmetry · MMB/Alt+LMB orbit · RMB pan';

export function buildStatusBar(host: HTMLElement, ctx: UiContext): { setStatus(text: string): void } {
  host.className = 'statusbar';

  const left = h('span', 'status-left');
  const counts = h('span', 'status-counts');
  const hint = h('span', 'status-hint', HINT);
  host.append(left, h('span', 'spacer'), counts, hint);

  const refreshCounts = (): void => {
    counts.textContent = `${ctx.model.doc.cubes.length} blocks · ${ctx.model.doc.wings.length} wings`;
  };
  refreshCounts();
  ctx.model.subscribe(refreshCounts);

  return {
    setStatus(text: string): void { left.textContent = text; },
  };
}
