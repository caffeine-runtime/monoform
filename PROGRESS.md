# Progress

## Done
- **M0 — Shell.** Wails v2 + Svelte 5 scaffold; sidebar (folder tree, Pinned, Recents), tab bar, status bar;
  dark + light themes following the OS with manual override; bundled Inter + Source Serif 4;
  module and command registries; command palette (Ctrl/Cmd+K) with fuzzy search over commands, recents
  and folder files; open folder; recents/pinned; settings in the OS config dir; session restore;
  background job API; atomic save; file watching; self-test harness.

- **M1 — Text + Markdown.** CodeMirror 6 with lazily loaded language packs; find/replace, go to line, wrap,
  font zoom; encoding + line-ending detection that round-trips byte-for-byte (11 fixture files incl. UTF-16,
  Windows-1252, CR-only, mixed EOL); reopen/save with another encoding; atomic + chunked saves; external change
  banner; parallel streamed folder search; markdown split/source/preview with worker rendering, scroll sync,
  image paste/drop into `assets/`, in-app relative links.

- **M2 — Images.** PNG/JPEG/GIF/WebP/BMP/SVG viewer with wheel zoom around the pointer, pan, fit/actual size,
  folder navigation; crop, resize, rotate, flip; arrows, rectangles, text; blur/pixelate regions; undo/redo;
  save in the same format or Save As PNG/JPEG/WebP/GIF/BMP (re-encoded in Go). Crop+arrow+blur → JPG → reopen
  verified pixel-wise.

- **M3 — PDF.** pdf.js viewer (worker, lazy pages, low-res-then-sharp detail canvas), search, thumbnails with
  multi-select and drag-reorder, zoom/fit; highlight, text comment and ink annotations; form filling; save via
  `saveDocument()`; pdfcpu page operations on a working copy (reorder, rotate, delete, extract, append/merge,
  split). Outputs verified with qpdf and poppler.

- **M4 — Data viewer.** JSON/JSONC: tree (lazy, worker-backed) + raw editor, validation with line/column,
  format/minify, copy path/value. YAML: validation, tree, as-JSON view/save. CSV/TSV: delimiter + header
  detection, virtualized editable grid (1M rows), sort, filter, add/delete rows, byte-exact saves.

- **M4b — Office documents (added on request).** .xlsx/.xlsm editing in a grid with formula bar, live
  recalculation, sheet tabs, row insert/delete, saving with fresh cached results; .docx editing on a page with
  paragraph/run formatting, headings, tables, images, and all other package parts preserved; legacy .xls/.doc
  read by our own BIFF8 / Word 97 readers and saved as .xlsx/.docx. Verified by reopening in LibreOffice.

- **M5 — Archives.** Browse ZIP/TAR/TAR.GZ/BZ2/XZ/ZST/GZ/7z/RAR as folders (also inline in the sidebar tree),
  open inner files read-only in their modules, extract selected/all/here with progress and cancel, create ZIPs.
  Zip-slip, escaping symlinks, pre-existing symlinks and decompression bombs are covered by unit tests;
  RAR/7z read-only with an explanation.

- **M6 — Hashing.** MD5, SHA-1, SHA-256, SHA-512, BLAKE3 computed in one pass with a goroutine per algorithm;
  progress and cancel for multi-GB files; paste-to-compare with algorithm guessing; checksum files (GNU and BSD
  formats, `SHA256SUMS`, `*.sha256`, `*.md5`, …) open in a verification view; tree/palette/drop entry points.

- **M6b — Omnisearch + search by meaning (added on request).** The Ctrl/Cmd+K box now searches commands, file
  names and text inside files together. Optional, off-by-default search by meaning with EmbeddingGemma 2
  (Apache-2.0, 4-bit text encoder) running locally in a web worker on WebAssembly: explicit consent before the
  one-time ~200 MB verified download, incremental two-pass background indexing, int8 index per folder, worker
  unloaded when idle. Seven no-shared-words test queries rank the right file first.

