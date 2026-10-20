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
  Object selection and select subject snap their edges to the pixels (colour-based edge refinement); the canvas
  has a visible edge on a plain pasteboard; Ctrl keeps rectangles/ellipses square/round; rectangles have
  adjustable corner radius; tool tooltips explain how to use each tool. Blur kinds in Adjust → Blur (Gaussian,
  motion, zoom, spin, lens, tilt-shift, surface), all limited to the selection like every other adjustment; the
  brush and eraser are clipped to the selection while painting.
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
  The selection is unmistakable: a bold frame with drag handles, the rest of the timeline dimmed, and a bar with
  its length and Cut out / Keep only / Deselect (Esc). A cut flashes the removed part red and a toast says how much
  went and how long the video is now (with Undo); removed parts are labelled and each has a restore button.
  Saving rewrites the container in Go (mp4ff for MP4/MOV, our own Matroska writer for WebM/MKV) — seconds for
  any length, no quality loss. Editing works even where the system can't play the codec (e.g. H.264 on a bare
  Linux).

## After v2.0.0-beta.1
- **M14 — Spreadsheet-style grid (CSV and Excel).** The CSV/TSV and .xlsx grids now behave like Excel: select
  ranges by dragging, Shift+click, Shift+arrows/Page/Home/End, row numbers, column headers (sorting moved to the
  ▾ button in the header), Ctrl+Space / Shift+Space and Ctrl/Cmd+A; the status bar shows Average · Count · Sum of
  the selection. Copy/cut/paste as tab-separated text (interchanges with Excel, LibreOffice and Google Sheets):
  one value fills the selection, a block tiles it when it divides evenly, a CSV paste past the last row adds rows,
  cut + paste moves. Delete clears the range. Drag the selection's border to move cells (Ctrl/Alt-drag copies;
  asks before overwriting data); drag the fill handle to continue a series (numbers by their step, "Item 1",
  weekdays, months, ISO dates; anything else repeats) or Ctrl+D / Ctrl+R to fill down/right. Copying, filling
  and Ctrl+D move a formula's relative references (`$` parts stay; off-sheet references become `#REF!`).
  AutoComplete proposes the one matching entry from the column while typing (Enter accepts, Delete/Backspace
  drops it). Every change, including paste/fill/move batches, is one undo step (Ctrl/Cmd+Z, Ctrl+Y /
  Ctrl+Shift+Z; toolbar buttons in CSV); context menu with cut/copy/paste/clear/insert/delete rows.
- **Start page redesign.** "New" has one button per file type (Markdown note, Word document, spreadsheet, CSV,
  image, SVG, web page, JSON, plain text) with simple one-colour icons, instead of a single "New document,
  spreadsheet, image…" button whose label didn't fit; "Open" holds open file/folder, hash check and all commands.
  Long folder paths in the recent list are cut with an ellipsis instead of running off the page.
- **Fix — 3D lag while orbiting during an animation.** Each camera move queued an extra render loop, so the
  renders per frame multiplied while you dragged (worst with a playing, skinned animation). Now exactly one
  render per frame (m11 checks this: 70 renders in 70 frames, longest frame ≤ 41 ms on the software-rendered VM).
  The renderer also no longer keeps its drawing buffer between frames (an extra copy per frame); "Save view as
  PNG" renders right before reading the canvas, which m11 now checks.
- **M15 — Video effects.** Overlays on the video: images (Add image, or drop one on the picture from the OS or
  the sidebar) and area blurs (Gaussian, pixelate, motion, zoom, lens; ellipse or rectangle, soft edge). Each is
  placed by dragging on the preview (move, scale, rotate) and animated with keyframes: an "Animate" switch adds a
  key at the playhead, keys can be retimed on the overlay's track, every key has a timing curve (linear, ease
  in/out, bounce, hold or a custom Bézier drawn in a curve editor) and the path between keys is curved or
  straight; fades in/out per overlay. "Pin to moving object" tracks what is under the overlay (template matching
  in a worker, sub-pixel) and turns it into keys. Speed changes (0.25×–4×) for the selection or the whole video,
  with pitch-preserving audio; transitions where parts meet (crossfade, dip to black, wipe, slide, zoom; 0.5–2 s)
  and whole-video fades. Everything previews live (WebGL compositor over the playing video) and undoes. With
  effects, saving renders a WebM (VP9/VP8 + Opus) with the webview's WebCodecs encoders, cuts exact; without
  effects, saving stays the lossless remux. Nothing loads until the first effect is added.
