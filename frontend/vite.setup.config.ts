// The setup program's UI (cmd/setup): a separate small bundle in the app's look.
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '../cmd/setup/frontend/dist');

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'setup'),
  base: './',
  // Go embeds the folder, so it keeps a placeholder for builds without the UI.
  plugins: [svelte(), { name: 'keep', writeBundle: () => fs.writeFileSync(path.join(OUT, '.gitkeep'), '') }],
  build: {
    outDir: OUT,
    emptyOutDir: true,
    target: 'es2022',
    reportCompressedSize: false,
  },
});
