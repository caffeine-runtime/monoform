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
