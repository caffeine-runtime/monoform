# Decisions

Choices the brief didn't dictate, one line of reasoning each. Newest at the bottom of each section.

## Platform & build

- **Wails v2.17.0, Go 1.25** (`go.mod` says 1.25; the toolchain auto-downloads). Wails 2.17 itself requires Go ≥ 1.25.
- **Linux needs WebKitGTK 4.1 and the `webkit2_41` build tag.** Ubuntu 24.04+ / Debian 13 / Fedora 40+ only ship `libwebkit2gtk-4.1-dev`; Wails' default (no tag) links the old 4.0 API. `scripts/build.sh` adds the tag automatically when `pkg-config webkit2gtk-4.1` succeeds.
- **No cgo in our code.** Wails needs cgo on Linux/macOS for the webview itself; everything we add is pure Go.
- **TypeScript 6.x, not 7.x.** svelte-check 4.7 only supports TS ^5 || ^6; TS 7 (the native port) would break type checking.
- **Vite 8, Svelte 5.57, Vitest 5** — current stable at the time of writing.

## Architecture

- **File bytes travel over HTTP, not JSON bindings.** Wails bindings JSON-encode everything; a 50 MB log or a PDF would be base64'd through `ExecJS`. Instead the Wails asset server routes `/__hia/*` to `internal/server` (Range-capable `GET /__hia/file`, `POST /__hia/save` → atomic write). Bindings are used only for small calls.
- **Per-launch token on `/__hia/*`.** Content rendered from user files (markdown, SVG, PDFs) can't reach the file system through the data channel without it. Cheap defence in depth.
- **Content-Security-Policy in `index.html`** (`script-src 'self'`, no eval) for the same reason. pdf.js runs with `isEvalSupported: false`.
- **Module state stays mounted while a tab is open** (hidden with `display:none`), so undo history and scroll survive tab switches. A tab's module only loads when the tab is first shown, so restoring a session with 20 tabs loads one module.
- **Session restore loads only the active tab**; other tabs load when first activated instead of all in the background — cheaper on memory with large files, and still "shell first, contents after".
- **Module commands register once per module** (when its chunk loads) and act on the active tab via `when()`, rather than per tab instance, so IDs stay unique and the palette doesn't fill with duplicates.
- **Later command registrations win shortcut conflicts** (if their `when` holds), so a module can claim e.g. `Mod+F` while it is active.
- **No native menu bar on Windows/Linux.** The ☰ button in the sidebar lists every command grouped by category (built from the command registry); the palette covers the rest. A native GTK/Win32 menu bar would clash with the calm look and duplicate key handling. macOS gets the standard app/Edit menu (needed for Cmd+C/V in WKWebView).
- **Shortcuts are handled in JS only** (capture-phase listener reading the command registry), so they behave the same on all three webviews and in the palette.
- **Toggle-theme shortcut is `Mod+Alt+T`**; there is no common standard for this.
- **Background jobs** (`internal/jobs`) emit `job:progress` at most every 100 ms (budget: ≥ every 250 ms), `job:data` for streamed results and one `job:done`. The status bar shows a job only once it has run for 300 ms.
- **Files dropped from the OS arrive as paths** (Wails `OnFileDrop`), so modules can claim a drop by position (e.g. images into a markdown note) before the default "open it" handler.
- **Atomic save follows symlinks** (writes the link target) and keeps the original file's permissions.
- **Watcher watches parent directories**, not files, so saves by editors that replace the file are still seen; our own writes are recognised by size+mtime and suppressed.
- **Self-test harness**: when `HIA_TEST` is set the frontend lazy-loads `src/test/*` scenarios that drive the real app inside the real webview and exit with a status code (`scripts/selftest.sh`). The chunk is never loaded otherwise.

## Look & feel

- **Darker palette than the brief's starting tokens** (user request): dark `--bg #1f1e1c`, sidebar `#181716`; light `--bg #f6f4ee`.
- **Accent: warm terracotta** (`#d97757` dark / `#c15f3c` light) for focus rings, selection and progress — the only saturated colour.
- **Fonts via `@fontsource-variable/*`** (OFL), variable weight axis only, bundled as woff2 assets (not in the JS bundle). Unicode-range subsets mean only Latin loads for Latin text.
- **Icons: `@lucide/svelte`** with deep imports and stroke width 1.6.

## Dependencies & licenses

| Dependency | License | Where |
|---|---|---|
| github.com/wailsapp/wails/v2 | MIT | app shell |
| github.com/fsnotify/fsnotify | BSD-3-Clause | file watching |
| svelte, @sveltejs/vite-plugin-svelte, vite, vitest, svelte-check | MIT | build/test |
| typescript | Apache-2.0 | build |
| @lucide/svelte | ISC | icons |
| @fontsource-variable/inter, @fontsource-variable/source-serif-4 | OFL-1.1 | fonts |
