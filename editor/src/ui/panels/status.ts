/* Bottom status bar: transient status text (left), live block/wing counts and
   the hotkey hint line (right). */

import type { UiContext } from '../context';
import { h } from '../dom';

const HINT = '1-5 инструменты · X/Y/Z поворот (Shift обратно) · M симметрия · Tab виды · Del удалить · Ctrl+Z/Y';

export function buildStatusBar(host: HTMLElement, ctx: UiContext): { setStatus(text: string): void } {
  host.className = 'statusbar';

  const left = h('span', 'status-left');
  const counts = h('span', 'status-counts');
  const hint = h('span', 'status-hint', HINT);
  host.append(left, h('span', 'spacer'), counts, hint);

  const refreshCounts = (): void => {
    counts.textContent = `${ctx.model.doc.cubes.length} блоков · ${ctx.model.doc.wings.length} крыльев`;
  };
  refreshCounts();
  ctx.model.subscribe(refreshCounts);

  return {
    setStatus(text: string): void { left.textContent = text; },
  };
}
