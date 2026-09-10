import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(projectRoot, 'generated');
mkdirSync(out, { recursive: true });

const ortDist = dirname(require.resolve('onnxruntime-web'));
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  copyFileSync(join(ortDist, f), join(out, f));
}

// @scoriiu/fenshot deliberately does not export a Node entry point, so resolve
// its installed package directory directly rather than calling require.resolve().
const fenshotRoot = join(projectRoot, 'node_modules', '@scoriiu', 'fenshot');
copyFileSync(
  join(fenshotRoot, 'model', 'chess-tiles-v2.onnx'),
  join(out, 'chess-tiles-v2.onnx')
);

console.log('Fenshot model and ONNX runtime prepared.');