import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
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
