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

export default defineConfig({
  plugins: [svelte(), pdfjsAssets()],
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