- **M7 — Packaging.** GitHub Actions: checks, Linux self-tests under Xvfb with external verifiers, and packages for
  Windows (NSIS installer with opt-in file associations + portable zip), macOS (universal .app, listed in Open With
  without taking defaults) and Linux (tarball with .desktop file and per-user installer with opt-in defaults).
  README with build instructions and screenshots.

## v2 slice (requested after v1)
- **M8 — Settings, recents, new files.** Settings page (Ctrl/Cmd+,): theme, editor font size, wrap, hidden files,
  recent files with per-item removal, clear lists, "remember recents" switch (off also forgets), search-by-meaning
  link, data locations. An × on hover removes a recent file/folder in the sidebar and on the welcome page.
  **New document, spreadsheet, image…** (Ctrl/Cmd+Alt+N, welcome page, sidebar, folder context menu) creates a
  Markdown note, Word document, spreadsheet, CSV, PNG image (size preset + transparent/white/black), SVG, HTML
  page, JSON or text file from a valid starter template and opens it; existing files are never overwritten.
- **M9 — Image editor v2.** Layers (add, duplicate, reorder, opacity, blend modes, visibility, merge, flatten;
  move/rotate/scale a layer), full transparency (eraser, PNG/WebP keep alpha), pixel selections (rectangle,
  ellipse, lasso, magic wand, click-an-object, select subject; add/subtract) with copy/cut to the system clipboard,
  paste as a layer, delete, fill, blur, pixelate, crop, invert, layer from selection; brush; free rotation by any
  angle; text with a font picker (bundled + installed fonts), bold/italic/outline/shadow; GPU adjustments
  (exposure, brightness, contrast, highlights, shadows, saturation, vibrance, temperature, tint, hue, sharpen,
  blur, vignette, B&W, sepia, invert) with live preview, also limited to a selection; one-click background
  removal; "Save a copy" (and an option to always keep originals); save/open layered OpenRaster (.ora).
- **M10 — SVG.** Source and live preview side by side (preview through `<img>`, so scripts and external
  references in the file never run), zoom/pan, transparent/light/dark background, XML errors with line and
  column while the last good render stays, PNG export at 1×/2×/4×/custom width, open in browser.
- **M10b — HTML pages.** Page / split / source views; the page renders in a sandboxed iframe with an injected
  Content-Security-Policy: scripts off and remote content blocked by default (one click to allow either),
  relative images/styles/scripts served from the page's folder by a read-only, folder-scoped route; external
  links are disabled in the preview ("Open in browser" for the real thing).
- **M11 — 3D viewer.** glTF/GLB (Draco and meshopt compression), FBX, OBJ+MTL, STL, PLY, 3MF, Collada, 3DS,
  USD/USDZ, VRML, AMF, PCD, XYZ, VTK/VTP. Parsing runs in a worker (except the four formats whose loaders need
  DOMParser); textures and .bin/.mtl files come from the model's folder through the read-only folder route.
  Orbit/pan/zoom, frame-to-fit, animation list (click to play, click again to pause, scrub, speed, stop),
  wireframe, lighting on/off (unlit shows base colours and textures), floor grid, dark/light background, save
  the view as PNG. Renders only when something moves; one shared WebGL renderer for all 3D tabs.
- **M12 — Audio.** Player for MP3, WAV, FLAC, OGG Vorbis (and Opus/AAC/WebM audio where the system's media
  stack plays them) with cover art, tags and format details; volume, speed, loop. Waveform editor for WAV/MP3/
  FLAC/OGG: drag to select, cut/copy/paste, delete, trim to selection, silence, fade in/out, volume change in dB,
  normalize, undo/redo, zoom/scroll. Edits are a non-destructive segment list previewed live (playback skips cuts,
  fades are audible); saving renders in Go to WAV or FLAC (tags and cover carried over), or — after cuts only —
  writes MP3 by copying frames, without re-encoding. Waveforms are computed in Go in parallel and stream in while
  the file is already playable.
