/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { copyFileSync, cpSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
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
    write('wing-mesh.json', shapes.WING_MESH ?? []);
    /* decoded 2014 textures (decode_textures.py → recovered/textures) */
    const texSrc = resolve(root, '../recovered/textures');
    const texDst = resolve(root, 'public/textures');
    mkdirSync(texDst, { recursive: true });
    for (const f of readdirSync(texSrc))
      if (f.endsWith('.png')) copyFileSync(resolve(texSrc, f), resolve(texDst, f));
    /* enhanced PBR layers (normal/roughness maps, parallel recovery pipeline)
       override same-named diffuse .png files; absence is normal — that
       pipeline may not have run yet. */
    const pbrSrc = resolve(root, '../recovered/textures-pbr');
    if (existsSync(pbrSrc)) {
      for (const f of readdirSync(pbrSrc))
        if (f.endsWith('.png')) copyFileSync(resolve(pbrSrc, f), resolve(texDst, f));
      const manifest = resolve(pbrSrc, 'manifest.json');
      if (existsSync(manifest)) copyFileSync(manifest, resolve(texDst, 'manifest.json'));
    }
    /* curated PBR material library (materials.json + per-id texture folders);
       absence tolerated — the library then holds only the legacy wraps */
    const matSrc = resolve(root, '../materials');
    if (existsSync(matSrc))
      cpSync(matSrc, resolve(root, 'public/materials'), { recursive: true });
    /* IBL environment HDRIs (render/environment.ts registry); absence
       tolerated — the editor then falls back to the built-in room env */
    const envSrc = resolve(root, '../env');
    if (existsSync(envSrc))
      cpSync(envSrc, resolve(root, 'public/env'), { recursive: true });
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
    /* dist/editor (not dist/) so the wrangler asset dir ./dist mirrors the
       live URL space — Workers assets match the FULL request path, and the
       editor worker's route is rs.ioupg.com/editor* */
    outDir: 'dist/editor',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
