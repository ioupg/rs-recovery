/* Entry point of the UI layer — builds the whole chrome around the 3D stage.
   See ARCHITECTURE.md § UI and src/ui/context.ts for the binding contract. */

import './style.css';
import type { BuildUi } from './context';
import { buildHeader } from './panels/header';
import { buildRail } from './panels/rail';
import { buildRightPanel } from './panels/rightPanel';
import { buildStatusBar } from './panels/status';

export const buildUi: BuildUi = (root, ctx) => {
  root.innerHTML = '';
  root.className = 'app';

  const header = document.createElement('header');
  const main = document.createElement('main');
  const rail = document.createElement('nav');
  const stage = document.createElement('div');
  stage.className = 'stage';
  const rightPanel = document.createElement('aside');
  const statusBar = document.createElement('div');

  main.append(rail, stage, rightPanel);
  root.append(header, main, statusBar);

  buildHeader(header, ctx);
  buildRail(rail, ctx);
  buildRightPanel(rightPanel, ctx);
  const { setStatus } = buildStatusBar(statusBar, ctx);

  return { stage, setStatus };
};
