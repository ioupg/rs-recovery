/* Inline SVG tool icons — stroke-based, currentColor, so they inherit the
   button's dim/hover/active states. 16×16 viewBox, drawn for this app. */

import type { Tool } from '../editor/state';

const svg = (body: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" `
  + `stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${body}</svg>`;

export const TOOL_ICONS: Record<Tool, string> = {
  /* pointer arrow */
  select: svg('<path d="M4 2 L12.5 8.2 L8.6 9 L10.8 13.6 L8.9 14.5 L6.7 9.9 L4 12 Z" fill="currentColor" stroke="none"/>'),
  /* isometric block with top face */
  build: svg('<path d="M8 2 L14 5 V11 L8 14 L2 11 V5 Z"/><path d="M2 5 L8 8 L14 5 M8 8 V14"/>'),
  /* eraser over a baseline */
  erase: svg('<path d="M9.2 3 L13.6 7.4 L8 13 H5.2 L2.8 10.6 L9.2 3 Z"/><path d="M6.6 5.6 L11 10"/><path d="M10 14.5 H14"/>'),
  /* CPU chip — the systems view is the internals view */
  systems: svg('<rect x="4.5" y="4.5" width="7" height="7" rx="1"/><rect x="7" y="7" width="2" height="2"/>'
    + '<path d="M6 4.5 V2 M10 4.5 V2 M6 11.5 V14 M10 11.5 V14 M4.5 6 H2 M4.5 10 H2 M11.5 6 H14 M11.5 10 H14"/>'),
  /* face plate with rivets */
  plate: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="0.5"/><rect x="5" y="5" width="6" height="6"/>'
    + '<path d="M3.7 3.7 h0.01 M12.3 3.7 h0.01 M3.7 12.3 h0.01 M12.3 12.3 h0.01" stroke-width="1.8"/>'),
};
