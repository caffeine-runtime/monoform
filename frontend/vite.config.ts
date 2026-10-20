import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import fs from 'node:fs';
import path from 'node:path';

// pdf.js needs CMaps, standard fonts, WASM image decoders and ICC profiles at
// runtime. They are copied into dist/pdfjs/ (served offline by the app) rather
// than bundled. The QuickJS scripting engine is left out: scripting is off.
const PDFJS = path.resolve(__dirname, 'node_modules/pdfjs-dist');
const PDFJS_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
const SKIP = /quickjs/i;

function pdfjsAssets(): Plugin {
  return {
    name: 'hia-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs/', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const file = path.join(PDFJS, rel);
        if (!file.startsWith(PDFJS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle(opts) {
      const out = path.join(opts.dir ?? 'dist', 'pdfjs');
      for (const d of PDFJS_DIRS) {
        const src = path.join(PDFJS, d);
        for (const f of fs.readdirSync(src)) {
          if (SKIP.test(f)) continue;
          fs.mkdirSync(path.join(out, d), { recursive: true });
          fs.copyFileSync(path.join(src, f), path.join(out, d, f));
        }
      }
    },
  };
}

// three.js decoders for compressed glTF (Draco geometry, KTX2/Basis
// textures), copied into dist/three/ and loaded by the 3D viewer on demand.
const THREE_LIBS = path.resolve(__dirname, 'node_modules/three/examples/jsm/libs');
const THREE_FILES: [string, string][] = [
  ['draco/gltf/draco_decoder.wasm', 'draco/draco_decoder.wasm'],
  ['draco/gltf/draco_wasm_wrapper.js', 'draco/draco_wasm_wrapper.js'],
];

function threeAssets(): Plugin {
  return {
    name: 'hia-three-assets',
    configureServer(server) {
      server.middlewares.use('/three/', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const hit = THREE_FILES.find(([, to]) => to === rel);
        if (!hit) return next();
        fs.createReadStream(path.join(THREE_LIBS, hit[0])).pipe(res);
      });
    },
    writeBundle(opts) {
      const out = path.join(opts.dir ?? 'dist', 'three');
      for (const [from, to] of THREE_FILES) {
        fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
        fs.copyFileSync(path.join(THREE_LIBS, from), path.join(out, to));
      }
    },
  };
}

// Tesseract (text recognition): its worker, the SIMD LSTM-only WASM core and
// the English model, copied into dist/tesseract/ (fixed names: the worker
// loads them by URL). More languages can be added by the user (Go serves them).
const TESS: [string, string][] = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tessdata/eng.traineddata.gz'],
];

function tesseractAssets(): Plugin {
  const nm = path.resolve(__dirname, 'node_modules');
  return {
    name: 'hia-tesseract-assets',
    configureServer(server) {
      server.middlewares.use('/tesseract/', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
        const hit = TESS.find(([, to]) => to === rel);
        if (!hit) return next();
        fs.createReadStream(path.join(nm, hit[0])).pipe(res);
      });
    },
    writeBundle(opts) {
      const out = path.join(opts.dir ?? 'dist', 'tesseract');
      for (const [from, to] of TESS) {
        fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
        fs.copyFileSync(path.join(nm, from), path.join(out, to));
      }
    },
  };
}

export default defineConfig({
  plugins: [svelte(), pdfjsAssets(), threeAssets(), tesseractAssets()],
  build: {
    // WebView2 (Chromium), WKWebView (Safari 16+) and WebKitGTK 2.40+ all
    // support ES2022.
    target: 'es2022',
    // Inline nothing large into the entry chunk; every module is a dynamic import.
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 4096,
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
  },
  worker: { format: 'es' },
  server: { strictPort: false },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
