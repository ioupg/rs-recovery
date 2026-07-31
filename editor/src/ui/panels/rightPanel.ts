/* Right panel shell: tab strip [Сборка | Материалы | Инфо] over the three
   per-tab builders. */

import type { UiContext } from '../context';
import { h } from '../dom';
import { buildBuildTab } from './build';
import { buildMaterialsTab } from './materials';
import { buildInfoTab } from './info';

const TABS = [
  { id: 'build', label: 'Сборка' },
  { id: 'materials', label: 'Материалы' },
  { id: 'info', label: 'Инфо' },
] as const;

export function buildRightPanel(host: HTMLElement, ctx: UiContext): { preview: HTMLCanvasElement } {
  host.className = 'rightpanel';

  const tabsRow = h('div', 'tabs');
  const tabBtns = new Map<string, HTMLButtonElement>();
  for (const t of TABS) {
    const b = h('button', undefined, t.label);
    b.type = 'button';
    tabBtns.set(t.id, b);
    tabsRow.append(b);
  }
  host.append(tabsRow);

  const buildPanel = h('div', 'tabpanel');
  const materialsPanel = h('div', 'tabpanel');
  const infoPanel = h('div', 'tabpanel');
  const panels = new Map<string, HTMLElement>([
    ['build', buildPanel], ['materials', materialsPanel], ['info', infoPanel],
  ]);
  host.append(buildPanel, materialsPanel, infoPanel);

  const activate = (id: string): void => {
    for (const [pid, p] of panels) p.classList.toggle('active', pid === id);
    for (const [pid, b] of tabBtns) b.classList.toggle('active', pid === id);
  };
  for (const t of TABS) tabBtns.get(t.id)!.onclick = () => activate(t.id);
  activate('build');

  const { preview } = buildBuildTab(buildPanel, ctx);
  buildMaterialsTab(materialsPanel, ctx);
  buildInfoTab(infoPanel, ctx);
  return { preview };
}