- **M16 — Split view and interface size.** Show 2–4 tabs at once, like Zen's split tabs: Ctrl+\\ (side by side,
  again to undo), the split button at the end of the tab bar (two side by side, two stacked, three, four), a tab's
  context menu ("Open side by side / below"), or drag a tab from the tab bar onto the edge of a view (the middle
  replaces that pane). The focused pane is outlined and is the "active" tab for shortcuts, the status bar and
  saving; clicking a pane focuses it, choosing a tab in the tab bar shows it in the focused pane, Ctrl+Alt+] / [
  move between panes; dividers drag; closing a tab removes its pane; the split is restored with the session.
  Interface size 80–200 % (Settings → Interface size, Ctrl+Alt+= / Ctrl+Alt+−, "Interface: normal size"):
  text, bars, buttons, icons, list rows and the editor font scale together.
- **M17 — Visual SVG editor.** A Design view (now the default for SVG) next to Source / Split / Preview: select
  shapes on the canvas (click picks the top-level shape, clicking again inside a group goes deeper, Ctrl+click
  the deepest), move by dragging or with the arrow keys (Shift = 10), scale and rotate with handles (Shift snaps
  to 15°), draw rectangles, ellipses, lines, freehand paths and text (Shift for squares/circles), duplicate
  (Ctrl+D), delete, bring forward/back, select the parent group. The inspector edits fill and stroke (also when set
  in a style attribute), stroke width, opacity, geometry, path data, text and every other attribute; an outline
  lists all elements. The source stays the truth: each change rewrites only the attributes or element it touches
  (comments and formatting survive) and goes through the editor's undo (Ctrl+Z works in either view). The canvas
  shows a sanitized inline copy (no scripts, event handlers or outside references).
- **M18 — Code editor, Sublime-style.** Minimap (click or drag to scroll; Settings or "Show / hide minimap"), Go to
  symbol (Ctrl+R: functions, classes, methods, types, Markdown headings from the syntax tree), multiple cursors
  beyond Ctrl+D: add a cursor above/below (Ctrl+Alt+↑/↓), split a selection into lines (Ctrl+Shift+L), select all
  occurrences (Alt+F3); select line (Ctrl+L, again for the next), duplicate (Ctrl+Shift+D), join (Ctrl+J), insert
  line above (Ctrl+Shift+Enter), jump to bracket (Ctrl+M); sort (F9) / natural sort / reverse / unique lines, trim
  trailing whitespace; UPPER (Ctrl+K Ctrl+U), lower (Ctrl+K Ctrl+L), Title and swap case; brackets and quotes close
  themselves; completion from the language plus words in the file; indent guides; show whitespace. The status bar
  counts cursors. All of it is off for files over 8 MB (like highlighting).

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
| Image editor v2 (400×300 test image) | no freeze | adjustments preview+apply worst frame 21–23 ms; background removal 4.3–5.5 s first time, ~2 s after (worker); object selection: 16–18 s one-time analysis, 0.23–0.26 s per click incl. edge refinement; video effects (320×180, 3.5 s output): render 2.6 s with WebCodecs decoding, 4.7 s via <video> seeking; tracking 50 frames 0.9 s / 1.8 s; magic wand on 12 MP 0.9 s in the worker with UI frames ≤ 22 ms | same |
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
- Video saving without effects doesn't re-encode, so cuts snap to keyframes (the timeline shows the snapped result). With effects the video is rendered to WebM (VP9/VP8 + Opus) — the encoders every webview has; MP4/H.264 output isn't offered (no permissively licensed encoder in pure Go; WebKitGTK has no H.264 WebCodecs encoder). No crop or colour filters on video yet.
- Video effects: rendering keeps the whole encoded output in memory until it is written (fine for clips; a long 1080p render needs RAM of roughly its file size), and runs at about 1–2× real time at 320×180 on the test VM (WebCodecs) — slower where WebKitGTK's WebCodecs decoder is missing its GStreamer parser (gst-plugins-bad), because frames then come from seeking a <video> element.
- Split view: the first split of a session costs one 75–100 ms UI frame on the test VM (first layout of the panes); later changes 35–55 ms. Two 3D views can be shown, but only the focused one is live — the other keeps a still of its last frame until clicked (they share one WebGL renderer).
- Interface size scales the design tokens and every font size, plus the shell's bars and controls; some module-specific paddings and canvas overlays stay at their pixel size.
- Video effects: starting a render or a track sets up WebKitGTK's codec pipelines on the main thread — one 80–170 ms UI frame on the test VM; the frame loop itself stays under ~60 ms.
- Video effects: tracking follows translation (not rotation or scale) and stops when the object is lost or covered; overlays and effects aren't saved inside the original file — render, or they're lost when the tab closes (the tab asks first).
- Video: rotation is saved for MP4/MOV only (WebM/MKV have no standard rotation flag); fragmented MP4 (some screen recorders, DASH) and AVI/OGV are play-only.
- Video playback depends on the system's codecs: on Linux, H.264/HEVC/AAC need GStreamer's libav or bad plugins (the app explains this and still lets you edit and save).
- 3D: the first model opened in a session has one ~90–115 ms frame on the software-rendered VM (creating the WebGL context and compiling shaders, which WebKitGTK does synchronously even with `KHR_parallel_shader_compile`); later opens stay ≤ 55 ms.
- 3D: on the software-rendered Linux VM (llvmpipe) a floor-grid line passing under the camera can show as a wide grey bar; the same scene renders correctly in Chromium's software renderer, so it looks like a llvmpipe/WebKitGTK rasterisation bug. Toggle the grid (G) if it appears.
- 3D: glTF files with KTX2/Basis textures (`KHR_texture_basisu`) aren't supported yet (clear error); FBX files with external textures need them next to the model; USD support is three.js's (USDA/USDC/USDZ geometry and materials, no variants or skeletal animation).
- Applying a large blur (40 px, lens/motion) on the software-rendered VM is one 40–150 ms frame (WebGL on llvmpipe); real GPUs render it in a few ms.
- Object selection analyses the whole image once (~15–18 s on the test VM, single-threaded WASM); clicks are fast afterwards. Background removal uses a small model (U²-Netp) — fine hair and glass are approximate. Edge refinement fixes edges within a few pixels of the model's outline; if the model picks the wrong region (e.g. part of a second person), add/exclude with Shift-/Alt-click.
- Grid: one rectangular selection at a time (no Ctrl+click multi-ranges); a CSV paste wider than the table is cut
  at the last column (with a notice) — add columns first; rows can't be reordered by dragging their numbers.
- Grid: in .xlsx, editing a date-formatted cell shows the stored serial number (e.g. 46327), not the date.
- CSV undo history is cleared by changing the delimiter or header setting; .xlsx undo by inserting/deleting rows.
