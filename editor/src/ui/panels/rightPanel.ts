/* Right panel shell: tab strip [<active tool> | Materials | Info]. The first
   tab is contextual — its label follows the active tool and switching tools
   activates it. */

import type { UiContext } from '../context';
import { h } from '../dom';
import { buildToolPanel, toolTabLabel } from './toolPanel';
import { buildMaterialsTab } from './materials';
import { buildInfoTab } from './info';

export function buildRightPanel(host: HTMLElement, ctx: UiContext): { preview: HTMLCanvasElement } {
  host.className = 'rightpanel';

  const tabsRow = h('div', 'tabs');
  const toolTab = h('button', undefined, toolTabLabel(ctx.state.tool));
  const matTab = h('button', undefined, 'Materials');
  const infoTab = h('button', undefined, 'Info');
  for (const b of [toolTab, matTab, infoTab]) b.type = 'button';
  tabsRow.append(toolTab, matTab, infoTab);
  host.append(tabsRow);

  const toolPanel = h('div', 'tabpanel');
  const materialsPanel = h('div', 'tabpanel');
  const infoPanel = h('div', 'tabpanel');
  host.append(toolPanel, materialsPanel, infoPanel);

  const tabs: [HTMLButtonElement, HTMLElement][] = [
    [toolTab, toolPanel], [matTab, materialsPanel], [infoTab, infoPanel],
  ];
  const activate = (which: HTMLButtonElement): void => {
    for (const [b, p] of tabs) {
      b.classList.toggle('active', b === which);
      p.classList.toggle('active', b === which);
    }
  };
  for (const [b] of tabs) b.onclick = () => activate(b);
  activate(toolTab);

  const { preview } = buildToolPanel(toolPanel, ctx);
  buildMaterialsTab(materialsPanel, ctx);
  buildInfoTab(infoPanel, ctx);

  ctx.state.subscribe(keys => {
    if (keys.includes('tool')) {
      toolTab.textContent = toolTabLabel(ctx.state.tool);
      activate(toolTab);
    }
  });

  return { preview };
}