- **M13 — Video.** Player for MP4/MOV/M4V/WebM/MKV (and OGV/AVI where the system plays them): thumbnail timeline
  with keyframe ticks, click/drag to seek and select, frame stepping, ±5 s, speed, volume, A–B loop, full screen,
  save the current frame as PNG. Light editor without re-encoding: cut out the selection, keep only the selection,
  rotate 90° steps (MP4/MOV), remove the audio track, extract the audio (.m4a/.weba/.mka); undo/redo; the
  timeline shows exactly what will be kept (cut points snap to keyframes) and playback skips removed parts.
  Saving rewrites the container in Go (mp4ff for MP4/MOV, our own Matroska writer for WebM/MKV) — seconds for
  any length, no quality loss. Editing works even where the system can't play the codec (e.g. H.264 on a bare
  Linux).

## Next (after v1)
- Code signing / notarization (needs certificates), a project licence file, and third-party notices bundled with
  the packages.
- Measure startup and the other budgets on real Windows/macOS/Linux hardware.
- Search by meaning for PDF and Word text.

## Performance (measured)

| Budget | Target | Measured | Where |
|---|---|---|---|
| Cold start → interactive | < 500 ms | 480–730 ms process start → first frame; 180–260 ms of that is the frontend (navigation → first frame) | Linux, Xvfb + llvmpipe software GL, 4 vCPU VM, no GPU |
| Initial JS bundle | < 200 KB gz | 129 KB raw entry chunk (M0) | `npm run build` |
| 50 MB / 580k-line log: open | no freeze | full text in 1.3–1.4 s; first screen sooner; worst frames 80–120 ms (one at start = first CodeMirror chunk compile, one at the end ≈ GC); idle frames ~25 ms | Linux VM, llvmpipe |
| 50 MB log: typing / scrolling | no freeze | typing worst frame 35 ms; jump-scrolling across the file 54–88 ms | same |
| 50 MB log: save | no freeze | 1.7–2.7 s, worst frame 40–57 ms (chunked upload) | same |
| Folder search | streamed | 200 files in 33–45 ms | same |
| 1M-row CSV (40 MB) | smooth scroll, sort | loads in 1.1–2.1 s (worst frame 54–61 ms); scrolling worst frame 60 ms (100 frames, 4 above 50 ms, all on large jumps); sort 2.6 s in the worker with UI frames ≤ 40 ms; filter 0.7 s | same |
| Hashing (page cache warm) | progress ≥ 4/s, UI responsive | SHA-256 308 MB/s, BLAKE3 3.2 GB/s, all five at once 258 MB/s; 3 GiB file: progress every ≤ 113 ms, worst UI frame 38–60 ms while hashing | same |
| Search by meaning (optional) | no freeze; memory returned when idle | 25–45 tokens/s (single-threaded WASM), query 1.0–1.3 s, model load 8–9 s, ~0.8 GB extra while loaded (webview RSS 0.34 → 1.11 GB) and freed on unload; worst UI frame 23–40 ms while indexing, 50–73 ms during a cold model load | same |
| Image editor v2 (400×300 test image) | no freeze | adjustments preview+apply worst frame 21–23 ms; background removal 4.3–5.5 s first time, ~2 s after (worker); object selection: 16–18 s one-time analysis, 0.19–0.23 s per click; magic wand on 12 MP 0.9 s in the worker with UI frames ≤ 22 ms | same |
| 3D model open (small models) | no freeze | first 3D tab of a session 460–540 ms, worst UI frame 87–115 ms (WebGL context + three.js + shader compiles, once); later tabs 160–300 ms, worst frame 30–55 ms; parse in the worker 33–67 ms | same |
| Audio open | playable at once, waveform streams in | 3 s WAV: 195–240 ms to open, waveform complete after 140–190 ms; 10-min WAV: open 225 ms, waveform 165–175 ms, worst UI frame 35–50 ms; 10-min MP3 waveform 2.5 s (4 cores; 9.6 s on one), OGG 0.4 s, FLAC 2.4 s | same |
| Video open / save | playable at once; save ≈ copy speed | 6 s WebM: open ~200 ms; saving remuxes without decoding (bounded by disk speed); Go tests remux 4 formats in < 1 s | same |
| 100-page PDF: first page visible | < 300 ms | 133–287 ms once the PDF module is loaded; 490–570 ms for the first PDF of a session (worker + fonts cold) | same |

