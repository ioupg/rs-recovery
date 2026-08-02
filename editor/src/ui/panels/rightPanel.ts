/* Right panel shell: tab strip [<active tool> | Materials | Render]. The
   first tab is contextual — its label follows the active tool and switching
   tools activates it. */

import type { UiContext } from '../context';
import { h } from '../dom';
import { buildToolPanel, toolTabLabel } from './toolPanel';
import { buildMaterialsTab } from './materials';
import { buildRenderTab } from './renderTab';

export function buildRightPanel(host: HTMLElement, ctx: UiContext): { preview: HTMLCanvasElement } {
  host.className = 'rightpanel';

  const tabsRow = h('div', 'tabs');
  const toolTab = h('button', undefined, toolTabLabel(ctx.state.tool));
  const matTab = h('button', undefined, 'Materials');
  const renderTab = h('button', undefined, 'Render');
  for (const b of [toolTab, matTab, renderTab]) b.type = 'button';
  tabsRow.append(toolTab, matTab, renderTab);
  host.append(tabsRow);

  const toolPanel = h('div', 'tabpanel');
  const materialsPanel = h('div', 'tabpanel');
  const renderPanel = h('div', 'tabpanel');
  host.append(toolPanel, materialsPanel, renderPanel);

  const tabs: [HTMLButtonElement, HTMLElement][] = [
    [toolTab, toolPanel], [matTab, materialsPanel], [renderTab, renderPanel],
  ];

  /* Material assignments are only visible in the textured mesh view, so the
     Materials tab orchestrates the presentation the same way tools with
     needsMode do: entering switches to mesh+textures, leaving restores what
     the user had — unless they changed modes themselves meanwhile (then the
     remembered mode is stale and restoring would fight them). */
  let matAutoMode: { mode: typeof ctx.state.render.mode; textures: boolean } | null = null;
  let applyingAuto = false;
  const setRender = (mode: typeof ctx.state.render.mode, textures: boolean): void => {
    applyingAuto = true;
    ctx.state.update({ render: { ...ctx.state.render, mode, textures } });
    applyingAuto = false;
  };
  const enterMaterialsView = (): void => {
    const r = ctx.state.render;
    if (r.mode === 'mesh' && r.textures) return;
    matAutoMode = { mode: r.mode, textures: r.textures };
    setRender('mesh', true);
  };
  const leaveMaterialsView = (): void => {
    if (!matAutoMode) return;
    setRender(matAutoMode.mode, matAutoMode.textures);
    matAutoMode = null;
  };

  let active: HTMLButtonElement | null = null;
  const activate = (which: HTMLButtonElement): void => {
    if (which === active) return;
    if (active === matTab) leaveMaterialsView();
    active = which;
    for (const [b, p] of tabs) {
      b.classList.toggle('active', b === which);
      p.classList.toggle('active', b === which);
    }
    if (which === matTab) enterMaterialsView();
  };
  for (const [b] of tabs) b.onclick = () => activate(b);
  activate(toolTab);

  const { preview } = buildToolPanel(toolPanel, ctx);
  buildMaterialsTab(materialsPanel, ctx);
  buildRenderTab(renderPanel);

  ctx.state.subscribe(keys => {
    if (keys.includes('tool')) {
      toolTab.textContent = toolTabLabel(ctx.state.tool);
      activate(toolTab);
    }
    /* a render change we didn't make = the user took manual control */
    if (keys.includes('render') && !applyingAuto) matAutoMode = null;
  });

  return { preview };
}
