/* Placeholder entry — replaced by full integration once core/render/ui land. */
import { loadGameData } from './data/loader';

const app = document.getElementById('app')!;
app.textContent = 'загрузка…';
loadGameData().then(d => {
  app.textContent = `data ok: ${Object.keys(d.ships).length} ships, ` +
    `${d.plateMesh.quad_all.length} plate candidates`;
}).catch(e => { app.textContent = String(e); });