The Linux numbers are from a headless VM with software rendering; ~350 ms of each start is
GTK/WebKitGTK process start-up before our page loads. Not yet measured on Windows/macOS (no machines
available here).

## Known issues
- Start-up on the headless Linux VM is above the 500 ms budget; needs measuring on real hardware.
- Opening a 50 MB file has one or two 80–120 ms frames on the software-rendered VM (budget 50 ms).
- Markdown preview code blocks are not syntax-highlighted.
- The first PDF opened in a session takes ~0.5 s to show page 1 (cold worker/fonts); later ones meet the 300 ms budget.
- PDF annotation colours/thickness use pdf.js defaults (no colour picker yet).
- Word editing: creating new bullet/numbered lists, inserting images/tables and editing headers/footers aren't supported yet (existing ones are preserved). Legacy .doc conversion keeps text only; .xls conversion keeps values (not formulas/formatting).
- Search by meaning is slow to index (single-threaded WebAssembly; the webview can't run WASM threads — see DECISIONS) — a large notes folder takes hours on slow hardware, though every file gets one passage early. A query waits for at most one in-flight indexing passage (a few seconds on slow machines).
- A cold load of the search model produces one 50–75 ms UI frame on the test VM (budget 50 ms).
- Search by meaning indexes plain text/Markdown/code only (not PDFs or Word files yet).
- Windows and macOS builds are produced by CI but haven't been exercised on real machines from this environment (the Windows installer was cross-built and inspected here; see docs/TESTING.md → Packaging for the manual pass). Packages are unsigned.
- Image editor: applying a background-removal or object mask re-renders the layer synchronously; with blurred text shadows on the software-rendered VM that is one ~70–100 ms frame (the analysis itself runs in a worker without UI stalls).
- Audio: very-low-bitrate MPEG-2 MP3s (below 40 kbit/s at 16–24 kHz, e.g. some voice memos) decode with errors in the pure-Go decoder (go-mp3), so their waveform and re-encoded saves are wrong; playback (the system decoder) and lossless MP3 cuts are unaffected. MPEG-2.5 (8–12 kHz) MP3s aren't editable.
- Audio: there's no permissively licensed MP3/AAC/Vorbis encoder in pure Go, so edited audio is saved as WAV or FLAC (MP3 only after cuts, by copying frames). Opus/AAC/M4A play (where the system can) but aren't editable.
- Audio preview: cut points can sound a few milliseconds late (the player seeks over removed parts); the saved file is exact. MP3 waveform and playback can be offset by up to ~25–50 ms (players skip the encoder delay differently); edits are sample-exact relative to the waveform.
- Video editing doesn't re-encode, so cuts snap to keyframes (the timeline shows the snapped result) and there are no transitions, filters, crop or format conversion: there's no permissively licensed H.264/HEVC encoder in pure Go, and WebCodecs encoders differ per platform (WebKitGTK: VP8/VP9 only).
- Video: rotation is saved for MP4/MOV only (WebM/MKV have no standard rotation flag); fragmented MP4 (some screen recorders, DASH) and AVI/OGV are play-only.
- Video playback depends on the system's codecs: on Linux, H.264/HEVC/AAC need GStreamer's libav or bad plugins (the app explains this and still lets you edit and save).
- 3D: the first model opened in a session has one ~90–115 ms frame on the software-rendered VM (creating the WebGL context and compiling shaders, which WebKitGTK does synchronously even with `KHR_parallel_shader_compile`); later opens stay ≤ 55 ms.
- 3D: on the software-rendered Linux VM (llvmpipe) a floor-grid line passing under the camera can show as a wide grey bar; the same scene renders correctly in Chromium's software renderer, so it looks like a llvmpipe/WebKitGTK rasterisation bug. Toggle the grid (G) if it appears.
- 3D: glTF files with KTX2/Basis textures (`KHR_texture_basisu`) aren't supported yet (clear error); FBX files with external textures need them next to the model; USD support is three.js's (USDA/USDC/USDZ geometry and materials, no variants or skeletal animation).
- Object selection analyses the whole image once (~15–18 s on the test VM, single-threaded WASM); clicks are fast afterwards. Background removal uses a small model (U²-Netp) — fine hair and glass are approximate.
