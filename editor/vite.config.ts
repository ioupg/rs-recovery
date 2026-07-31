/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/* The recovery pipeline (parse_rsconstruction.py, decode_meshes.py) emits the
   viewer's data as `const NAME = <json>;` script files. This plugin converts the
   bulky regenerated payloads into JSON under public/data/ so the editor consumes
   the same single source of truth without touching the viewer. Reruns on every
   dev start / build, so a pipeline rerun is picked up automatically. */
function extractConsts(file: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^const (\w+) = (.*);\s*$/);
    if (m) out[m[1]] = JSON.parse(m[2]);
  }
  return out;
}

function rsDataPlugin(): Plugin {
  const generate = () => {
    const dir = resolve(root, 'public/data');
    mkdirSync(dir, { recursive: true });
    const ships = extractConsts(resolve(root, '../viewer/ships.js'));
    const shapes = extractConsts(resolve(root, '../viewer/shapes.js'));
    const write = (name: string, data: unknown) =>
      writeFileSync(resolve(dir, name), JSON.stringify(data));
    write('ships.json', ships.SHIPS);
    write('shape-mesh.json', shapes.SHAPE_MESH);
    write('plate-mesh.json', shapes.PLATE_MESH);
    write('module-mesh.json', shapes.MODULE_MESH);
  };
  return {
    name: 'rs-data',
    buildStart() { generate(); },
    configureServer() { generate(); },
  };
}

export default defineConfig({
  base: '/editor/',
  plugins: [rsDataPlugin()],
  build: {
    outDir: '../viewer/editor',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
