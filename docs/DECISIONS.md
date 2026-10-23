# Decisions

Choices the brief didn't dictate, one line of reasoning each. Newest at the bottom of each section.

## Platform & build

- **Wails v2.17.0, Go 1.25** (`go.mod` says 1.25; the toolchain auto-downloads). Wails 2.17 itself requires Go ≥ 1.25.
- **Linux needs WebKitGTK 4.1 and the `webkit2_41` build tag.** Ubuntu 24.04+ / Debian 13 / Fedora 40+ only ship `libwebkit2gtk-4.1-dev`; Wails' default (no tag) links the old 4.0 API. `scripts/build.sh` adds the tag automatically when `pkg-config webkit2gtk-4.1` succeeds.
- **No cgo in our code.** Wails needs cgo on Linux/macOS for the webview itself; everything we add is pure Go.
- **TypeScript 6.x, not 7.x.** svelte-check 4.7 only supports TS ^5 || ^6; TS 7 (the native port) would break type checking.
- **Vite 8, Svelte 5.57, Vitest 5** — current stable at the time of writing.

## Architecture

- **Renamed to Monoform (was Hold It All).** A free, open-source (MIT), AI-written app; the logo is a
  single rounded M, kept as vector paths in `scripts/icons.py` (`build/icon/logo.svg`, `logo-mark.svg`), which also
  draws every icon from it. Everything carries the new name — window and product, binaries (`monoform`,
  `monoform-cli` for the Windows/macOS console command; on Linux the app binary answers `monoform hash …` itself),
  registry (`Monoform.<ext>` classes), the Go module path (`github.com/caffeine-runtime/monoform`), internal prefixes
  (`/__mf/`, `MF_*` test variables, `mf-test.*` fixtures, rebuilt). Nothing carries data over from the old
  name: only the maintainer ran it, so migration code would be dead weight.
- **The path bar's folder browser is a popover, not the sidebar.** Clicking a folder in the path shows that folder's
  contents in place (one level at a time, `..` to go up), so browsing from a file never replaces the folder open in
  the sidebar; *Open as folder* does that on purpose. *Show in Explorer* uses `explorer.exe /select,"<file>"` (given as
  a raw command line: Explorer parses its own arguments), `open -R` on macOS and `xdg-open <folder>` on Linux.
- **The app menu shows families of options as one row** (`MenuControlRow.svelte`): theme (three-way toggle), interface
  size and text size (sliders), split layouts (buttons) — seven to ten one-line items each before; the rows change
  the setting live and keep the menu open. On/off options are checked items named after the thing ("Minimap ✓"),
  not "Toggle minimap". Control rows show only when their commands are available (text size always: it's a setting).
- **Side panels hide with one switch** (`panelsHidden`): panels carry `data-sidepanel` and the app hides them all with
  one CSS rule, so every editor's panel follows the same toggle without each module wiring it; asking the image editor
  for a panel (its toolbar buttons) turns them back on, so a hidden panel is never a dead button.
- **Optional AI models run natively, not in the web view** (`internal/ai`). The better subject finder (BiRefNet) and
  object removal (Moebius) are too big for onnxruntime-web: WebAssembly's 4 GB limit and one-thread speed rule them
  out (BiRefNet needs ~2 GB working memory, Moebius 1.2 GB of weights). Go loads Microsoft's ONNX Runtime shared
  library at run time and calls its C API through **purego** — no cgo, so the app still builds and runs without it.
  Only the functions used are bound (`ort.go`: table indices from `onnxruntime_c_api.h`, which only grows at the end);
  model paths go as UTF-16 on Windows; telemetry events are switched off; a run can be stopped (`RunOptionsSetTerminate`).
  - **Opt-in downloads** (Settings › AI models, or offered the first time a feature needs one): a dialog names the
    size and the hosts first. Files are pinned by revision, size and SHA-256 (`catalog.go`) and fetched with
    `internal/download` (shared with search by meaning). The runtime comes from the official NuGet package: only this
    platform's library is read out of it with **HTTP Range requests** (6 MB for Windows instead of the 160 MB package;
    offsets pinned from its central directory). No runtime for Intel Macs (Microsoft doesn't publish one), so the
    packs show as unavailable there. Removing the last pack removes the runtime too.
  - **Several packs can download at once** (each its own job). The runtime is part of every install, so a per-file
    lock (`install.go`) makes a second install wait for the file the first is fetching and then count it as done,
    instead of fetching it twice. *Download all* asks once for everything missing.
  - **Models are loaded on first use and freed after a minute idle**, one inference at a time; nothing runs in the
    background.
  - **BiRefNet:** the onnx-community export decomposes deformable convolutions into GatherND/ScatterND chains: 29 s
    and 7.4 GB per picture on 4 cores. The GridSample export (CoderViking, MIT, reproducible script and measured
    deviation 1e-4) takes ~6 s and 2 GB. ONNX Runtime 1.31 also runs ONNX's DeformConv natively, but the time goes to
    the Swin backbone (MatMul/Conv ~50%), so a re-export wouldn't pay. The 1024² mask is snapped to the pixels
    with the existing refine step.
  - **Moebius** (ECCV 2026, 0.22B, Apache-2.0) fills like a diffusion model: it paints what could be behind an object
    instead of smearing texture. The reference sampler runs 19 steps with guidance (38 UNet passes, ~2 min on 4 cores).
    Measured on our photos, **5 steps without guidance** give the same removals in ~25 s (+ ~15 s to load the model the
    first time) — *provided the steps start at the noisiest level (999)*: the reference spacing for few steps starts at
    750, which from pure noise makes the model paint a new object into the gap. The model works on 512×512 like phone
    erasers: the app crops a square ~1.8× the selection around it, grows the mask 6 px (edges, halos), and pastes the
    fill back through a 2 px soft edge, one undo step. Rejected: LaMa (200 MB, weaker at large objects), RETHINED (fast,
    BSD-3 code, but no trained weights published).
  - **Transfers are chunked** (256 KB requests, Range reads of results): the app's own requests are handled on the UI
    thread by WebKitGTK and WebView2.
  - **Self-tests use stand-ins** (`MF_AI_FAKE=1`): the UI flow is tested in CI without 1.4 GB of downloads; the real
    models are covered by Go tests (`MF_AI_STORE`) and `m43real`, locally, and CI downloads the real runtime on Linux
    and Windows and runs a tiny model with it.
- **Save dialogs never start in the working directory** (`internal/app/savedir.go`). Windows starts GUI apps from
  Explorer, file associations and the installer with the working directory at `C:\Windows\System32` (or the install
  folder), so a suggested name without a folder now goes to the folder last saved into, else Documents.
- **File bytes travel over HTTP, not JSON bindings.** Wails bindings JSON-encode everything; a 50 MB log or a PDF would be base64'd through `ExecJS`. Instead the Wails asset server routes `/__mf/*` to `internal/server` (Range-capable `GET /__mf/file`, `POST /__mf/save` → atomic write). Bindings are used only for small calls.
- **File history is a local, content-addressed store, not Git.** Versioning must work for any file the app saves
  (binary images and documents included), in any folder, without a repository or tools to install. Every app
  write already ends in `fs.ReplaceFile` (temp file + rename), so `internal/history` hooks there: *Before* hard-links
  the content about to be replaced into `history/pending` (after the rename that link is its only name — no bytes
  copied while saving; a copy across volumes), *After* copies the new content (a link would follow in-place
  rewrites by other programs). A background worker hashes (SHA-256) into `history/blobs` once per content (gzip
  unless the format is already compressed) and keeps a JSON index per file (path, newest version first). Taking
  both contents at save time keeps versions in save order. Paths under the settings folder, the cache and the
  app's working copies are skipped. Limits: per-file count, total size (oldest dropped first, never a file's
  newest), and a per-file size cap so a 4 GB video export isn't duplicated. Renames in the app move the index.
  Rejected: Git (would need a repository per folder, binary blobs bloat it, and users' own repos must not be
  touched); keeping full copies next to files (clutters folders).
- **Per-launch token on `/__mf/*`.** Content rendered from user files (markdown, SVG, PDFs) can't reach the file system through the data channel without it. Cheap defence in depth.
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
- **Self-test harness**: when `MF_TEST` is set the frontend lazy-loads `src/test/*` scenarios that drive the real app inside the real webview and exit with a status code (`scripts/selftest.sh`). The chunk is never loaded otherwise.

- **Request bodies are always ArrayBuffers.** WebKitGTK segfaults in `webkit_uri_scheme_request_get_http_body` when a custom-scheme POST carries a `Blob`; empty bodies are sent as an `X-Empty-Body: 1` header instead of a zero-length body for the same reason (`core/backend.ts`).
- **Big saves are chunked**: anything over 4 MB is uploaded as 4 MB pieces (`/__mf/upload/{begin,chunk,commit,abort}`) into a temp file that Go renames atomically on commit. WebKitGTK copies request bodies on the page's main thread (≈120 ms per 16 MB), so one 50 MB POST froze the UI for ~0.5 s.
- **Big reads happen in the text worker, in 4 MB Range requests.** `fetch().arrayBuffer()` of 55 MB on the page thread froze it for ~470 ms; the same fetch from a worker in Range pieces costs a few ms per piece.
- **Text decode/encode runs in a worker**; decoded text streams to CodeMirror in ~2 MB chunks (appended without history) so the first screen shows before the whole file has loaded.
- **Files over 8 MB get a lighter editor**: no syntax highlighting, folding, bracket matching or selection-match highlighting (CodeMirror itself is fine; those extensions are what costs).
- **Encodings**: detection is BOM → BOM-less UTF-16 (NUL pattern) → strict UTF-8 → Windows-1252. Windows-1252 maps all 256 bytes, so even unknown 8-bit files round-trip losslessly. Writable: UTF-8 (±BOM), UTF-16 LE/BE, and single-byte code pages via a reverse table built from `TextDecoder`. Multi-byte legacy encodings (Shift JIS, GBK, …) can be *reopened* with but are saved as UTF-8 after asking.
- **Line endings**: LF/CRLF/CR files use CodeMirror's normal splitting and are re-joined with the detected separator; files with *mixed* endings are split on `\n` only, so every `\r` stays in the text and the file round-trips byte-for-byte.
- **Dirty state** is cleared again when undo returns to the saved text (length check, then `Text.eq`, debounced).
- **Markdown**: preview rendered by markdown-it in a worker; raw HTML is escaped (`html: false`). Relative images load through the data channel; **remote images are not fetched** (offline principle) and show a placeholder. External links open in the system browser on click (the app itself makes no request).
- **Pasted/dropped images** go to `assets/` next to the note with a collision-free name (`pasted-YYYYMMDD-HHMMSS.png`); images dragged from the sidebar are linked where they are (no copy); images dropped from the OS are copied into `assets/`.
- **Folder search** (`internal/search`): parallel workers (≤ 8), skips binary files (NUL in first 8 KB), files > 20 MB, hidden folders, `.git` and `node_modules`; stops at 5,000 matches; results stream every 80 ms.
- **Markdown source soft-wraps by default**; other text files follow the global word-wrap setting (Alt+Z).

- **Image editing model**: one base raster (canvas) plus editable Konva markup shapes. Raster operations (crop, rotate, flip, resize, blur, pixelate) first merge the markup into the raster, so markup stays movable/editable until the next raster operation. Undo keeps whole snapshots, capped at 30 steps / 250 MP.
- **Blur and pixelate** are done by down- and up-scaling the region (twice for blur) rather than `ctx.filter`, which older WKWebView/WebKitGTK builds lack. The result is irreversible (no recoverable detail), which matters for redaction.
- **Images are saved by flattening to PNG in the webview and re-encoding in Go** (`internal/imaging`, a `transform` on the save endpoint), because canvases can't encode WebP/GIF/BMP in every webview. JPEG quality 92; alpha is flattened onto white for JPEG/BMP; GIF is single-frame with a 256-colour dithered palette.
- **WebP is saved lossless** (pure-Go `nativewebp`, MIT); no permissive pure-Go lossy WebP encoder exists.
- **GIFs open as an animated `<img>`**; "Edit" converts the first frame to the canvas editor (and says so). **SVGs are view-only** and render as `<img>` (scripts in SVG never run).
- **Image shortcuts are single keys** (C crop, A arrow, R rectangle, T text, B blur, P pixelate, [ ] rotate, 0 fit, 1 actual size, ←/→ previous/next) and only fire while an image tab is active and focus isn't in a text field.

- **PDF viewer = pdf.js's own `PDFViewer` component** (lazy page rendering, text layer, find controller, annotation layer with forms, annotation editors). Writing our own would duplicate years of edge cases.
- **Fit width / Fit page follow the view's size**: pdf.js computes these once, so a ResizeObserver on the viewer re-applies them when the window or a split pane changes size (a PDF opened in a narrow pane or in the background otherwise stayed at its first scale).
- **pdf.js scripting is off** (no `PDFScriptingManager`; the QuickJS engine isn't shipped) — PDF JavaScript never runs.
- **pdf.js resources are local**: CMaps, standard fonts, WASM image decoders (OpenJPEG BSD-2, JBIG2 BSD-3, QCMS MIT) and ICC profiles are copied into `dist/pdfjs/` by a small Vite plugin.
- **"Low-res first, then sharpened"** uses pdf.js's built-in detail canvas: `maxCanvasPixels` is 1 MP, so a page first renders into a small CSS-scaled canvas, then pdf.js draws a sharp canvas for just the visible region.
- **One shared pdf.js worker**, started when the PDF module loads, reused by every document.
- **Page operations work on a working copy**: each op (pdfcpu) writes a new temp file that the viewer reloads; the tab is dirty until Save copies the working file over the original (atomic). Annotations made before a page op are first baked in with `saveDocument()`. Closing without saving discards everything.
- **"Merge PDFs" appends** the chosen files to the open document (save or Save As to keep it); **split** writes `<name>_<n>.pdf` files into a chosen folder as a background job; **extract** writes selected pages (or a typed range) to a new file and offers to open it.
- **Annotations and form values are written by pdf.js's `saveDocument()`** (incremental, standard /FreeText, /Ink, /Highlight annotations and AcroForm values), verified with qpdf and poppler.
- **pdfcpu never touches its config dir** (`model.ConfigPath = "disable"`).
- **Password-protected PDFs show a clear message**; opening them is part of the v2 encryption work.
- **Thumbnail drag-and-drop moves the whole selection as a block**; Ctrl/Cmd-click toggles, Shift-click selects a range.

- **JSON errors come from our own scanner** (`modules/data/jsonparse.ts`): `JSON.parse` is tried first for speed; on failure the scanner finds the exact line/column with a human message. JavaScriptCore's `JSON.parse` messages carry no position, so relying on them would break on macOS/Linux.
- **JSON/YAML trees are served lazily by a worker** that keeps the parsed value; the tree requests children of a path (500 at a time, "show more" for bigger containers). A 50 MB JSON never has to be cloned to the main thread or rendered as DOM. "Expand all" is capped at 2,000 containers.
- **JSONC** (`.jsonc`) accepts comments and trailing commas; **YAML** uses the `yaml` package (ISC) with unique-key checking; multi-document YAML shows as an array of documents. YAML is edited as text; "As JSON" shows a read-only conversion that can be saved as a `.json` file.
- **Format/Minify rewrite the editor text in one transaction** (undoable), using 2-space indentation.
- **CSV/TSV live in a worker** that keeps the decoded text plus a `Float64Array` of record offsets; the grid fetches 200-row blocks. Sorting uses per-column keys (numeric when ≥ 90 % of non-empty values are numbers, else case-insensitive text; empty cells last), filtering is a case-insensitive substring match on the raw record.
- **CSV saves are byte-exact for untouched rows**: each record is written back from its original text slice including its own line terminator; only edited rows are re-serialized (minimal quoting). Encoding, BOM and delimiter are preserved. Added rows use the file's dominant line ending.
- **Header detection**: a first row is a header when it is non-empty, unique, and is text above numeric/date columns (or, for all-text tables, its values don't repeat below it). It can be toggled in the toolbar; the delimiter can be overridden.
- **Very tall grids use a scaled scrollbar** (browsers cap element height at ~16–33 M px): above 8 M px of rows, the scrollbar position maps proportionally to rows. Rows sit at their virtual positions inside one container moved by a single transform, which keeps scrolling at roughly one paint per frame.
- **Spreadsheet-style grid (M14)** is one component (`modules/data/Grid.svelte`) shared by CSV and .xlsx; the
  pure logic (ranges, TSV, fill series, formula shifting, AutoComplete, stats) is in `gridOps.ts` with unit tests.
  - **Selection is an anchor + active cell** (one rectangle), so it costs nothing at a million rows; its overlay is
    clipped to the rows on screen. Stats for a selection are computed off the main thread (CSV worker; Go reads for
    .xlsx, capped at 500k cells) after a 120 ms pause.
  - **The clipboard carries TSV** — what Excel, LibreOffice and Sheets put there — written inside the key gesture
    with a `ClipboardItem` promise (WebKit requires that). A copy also remembers the raw inputs, so pasting the same
    text in the app keeps formulas (shifted) and turns a cut into a move.
  - **Edits travel as one batch** (`cells` + `clear` ranges): one worker message or one Go call (`SheetSetCells`,
    a single recalculation), and one undo step. CSV undo entries are keyed by **record index**, not view row, so
    they survive sorting and filtering; .xlsx undo keeps the previous inputs Go returns for the cells it changed.
  - **AutoComplete follows Excel**: only a unique case-insensitive prefix match among the column's text entries
    (never numbers), proposed as a selected suffix so typing on simply replaces it.
  - Clicking a header selects its column (as in spreadsheets); sorting moved to a small ▾ button in the header.

- **Office documents (added on request, M4b) are editable, not read-only.**
  - **.xlsx/.xlsm** are edited through excelize (BSD-3) in Go: only cells you change are rewritten, so styles, number formats, other sheets, charts and defined names stay as they were. Input follows spreadsheet rules (`=…` formula, number, TRUE/FALSE, otherwise text). After every edit the sheet's formula cells are recomputed (excelize's calculation engine) so dependent values update live; on save the computed results are written into the formula cells' cached values **and** the workbook asks for full recalculation on load, so Excel, LibreOffice and file previews all show correct numbers. Workbooks written by scripts (openpyxl, pandas, excelize) often store formulas **without** results; like Excel, opening one calculates them (for workbooks up to 100k cells; bigger ones are indexed on the first edit). Formula cells are found within the sheet's stored dimension, not just the rows read, since a never-calculated formula at the end of a row has no value to read.
  - **.docx** is edited on a page-like canvas. The XML is parsed in the webview; each paragraph/run keeps a pointer to its original element, and saving rebuilds `word/document.xml` reusing the original paragraph and run properties (fonts, sizes, colours, spacing, numbering). Every other package part (styles, headers/footers, images, comments, settings) is copied byte-for-byte. Paragraphs containing tracked changes, fields, content controls or equations are shown read-only and written back untouched. Bold/italic/underline/strike and Heading 1–3/Normal can be changed; pasting is plain text (foreign HTML can't be mapped onto Word formatting). Bullets/numbering are kept but can't be created yet.
  - **Legacy .xls and .doc can be opened and edited, but are saved as new .xlsx/.docx files next to the original** (which stays unchanged), with a clear note. There is no permissive library that writes the old binary formats faithfully: `shakinm/xlsReader` is GPL-3 (excluded), `extrame/xls` is read-only and unmaintained. We read them ourselves on top of `richardlehane/mscfb` (Apache-2.0): BIFF8 cell values (numbers, dates, text, booleans, cached formula results) and the Word 97 piece table (text). Formulas/formatting of .xls and images/tables/formatting of .doc are not carried over (said in the UI).
  - Images inside .docx are served from the package via `/__mf/zip`.
  - Numeric-looking grid cells are right-aligned (spreadsheet convention).

- **⚠️ `hashicorp/golang-lru/v2` (MPL-2.0) is replaced by our own ~50-line LRU** (`third_party/golang-lru`, MIT) via a `replace` directive in `go.mod`. `mholt/archives` → `bodgit/sevenzip` uses it only for a 10-entry 7z AES-key cache (`New`, `Get`, `Add`). MPL-2.0 is weak copyleft, not on the allowed list, so rather than ship it we provide the same three functions under MIT. Flagged here because it is a deliberate workaround: if MPL-2.0 is acceptable to you, delete the `replace` line.
- **Extraction safety** (`internal/archive`): entry names with `..`, absolute paths, drive letters or reserved names are refused; symlinks are created only if their target stays inside the destination (never on Windows); hard links, devices and pipes are skipped; every write goes through an **`os.Root`** opened at the destination, so even a symlink already present (or created earlier in the same archive) can't redirect a write outside it. setuid/setgid bits are dropped. Skipped entries are listed to the user with the reason.
- **Decompression-bomb limits**: 200,000 entries, 32 GiB total, and a 1000:1 expansion ratio once more than 1 GiB has been written. Bytes are counted as they are written (headers aren't trusted); a partial file is deleted when a limit stops extraction.
- **Existing files** default to "rename" (`name (2).ext`) when extracting; nothing is overwritten silently.
- **Selecting a folder inside an archive** extracts it relative to its parent (`a/b` → `b/…`).
- **Archives in the sidebar tree** expand like folders (their listing is cached per path+size+mtime); clicking an archive opens the archive browser; inner files open in their normal module as read-only tabs (Save As to edit a copy), streamed from memory — no temp files.
- **RAR and 7z are read-only by design** and the archive view says why in a banner (RAR compression is proprietary; 7z creation isn't supported) instead of showing disabled buttons. Only ZIP can be created ("Compress to ZIP…" on any file/folder, "Create ZIP from files…" in the palette); `.zip`, images, media and Office files are stored without recompression.
- **One real photo in the test fixtures**: `scripts/fixture-data/astronaut.jpg`, NASA's portrait of astronaut Eileen Collins — public domain (a work of the US government), as shipped in scikit-image's sample data. Synthetic shapes can't test whether selecting a person works. Used only by self-tests, not shipped.
- **RAR test fixtures are generated** (stored RAR5 written from the public format description), since RAR files can't be created with free tools.

- **Hashing runs one goroutine per algorithm over shared read buffers** (`internal/hash`): the file is read once in 1 MiB blocks and each block is handed to every selected hasher in parallel, so selecting all five algorithms costs about as much as the slowest one (SHA-512/SHA-256), not the sum. Progress is reported at most every 100 ms; cancel stops between blocks.
- **Algorithms: MD5, SHA-1, SHA-256, SHA-512 (Go standard library) and BLAKE3** (`lukechampine.com/blake3`, MIT — pure Go with assembly, no cgo). SHA-256 is preselected; the selection is remembered. MD5/SHA-1 are offered for checking old downloads, not for security, and are labelled only by name.
- **Compare box accepts what people paste**: whitespace, `0x`, upper case and a `sha256:` / `SHA256 (file) = …` wrapper are stripped; the algorithm is guessed from the length (32 hex = MD5, 40 = SHA-1, 64 = SHA-256 — or BLAKE3 if that is what matches, 128 = SHA-512) and computed on demand if it wasn't selected.
- **Checksum files** (`SHA256SUMS`, `*.sha256`, `*.md5`, `*.b3`, …) open in a verification view instead of the text editor (Open With → Text still works). Both GNU (`hash  name`, `hash *name`) and BSD (`SHA256 (name) = hash`) lines are read; paths are relative to the checksum file; the algorithm comes from the BSD tag, the file name, or the hash length. Each line is reported OK / mismatch / missing / unreadable; duplicate lines are kept (a file listed twice with different hashes shows both verdicts).
- **"Compute hash…" and "Verify checksums"** are in the palette (`Mod+Alt+H` for the hash tool), in the file-tree context menu, and dropping a file on the hash tool hashes it.

- **Omnisearch is the existing search box (Ctrl/Cmd+K), not a new one.** It already matched commands and file names; it now also streams **"In files"** text matches from the Go folder search (literal, case-insensitive, ≥ 2 characters, debounced 120 ms, first match of the 8 files with most matches) and, when turned on, **"By meaning"** results. `>` still limits it to commands. Instant groups render first; slower groups append below so the selection never jumps.
- **Search by meaning (added on request) uses EmbeddingGemma 2**, Google's embedding model released 2026-10-06 under **Apache-2.0** (so no separate Gemma terms to accept). We use the `onnx-community/embeddinggemma-2-ONNX` export, **text encoder only, 4-bit weights (`model_q4`, 174 MB + 32 MB tokenizer)**, pinned to revision `daa72c5…` with fixed SHA-256 sums in `internal/semantic/model.go`. q4 was chosen after measuring: q8 is the same speed and 1.8× larger; fp32 is 2× *slower* under WebAssembly and 6× larger; fp16 isn't supported by the model's activations.
  - **Off by default; nothing is bundled.** Turning it on shows what will happen (source, size, license, memory, speed) and needs an explicit checkbox before the one-time download. This download is the **only network access in the app**; it is done by Go (honours proxy settings), verified, and stored in the user cache dir (`…/Monoform/models/`). "Remove model…" deletes it and all indexes.
  - **The model runs in a web worker on onnxruntime-web's WebAssembly backend** (MIT, bundled locally — the 14 MB `.wasm` is a lazily loaded asset, never fetched from a CDN) with `@huggingface/tokenizers` (Apache-2.0). We call the ONNX graph directly (`input_ids`, `attention_mask`, empty image/video/audio features → `sentence_embedding`) instead of using transformers.js, which would pull `sharp` (native, LGPL libvips binaries) and `onnxruntime-node` into the dependency tree.
  - **Single-threaded by necessity.** WebAssembly threads need `SharedArrayBuffer`, i.e. a cross-origin-isolated page. We tried sending COOP/COEP headers: they reach the page, but WebKitGTK doesn't isolate the `wails://` scheme (macOS uses a custom scheme too). Profiling shows 86 % of the time in 4-bit MatMul at ~10 GFLOP/s, i.e. normal single-thread WASM SIMD; there is no pathology to fix. Measured on the 4-vCPU test VM: **~25–45 tokens/s, ~1.1 s per query, ~8–9 s to load the model**, ~0.8 GB extra memory while loaded. Running a native runtime would need cgo (excluded).
  - **To make that speed usable:** passages are ~900 characters (≤ 256 tokens), at most 8 per file; indexing is **incremental** (size + mtime) and runs in **two passes** — one passage of every file first, then the rest — so the whole folder becomes findable early; queries jump ahead of queued indexing work; files are indexed smallest-first. Only text/Markdown/code files ≤ 1 MB are indexed; lock files, minified files, hidden folders and `node_modules` are skipped.
  - **Memory:** the worker is started on first use and **terminated after 60 s idle** (30 s–15 min setting), which returns all its memory; the index of only the open folder is held in Go. Turning the feature off unloads both.
  - **Index:** vectors are truncated to **256 dimensions** (EmbeddingGemma is Matryoshka-trained; renormalized) and stored as **int8 with a per-vector scale** — 260 bytes per passage. One cache file per folder (`…/Monoform/index/<hash>.idx`: magic, JSON header with paths/lines/snippets, then the vectors; format documented in `internal/semantic/index.go`). Search is a brute-force dot product in Go (best passage per file); a few thousand files take milliseconds. Prompts follow the model card: `title: <file name> | text: …` for passages, `task: search result | query: …` for queries.
  - **Results** show files whose best passage scores within 0.08 of the top hit (unrelated passages score only ~0.1 lower than real matches, so a fixed threshold doesn't work); Enter opens the file at the passage's line.

- **Packaging (M7).** CI (`.github/workflows/build.yml`) runs on pushes to `main`, pull requests and manual dispatch: type check, unit tests, `go vet`, the license audit, the Linux in-app self-tests under Xvfb (with qpdf/poppler/7z/unzip verification), and packages for all three platforms as workflow artifacts. **Releases**: a pushed `v*` tag (or a manual run with a version) stamps the version into the binary (`-X …/internal/app.Version`) and the Windows product version, waits for checks + self-tests + all packages, and publishes a GitHub release with the packages, `SHA256SUMS` and notes from `.github/release-notes.md` (suffixed versions become pre-releases). It uses the preinstalled `gh` CLI rather than a third-party action, and the version input is validated before use. Wails v2.17.0 is pinned. LibreOffice-based Office verification and the search-model scenario (`m6b`, needs the 206 MB model) stay local-only to keep CI fast and offline-friendly.
  - **Windows:** our own setup program (`cmd/setup`, M41; replaced the customised NSIS installer, still in git history). **"Open supported files with Monoform by default" is unchecked**; the app always registers under `Applications\monoform.exe\SupportedTypes` and each type's `OpenWithProgids`, so it shows in *Open with*. Defaults that are taken are backed up (`<ProgID>_backup`) and given back on uninstall. Desktop shortcut is opt-in too. Executable and setup use `monoform` (no spaces). Also a portable zip.
  - **macOS:** universal `.app` (zipped with `ditto`), bundle id `dev.monoform.app`, `CFBundleDocumentTypes` from `wails.json` with **`LSHandlerRank` = `Alternate`** — listed in *Open With*, never made default automatically (macOS has no installer step to ask). Unsigned: signing/notarization needs an Apple Developer account.
  - **Linux:** tarball with the binary, icon, a `.desktop` file declaring the MIME types (validated with `desktop-file-validate`) and `install.sh` (per-user, no root; `--set-default` opts in to `xdg-mime default`, `--uninstall`). No `.deb`/AppImage/Flatpak in v1: the WebKitGTK 4.1 dependency is better satisfied by the distro, and AppImage bundling of WebKitGTK is fragile.
  - **One document icon form for every type** (text, Markdown, data, tables, PDF, pictures, vector, Word, archives,
    checksums, web pages, audio, video, 3D): the cream page (the logo's colour), one rounded tile in the same place and
    size with the type's symbol in cream, and the M in the corner — only the tile colour and the symbol differ. Symbols
    are Lucide icons (ISC, the app's own icon set), so they share stroke weight and size; the first version mixed
    hand-drawn filled, outlined and lettered symbols and looked like four different sets. `scripts/icons.py` writes the
    SVG sources (`build/icon/`), PNGs for Wails/macOS (`build/file-*.png`) and `.ico` files where **each size is
    rendered on its own** (16–256 px; the M is left out at 16–24 px), with the Playwright Chromium headless shell.
    `wails.json` names each type's icon; the setup installs them and points each file class's `DefaultIcon` at its icon.
  - **The app icon is the logo's M on its dark tile, filling it** (1.3×, 1.42× at 16–32 px), so it holds its own next
    to other apps on the Windows taskbar.
  - **Pictures opened from Explorer open in a quick view** (`--peek`), like the system photo viewer: just the picture, no session, sidebar or panels. *Edit* (or *Edit with Monoform* on right-click) hands it to the full editor. Quick views run without the single-instance lock, so a running editor isn't taken over and several pictures can be open; *Edit* starts the app with the file, which a running main window takes over, and closes the quick view (it replaced resizing the peek window in place, which would have left a second main window).
  - The same 48 extensions (documents, images, archives, checksums, web pages, audio, video, 3D models) are listed in `wails.json` (the setup's list is generated from it: `go generate ./internal/setup`, checked by a test) and the `.desktop` MIME list.

- **New files come from Go templates** (`internal/newfile`): Markdown starts with the file name as a heading; Word documents reuse the minimal package (with Normal/Heading 1–3 styles) that legacy `.doc` conversion writes; spreadsheets are excelize's empty workbook; images are PNGs up to 8192 px per side. Creation is exclusive (`O_EXCL` or an existence check), so nothing is overwritten. With a folder open, files go into it with a free "Untitled N" name; otherwise a save dialog asks where.
- **Recents can be turned off** (`recentsOff`); turning it off also clears both lists, and Go's settings normalization enforces that. Removing single entries is an × on hover (sidebar, welcome page, settings) besides the existing context-menu item.

- **Image editor v2 is a layered Konva document** (`modules/image/editor.ts`): each layer is a group with a raster canvas and editable markup; its transform moves/rotates/scales the layer. Pixel operations first *bake* the layer (render transform + markup into a document-sized canvas), so filters, brushes and masks always work in document coordinates; rasters are immutable once in history (snapshots share them; history is capped at 40 states / 160 M pixels). Layer opacity with markup uses a Konva cache so overlapping shapes don't double-blend.
- **Selections are document-sized alpha masks** (`selection.ts`); rectangle/ellipse/lasso keep their vector path for crisp marching ants, mask selections (wand, object, subject, inverted) get an edge outline computed in the worker and drawn in *difference* mode so it shows on any colour. Effects restricted to a selection use `out = src·(1−mask) + processed·mask`.
- **Copy goes to the system clipboard** with `navigator.clipboard.write` (PNG with alpha) — verified with a real keypress in WebKitGTK; the PNG is passed as a promise so the write starts within the key gesture. Paste reads the system clipboard and falls back to the last in-app copy (placed at its original position).
- **Adjustments run in WebGL2** (`adjust.ts`) because canvas `filter` isn't supported in WebKitGTK and per-pixel JS would freeze on big photos: the source is uploaded once; each slider change re-renders in milliseconds; blur/sharpen use separable Gaussian passes in framebuffers (premultiplied so transparency doesn't bleed). Apply copies the GL result into a new raster.
- **Smart selection and background removal use small bundled models in a worker** (`vision/visionWorker.ts`, onnxruntime-web WASM, started on use and stopped after 60 s idle): **U²-Netp** (Apache-2.0, 4.6 MB) for background removal / "select subject"; **EfficientSAM-Ti** (Apache-2.0, matrix weights quantized, 14 MB; was SlimSAM-77, see below) for click-to-select objects (Shift-click adds, Alt-click excludes; one analysis per image version, started when the tool is chosen, then ~0.3–0.8 s per click). Candidates rejected: RMBG-1.4/2.0 (non-commercial licences), the ISNet ONNX export (tagged AGPL), BiRefNet-lite (MIT, but its fixed 1024 px input exceeds the 4 GB WebAssembly memory limit). The models are under 20 MB together, so they are bundled (offline, no consent step) as lazily fetched assets — loaded only when used. Sources, revisions and checksums: `modules/image/models/README.md`.
- **Click-to-select is EfficientSAM-Ti, not SlimSAM-77** (after the README's shuttle cut-out came out with cloud
  bits and a missing wing). Measured on three photos (the shuttle over clouds, the STS-135 launch, the astronaut
  portrait) against SlimSAM-50, MobileSAM, EfficientSAM-Ti and SAM 2.1 tiny (all permissive, all with ONNX
  exports): SAM 2.1 tiny and EfficientSAM-Ti gave the cleanest masks (whole tail boom and pods, just the orbiter
  for a click on it), MobileSAM and both SlimSAMs broke thin parts or grew into the stack and its flame.
  EfficientSAM-Ti with its matrix weights in 8 bits (`scripts/efficientsam.py`) is as small as SlimSAM-77 was
  (14 MB) with masks identical to the float model; SAM 2.1 tiny would be 61 MB. One-thread analysis, native ONNX
  Runtime: SlimSAM-77 12 s, EfficientSAM-Ti 2.8 s, MobileSAM 1.4 s, SAM 2.1 tiny 3.7 s. In the app's WebAssembly
  runtime (one thread) EfficientSAM-Ti takes ~15 s against SlimSAM-77's ~21 s (WebAssembly is ~5× slower on its
  attention layers; the float encoder is no faster), so the analysis now starts as soon as the Select-object tool
  is chosen, and a click meanwhile waits for it instead of starting another. Not done yet: running the analysis
  in the optional native runtime when an AI pack is installed (~1 s), and multi-threaded WebAssembly (needs
  cross-origin isolation, which every embedded preview would have to follow).
- **A click selects the whole object, not its most "confident" part** (`vision/pick.ts`, unit-tested). SAM answers
  a click with three masks (part / larger part / whole) and a predicted score each, and scores small parts
  highest, so taking the top score selected a badge on a suit or just a face — "select object worked poorly on
  people". A mask at least 1.5× larger is preferred while its score is ≥ 0.5 (EfficientSAM scores whole objects
  0.5–0.7) and it covers < 30 % of the image border (otherwise it is background, and the user probably clicked the
  thing itself). A larger whole scored lower still (the person behind a click on the face: 0.05) gets a second
  look: the model is asked again with the click plus the point deepest inside that mask, and the mask is taken
  if the answer matches it (IoU ≥ 0.85) with a score ≥ 0.75. That confirms the person for a face, the shuttle
  for a click on its engines, and turns down a cloud field around a cloud or the launch plume added to the
  orbiter (no score threshold separates those: 0.09–0.12 against 0.05). It costs one more decoder run (~0.3 s).
  With Alt-click exclusions the top score is kept: the user is steering. Measured on a portrait (m9): a click on
  the face gives the whole person, on the suit the whole suit; disc/square tests unchanged.
  "Select subject" stays on U²-Netp: refining it with SAM prompted from the saliency map dropped the flag but also
  the cameraman's tripod, so not clearly better. A bigger person model (U²-Net human-seg 176 MB, MODNet) was
  considered and left out for size.
- **Model masks are snapped to the pixels** (`vision/refine.ts`, unit-tested): the SAM mask grid is 256 px and U²-Netp's 320 px, so upscaled they are soft and a few pixels off (halos around hair, background slivers). Within ~1.5–2 model pixels of the coarse edge (and wherever the model is unsure), each pixel is re-decided from the image: mean foreground/background colours come from the confidently inside/outside pixels around it (box filters over a 2×band window) and alpha is the pixel's position between them (a local colour-line matting step, falling back to the model where inside and outside look alike). A guided filter then removes speckle; its guide is the colour projected on that local inside→outside axis, because a luminance guide blurs edges between colours of equal brightness (red on blue). This runs at up to 2048 px (larger images get the result upscaled) and only over the band's bounding box — ~0.4 s worst case at 2048 px in the worker. On the test disc the object mask now matches the true edge exactly (was ±1–2 px and soft). Considered: a dense CRF or closed-form matting (much slower per click), a larger model (memory limit, see above).
  **Object selection no longer re-decides pixels by colour** (`snapMask`): on photos the colour step took white
  cloud next to a white shuttle for shuttle and dark parts of it for sky, so cut-outs came out speckled and
  bitten. Now a colour guided filter (He et al., 3×3 colour covariance per window, radius ~0.6 mask cells) only
  pulls the model's own edge onto the nearest colour edge; nothing far from it changes. On the m9 disc it is
  still pixel-exact (0 wrong pixels); on the shuttle the cloud bits and holes are gone. "Select subject" keeps
  refineMask for now.
- **Canvas bounds are always visible**: outside the document is a plain pasteboard colour; the document gets the transparency checkerboard (screen-sized squares), a 1 px edge and faint rings for depth, drawn by one Konva shape in screen coordinates (`drawBackdrop`). Before, the whole area was checkered, so transparent pixels and "outside the canvas" looked the same. A canvas `shadowBlur` was tried and dropped: on the software-rendered VM it doubled the worst UI frame during mask operations.
- **Shapes**: holding Ctrl/Cmd while dragging keeps rectangles/selections/crop square and ellipses round (Shift too for rectangle/ellipse markup, since Shift already means "add" for selections). Rectangles have a corner radius option (0 = sharp, default) that also edits a selected rectangle. Every tool's tooltip says how to use it.
- **Blur kinds are one extra GPU pass** in the adjustments pipeline (`adjust.ts`, `FX` shader): motion (taps along a line), zoom (towards a centre), spin (along an arc), lens (golden-angle disc with highlight weighting for bokeh), surface (bilateral weights, keeps edges); tilt-shift reuses the Gaussian and mixes it in by distance from a sharp band. Tap counts follow the blur's reach (capped at 128–160) so streaks don't break into dots. Being adjustments, they preview live, apply only inside the selection (mask mix in the main shader) and stay undoable. Painting with a selection draws the stroke on its own canvas and recomposes only the touched rectangle through the mask, so the brush never leaks outside even mid-stroke.
- **Magic wand** is a scanline flood fill (or global colour match) in the same worker, tolerance per channel incl. alpha.
- **Video edits are made visible where they happen**: the timeline is the only place a cut exists before saving, so selection, removal and restore all live on it (frame + handles + dimmed outside; red flash on the newly removed part computed as new gaps minus old gaps; per-gap restore button) instead of in dialogs; a toast with Undo reports the length change.
- **Model and runtime files are fetched in 4 MB Range pieces** (`core/ortwasm.ts`, `fetchbytes.ts`) in both ONNX workers: Wails' asset server supports Range, and single large responses cost WebKitGTK main-thread time even when a worker fetches them (measured: worst UI frame during first background removal 128 → 68 ms).
- **Fonts**: bundled Inter and Source Serif 4 plus whichever of ~60 common system fonts are installed — detected by measuring text against generic fallbacks, because `document.fonts.check()` returns true for missing fonts.
- **Free rotation** rotates every layer about the centre; "Enlarge canvas" (default) grows the canvas to the rotated bounds with transparent corners, otherwise it keeps the size and crops.
- **Saving**: flat formats merge visible layers (a one-time note mentions .ora); JPEG/BMP flatten transparency onto white in Go. **Save a copy** writes `name (edited).ext` next to the original and continues editing the copy; the "keep originals" setting makes plain Save do that for the first save of an opened image. **Layers are saved as OpenRaster (.ora)** — an open zip of PNG layers + `stack.xml` that GIMP, Krita and MyPaint read; we zip it ourselves in a worker (stored entries, `mimetype` first as the spec requires). Markup is rasterised into each layer for other apps and also kept as Konva JSON in a namespaced attribute plus a markup-free raster (`data/raw<i>.png`), so Monoform reopens text and shapes editable.

- **Visual SVG editing patches the source instead of serialising a DOM** (`modules/svg/svgdoc.ts`, unit-tested): a small XML scanner records every element's start tag, attributes (with value offsets) and extent, in document order — the same order as DOMParser's `getElementsByTagName('*')`, which is how canvas elements (tagged `data-mf-i`) map back to text. A move becomes one `transform` attribute (merged into the existing transform as a matrix, printed as `translate(…)` when it is one), a colour one `fill`/`stroke` (or the `style` property when that's where it is set), a new shape one appended line. XMLSerializer would have rewritten quoting, namespaces and whitespace on every change; patching keeps diffs minimal, keeps comments and formatting, and lets CodeMirror's history be the single undo stack for both views. The canvas is a sanitized inline copy (scripts and foreignObject emptied, `on*` attributes, non-local `href`s and outside `url()`s removed, on top of the page CSP that already blocks scripts and remote loads); dragging previews on that copy and commits once on release. WebKit's `getScreenCTM` for the absolutely positioned root is cross-checked against its client rect (preserveAspectRatio "meet") before mapping pointer positions. Inkscape-style click selection (top-level shape first, deeper on repeated clicks) because SVG files are deeply grouped.
- **The design canvas is rebuilt only when the text changes**, and that effect tracks nothing else (`untrack`):
  rebuilding also fits and places the view, and when those reads were tracked the effect re-ran itself until Svelte
  stopped it after ~1000 runs — invisible on small drawings, half a minute frozen on a CAD export (and again after
  every edit). The first build waits a frame so "Opening the drawing…" shows; it fades in after 150 ms, so small
  drawings never flash it. **Zooming scales the drawn picture** with a CSS transform and lays the SVG out at the new
  size 180 ms after the last step (or at once when a drag starts, since pointer mapping uses the laid-out drawing):
  re-laying-out a big drawing on every wheel step cost ~130 ms a frame.
- **SVG files have their own module** (source + preview like Markdown) instead of the image viewer. The preview loads the edited text as a blob URL in an `<img>`: browsers render SVG images without scripts or external fetches, so a hostile SVG can't do anything. Size comes from width/height or the viewBox. PNG export rasterises the same image at the chosen size (up to 16384 px per side).
- **HTML preview: sandboxed iframe + injected CSP + scoped folder route.** The document is rebuilt with DOMParser (which executes nothing): we prepend a CSP meta tag and a `<base>` for the folder route, remove the page's own `<base>`, and disable external links (followed only via "Open in browser"). The iframe is `sandbox=""` by default and `sandbox="allow-scripts"` when the user enables scripts — never `allow-same-origin`, so page scripts run in an opaque origin with no access to the app, its token or other files. The CSP allows only the app origin, data: and blob: (plus http/https when "Remote content" is on), `connect-src 'none'` unless both scripts and remote content are on, and `form-action 'none'`.
- **Relative resources come from `/__mf/page/<token>/…`**, a read-only route whose random token maps to one folder (the HTML file's) and is distinct from the session token; files are opened through `os.Root`, so `..`, encoded traversal and symlinks can't leave the folder (unit-tested). It serves standard web MIME types (the app-wide table treats .html/.css/.js as text) and adds the same CSP to HTML/SVG it serves directly (pages reached through relative links).

- **3D uses three.js** (MIT) and its official example loaders — the only mature permissive option covering glTF, FBX, OBJ, STL, PLY, 3MF, Collada, 3DS, USD, VRML, AMF, PCD, XYZ and VTK in one place. It is a lazily loaded chunk; nothing 3D is in the entry bundle.
- **Models are parsed in a worker** (`model3d/loadWorker.ts`) and the result is sent back as plain data — geometry buffers and texture pixels are *transferred* (zero-copy), then the scene, skins and animation clips are rebuilt on the main thread (`transfer.ts`). Collada, 3MF, AMF and VTP loaders need `DOMParser`, which workers lack, so those four parse on the main thread. Textures are decoded in the worker and read back to RGBA there (2D `OffscreenCanvas`), because WebKitGTK's WebGL uploads `ImageBitmap`s as garbage (verified: the bitmap's pixels were right, the rendered texture wasn't).
- **Relative resources** (.bin buffers, textures, .mtl) are fetched through the same read-only, folder-scoped page route as HTML previews; a URL modifier rewrites anything absolute outside that route to a blocked path, so a model can't make the app fetch from the network or elsewhere on disk. The Draco decoder (Apache-2.0, `three/examples/jsm/libs/draco`, copied to `dist/three/draco/`) is an app file and loads outside that guard; it runs in its own worker nested in the load worker.
- **Lighting**: a key directional light, a hemisphere fill and, for PBR materials, a reflection environment. The environment is three's `RoomEnvironment` pre-filtered by PMREM, **baked once and committed as `room-env.bin`** (688 KB of half floats, regenerated by the `bakeenv` self-test) and uploaded as a `CubeUVReflectionMapping` texture: running PMREM at runtime compiles shaders that blocked the main thread for 0.5–0.6 s on software GL. "Lighting off" swaps materials for unlit `MeshBasicMaterial` copies that keep colour, texture, transparency and vertex colours.
- **STL, 3MF and AMF are turned Z-up → Y-up**: CAD and 3D-printing tools put Z up (the 3MF and AMF specs say so; STL has no axis but is written that way), while three.js and glTF use Y up, so without the turn a printable model lies on its side. OBJ, PLY and the scene formats keep their own axes.
- **The floor grid is one plane drawn by a shader** (`model3d/grid.ts`), not `THREE.GridHelper`: the helper's line segments reach past the camera, and software OpenGL (llvmpipe — virtual machines, computers without GPU drivers) rasterises lines clipped behind the camera as stray grey triangles. Triangles are clipped correctly everywhere, so a plane whose shader draws one-pixel lines (fwidth) and fades them out around the model has no such artefacts.
- **One WebGL renderer is shared by all 3D tabs** and its canvas moves to the visible tab (each tab keeps its own scene, camera and controls; orbit controls are connected only on the visible one). Context creation, shader compilation and the environment upload then happen once per session (first open ~0.5 s with one ~100 ms frame on the VM, later opens ≤ 55 ms frames), and many open models hold one GPU context (browsers cap them at ~16). The renderer is released 60 s after the last 3D tab closes. Frames render only while the camera moves or an animation plays, and stop while the tab is hidden.
- **Animations**: glTF clips, FBX animation stacks and Collada animations are listed by name; one `AnimationMixer` per model, one clip at a time.

- **Audio and video play through a loopback media server** (`internal/media`). Media elements can't load from the app's `wails://` scheme on WebKitGTK (verified: MEDIA_ERR_SRC_NOT_SUPPORTED even for WAV, while the same bytes play from a blob) and WKWebView has the same custom-scheme limitation; blob URLs would need whole files in memory. So Go serves registered files on `127.0.0.1:<random port>` — loopback only, started on first use, each file under its own unguessable token, read-only, Range for seeking, Host header checked (DNS rebinding), CORS only for the app's own origins (so WebAudio can shape the preview). The page CSP gains `media-src http://127.0.0.1:*`. Nothing leaves the machine.
- **Audio editing is non-destructive** (`modules/audio/edits.ts`): the edited file is a list of segments (source frame ranges or silence, each with gain ramps). Every edit is a pure function on that list, undo keeps old lists, and the waveform is drawn through it, so edits are instant at any file length. Preview plays the source `<audio>` element, seeking over cuts and shaping fades with a WebAudio gain node. Saving sends the list to Go, which decodes, applies it sample-exactly and encodes in one streaming pass (`internal/audio`), atomically replacing the file (temp file + rename).
- **Pure-Go codecs, no cgo:** decoding with `hajimehoshi/go-mp3` (Apache-2.0), `mewkiz/flac` (Unlicense), `jfreymuth/oggvorbis` (MIT) and our own WAV reader; encoding WAV (ours, TPDF dither only for samples that changed, so untouched 16-bit audio stays bit-exact) and FLAC (`mewkiz/flac`, fixed-predictor + Rice, lossless-verified in tests); tags and cover via `dhowden/tag` (BSD-2), carried into FLAC (Vorbis comments + picture) and WAV (RIFF INFO). **There is no permissively licensed MP3 encoder** (LAME is LGPL, shine is GPL/LGPL) — so MP3 files are saved as MP3 only after cuts, by copying whole frames (no quality loss, cut points snap to ~26 ms frames, Xing frame dropped, ID3 tags kept); fades/volume changes on an MP3 save as FLAC or WAV. The OS's WebCodecs encoders (MP3 and Opus exist on Linux) differ by platform, so they aren't relied on.
- **Waveform peaks** (min/max per 256 frames, per channel) are computed by Go in the background and polled by the module (`/__mf/audio/peaks?from=`), so the file plays immediately and the waveform fills left to right. Long files are split into chunks decoded on all cores and emitted in order (MP3 4× faster); FLAC stays sequential because its first seek in a file without a seek table scans the whole file. MP3 seeks decode 10 frames early and drop them (bit reservoir and filter state), so chunk edges are exact.
- **Formats the Go decoders can't read** (Opus, AAC/M4A, WebM audio, AIFF) open as play-only with tags and cover (where `dhowden/tag` reads them); whether they play depends on the system's media stack (GStreamer on Linux has no AAC by default).

- **Databases: SQLite files through modernc.org/sqlite** (`internal/db`, Go-tested): pure Go (C translated to Go), so no cgo and the same behaviour on every platform; +3.8 MB to the stripped binary and nothing at startup. Server databases (PostgreSQL, MySQL) aren't offered: they mean network connections (the app makes none) and the common MySQL driver is MPL-2.0. One connection per open file (so a transaction and temp tables stay together), `foreign_keys` on, 3 s busy timeout; files that can't be written open read-only. Rows are paged from Go in 200-row blocks into the spreadsheet grid (the CSV grid, with a row source), so a 100k-row table costs what's on screen. Edits are pending until Save, which writes them in one transaction (updates by rowid, inserts, deletes) — a constraint failure rolls everything back and keeps the edits pending with the database's message; tables without rowid and views are edited through SQL. The SQL console splits scripts at semicolons outside quotes, comments and trigger bodies, runs statements in order, stops at the first error and caps result rows at 1000; it loads on first use. Values keep their kind: NULL (typed as NULL), REAL shown with a decimal point, blobs summarised.
- **Sublime-style editing is a thin layer over CodeMirror** (`modules/text/editing.ts`, `minimap.ts`): the commands are plain state commands (unit-tested on EditorStates), bound in a high-precedence keymap so they win over CodeMirror's own bindings where Sublime differs, and listed in the palette with their keys. The minimap is a canvas drawing only the lines that fit (≈ 3 px a line, the visible part boxed) in syntax colours taken from the theme variables through a `tagHighlighter`, redrawn at most once per frame — cost doesn't grow with the file. Go to symbol walks the Lezer tree for declaration nodes (one regex over node names covers the bundled languages) and Markdown headings. Word completion is CodeMirror's `completeAnyWord` added as language data, so language completions still come first. Minimap, completion, bracket closing and indent guides sit in the "heavy" compartment that files over 8 MB skip.
- **Split view is a layout of the existing tab views** (`core/split.ts`, unit-tested): tabs already stay mounted, so a split only positions up to four `TabView`s (percent rects from the layout and two divider positions) instead of hiding all but one. "Active tab" becomes "focused pane", so every command, shortcut and the status bar keep working unchanged; showing a tab from the tab bar replaces the focused pane, as in Zen. Modules get `onShow` when their pane appears or changes size. The 3D viewer's single shared WebGL renderer (one context for all 3D tabs) moves to the focused pane and leaves a still image behind. Drop zones appear only while a tab (custom drag type) is dragged, so file drops into modules are unaffected. Persisted as pane indices in the session (Go validates layout, indices, divider range).
- **Interface size scales design tokens, not the page**: CSS `zoom` on the root was tried first and broke pointer maths in the canvas editors (a Ctrl-dragged 60 px square came out 48 px at 125 %, grid drags hit the wrong cells), and only WebView2 exposes a native zoom factor (Linux would need cgo). Instead `--ui-scale` multiplies the size tokens and every `font-size` (converted mechanically), the shell's control and bar sizes, icon sizes (Icon.svelte) and the editor font; virtual lists take their row height from JS and hand it to CSS (`--row`), so scrolling maths match.
- **Video effects render through WebCodecs to WebM** (`modules/video/render.ts`), only when there are effects; plain cuts keep the lossless remux below. VP9/VP8 + Opus/Vorbis are the encoders every webview has (WebKitGTK has no H.264 encoder), and WebM needs no licensed codec; the muxer is ours (`webm.ts`, EBML, SimpleBlocks, clusters at keyframes, Cues + SeekHead). Decoding: Go indexes the samples (`internal/video/demux.go`: WebCodecs codec strings from avcC/vpcC/av1C/esds/CodecPrivate, per-sample offset/size, Matroska lacing) and the webview reads them through the app's `/__mf/file` route in 4 MB Range reads — the page's CSP `connect-src` doesn't include the loopback media server (only media elements load from it). WebKitGTK's WebCodecs decoders need GStreamer parsers from gst-plugins-bad; where they're missing, frames come from seeking a hidden `<video>` (slower, same result) and audio from WebAudio `decodeAudioData`; the failure is remembered for the session. One WebGL2 compositor (`compositor.ts`) draws both the live preview (over the playing `<video>`, which is hidden while effects exist) and every rendered frame, so what you see is what is written: rotation, image overlays (alpha-blended quads), area blurs (feathered rect/ellipse mask; Vogel-disc, line or radial taps, pixelate), transitions (crossfade, wipe, slide, zoom, dip) and fades. Time model (`project.ts`): overlays and speeds live in source seconds, so they stay attached to what they cover when other parts are cut; kept parts are laid out on the output timeline with speeds stretching them and overlapping transitions pulling the next part earlier. Keyframes interpolate with per-key easing (CSS-style cubic-Bézier solved by bisection, plus bounce and hold) along straight or Catmull-Rom paths. Audio: decoded per part on the main thread, then stretched without changing pitch (WSOLA, `stretch.ts`) and mixed with transition ramps and fades in a worker (`mix.ts`). Tracking (`track.ts`, in a worker): normalized cross-correlation of a template from a ≤ 320 px grey copy, exhaustive search around a velocity prediction, sub-pixel parabola fit, slow template update, and a small distance penalty so plain edges don't make it slide (the aperture problem). Considered: ffmpeg.wasm (LGPL/GPL builds, ~25 MB, slow), MediaRecorder of a canvas (real-time only, no control over timestamps or keyframes), mp4-muxer/webm-muxer packages (MIT, but a small EBML writer was less code than adapting them).
- **Video editing is lossless remuxing in Go** (`internal/video`), never re-encoding: there is no permissively licensed H.264/HEVC encoder in pure Go (x264/x265/ffmpeg are GPL/LGPL and need cgo), and WebCodecs encoders differ by platform (WebKitGTK offers VP8/VP9 only, WebView2 adds H.264, WKWebView differs again), so a re-encode path couldn't behave the same everywhere. Remuxing is also what a "light" editor needs to be fast: saving a 2-hour file is a copy, not a render. The trade-off — cuts land on keyframes — is made visible: the timeline shows the snapped ranges and a hint explains it; a keyframe within 50 ms of a cut point is taken as the cut point.
  - **MP4/MOV** with `Eyevinn/mp4ff` (MIT): the sample tables of each track are flattened, the kept samples are chosen (video by whole GOPs, audio by time and re-aligned to the video at every range start), sample tables (stts/ctts/stss/stsz/stsc/stco or co64) and edit lists are rebuilt, and samples are copied in 0.5 s interleaved chunks with `moov` before `mdat` (fast start). Rotation is the track matrix; muting/extracting drops tracks. Fragmented MP4 is refused for now.
  - **WebM/MKV** with our own ~600-line EBML reader/writer: block headers are indexed without reading payloads (unknown-size segments/clusters from browser recorders are handled), kept blocks are copied with only their 2-byte relative timestamp patched, clusters are rebuilt, and Cues + SeekHead are written so the result seeks well. Chapters are dropped (their times would be wrong); tags and attachments are kept.
  - Every output is checked in tests by our own prober and, when available, decoded by ffmpeg with no errors and exact frame counts.
- **The video module plays through the same loopback media server as audio**, with `crossorigin` so frames can be drawn to a canvas (thumbnail strip from a second, hidden `<video>` seeking ~20 positions; PNG snapshots). Cut parts are skipped during playback by watching `currentTime` each frame.
- **STEP files are read and tessellated by our own code** (`modules/model3d/step/`, in the 3D load worker): there
  is no permissively licensed STEP kernel — OpenCASCADE (and opencascade.js, occt-import-js) is LGPL, and the
  other readers wrap it. A viewer needs far less than a kernel: `p21.ts` parses ISO 10303-21 (simple and complex
  instances, string escapes), `geom.ts` evaluates the B-rep curves and surfaces (lines, circles, ellipses,
  B-splines incl. rational, pcurves; planes, cylinders, cones, spheres, tori, B-spline / revolved / extruded /
  offset surfaces) and maps points back to (u, v) (exact for the analytic kinds, sampled guess + Newton for the
  others), and `tess.ts` triangulates each face in its (u, v) parameters. Each edge is sampled once and shared by
  the faces on both sides, so the mesh is watertight. Periodic faces are cut open along a seam sampled on the
  surface (a single straight cut would chord through a sphere), loops round the surface become a band or are
  closed at the pole on the face's side (from the loop's orientation). Curved faces get grid points inside, ear
  clipping (three's earcut, the inner points as Steiner points) then Delaunay edge flips — ear clipping alone
  joins three neighbouring boundary samples of a circle into a triangle across the cap — and edges whose
  midpoints leave the surface or whose normals turn more than 20° are split. A tiny warp keeps boundary samples on
  one (u, v) line from being dropped as collinear. The product structure is kept: representations linked without
  a transformation are one group, `REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION` and `MAPPED_ITEM` place child
  groups (the next-assembly-usage tells the assembly side), each part is built once and its geometry shared by
  its instances; shape aspects and other property representations aren't drawn again. Colours come from styled
  items (face over shell over solid). The STEP code is imported statically by `load.ts`: a chunk split off from
  the worker imports the worker's own entry again, a second three.js whose `Color` the transfer code doesn't
  recognise (colours came out white).

## Look & feel

- **Darker palette than the brief's starting tokens** (user request): dark `--bg #1f1e1c`, sidebar `#181716`; light `--bg #f6f4ee`.
- **Accent: warm terracotta** (`#d97757` dark / `#c15f3c` light) for focus rings, selection and progress — the only saturated colour.
- **Fonts via `@fontsource-variable/*`** (OFL), variable weight axis only, bundled as woff2 assets (not in the JS bundle). Unicode-range subsets mean only Latin loads for Latin text.
- **Icons: `@lucide/svelte`** with deep imports and stroke width 1.6.
- **Toolbars fit their pane, not the window** (`core/fit.ts`, `use:fitBar`). Panes can be ~300 px wide (2×2 split,
  sidebar open), so media queries on the window can't decide; each bar measures itself (ResizeObserver, one forced
  layout per frame, text changes rechecked at most 5×/s). Order of fallbacks: full labels → icons only (name in
  the tooltip, `aria-label` kept) → wrap onto more rows. Hiding things behind a "…" menu was rejected: it moves
  buttons people know where to find, and wrapping keeps every control one click away. Controls in a bar keep
  their natural width (`flex-shrink: 0`) so a bar that doesn't fit is detected instead of quietly squeezing text;
  only search fields give (down to 120 px). Every toolbar button with text also has an icon, so it can shrink.
- **The app menu is laid out, not generated flat** (`core/appMenu.ts`). A fixed layout puts the everyday actions
  on top and the rest in submenus; it is still built from the command registry each time it opens, so
  unavailable commands disappear and empty groups with them, and any command the layout doesn't name lands in a
  submenu for its category (the open file type's commands, before Tools). Long per-type lists (> 14) split off
  "Tool: …" commands and editing / viewing ones by title. Rejected: separate windows for groups of commands —
  the command palette (Ctrl+K) already finds any command by name, and Settings already is a tab.
- **Start-page and welcome icons are neutral** (`--bg-hover` badge, `--text-muted` stroke): per-type hues
  (green spreadsheet, blue document…) clashed with the single-accent palette. Type stays readable from the icon
  shape and the label.
- **First-run welcome is a 4-step overlay, not a separate window or a start-page banner** (`shell/FirstRun.svelte`,
  loaded only when shown). It shows only when nothing was asked of the app yet: not with launch files, in quick
  peek, or in self-tests (`core/firstrun.ts`). The step that matters is the theme choice; everything else is
  skippable in one click. `welcomeDone` lives in the Go settings so a reinstall that keeps settings doesn't show it again.
- **New video overlays and blurs span the whole clip** (or the selection). They used to cover 5 s from the
  playhead, which read as "the blur stops working" while playing; shortening one is a drag in its track or
  Start here / End here.
- **Video masks are one `Mask` view over both layer kinds** (`maskOf`/`withMask` in `video/project.ts`): blurs keep
  their area in `blur` (shape, feather, invert, points — older projects stay valid), image overlays in `mask`.
  The compositor evaluates it per pixel in the layer's own box (so it follows move/scale/rotation and tracking):
  rectangle and ellipse by distance, freeform by an even-odd inside test plus distance to the nearest edge for the
  soft edge, over up to 64 points in a uniform array (`MAX_POINTS`). A drawn outline is simplified with
  Ramer–Douglas–Peucker and becomes the box; every key shifts with the box centre so animation is kept.
- **Image layer masks are separate canvases, never baked until asked** (`editor.ts`). Shown pixels = raster ∘ mask
  (`destination-in`), cached per (raster, mask) pair and recomposed only in the brush segment's rectangle while
  painting (≈ 4 ms per stroke on the VM). A masked layer with markup is drawn as a cached group with the mask as a
  last `destination-in` node, so text and shapes are masked like pixels. Baking (transforms, pixel operations)
  renders the mask through the same transform, so it stays aligned. Brush hides / eraser shows by default
  (the brush covering things up matches "paint it out"); X swaps. In `.ora` the layer PNG has the mask applied
  (what GIMP/Krita show); `mf:raw` and `mf:mask` entries keep both parts for us — OpenRaster has no masks.
- **Tabs drag with pointer events, not HTML drag and drop.** HTML DnD inside a webview behaves differently per
  engine (WebView2 with file drop enabled, WebKitGTK, WKWebView) and can't tell "dropped outside the window" from
  "cancelled". With the pointer captured after a 6 px threshold, moves keep arriving outside the window, so one
  gesture covers reorder (the tab bar ± 16 px), split (over the views; the split overlay reads `tabDrag`) and tear-off
  (outside). Text selection is prevented on press, otherwise the native selection sweeps across editors.
- **A torn-off tab becomes a second process** (`App.NewWindow`: the same executable with `--new-window --at=X,Y
  <file>`). Wails v2 has one window per process; v3's multi-window API is still alpha. That process skips the
  single-instance lock (so files opened from the OS still go to the main window), doesn't restore or persist the
  session, doesn't run the search-by-meaning indexer (one writer per index), and when it saves settings it keeps
  the session that is on disk (`keepSession`). Moving unsaved changes across processes was rejected in favour of
  "save first" (no half-written temp state). New windows are 1100×720, placed under the pointer and clamped to the
  screen. Rejected: dragging tabs between windows (needs cross-process drag state; for now the new window has its
  own tabs and Open). The "+" opens a start-page tab (module `start`) that is replaced by what is opened from it,
  like a browser's new tab.
- **One transfer model between editors** (`core/transfer.svelte.ts`): a `Transfer` is a picture (canvas + name),
  text or file paths. A tab declares `handlers.accept` (kinds + take at an optional window point) and
  `handlers.give`; the app clipboard, the drag and HTML/OS drops all end in `give(tab, transfer, point)`. Ctrl+C
  writes the system clipboard (PNG or text) and keeps the full transfer (names, paths) in the app; Ctrl+V reads the
  system clipboard first (it may hold something newer from another app) and falls back to the app's copy when the
  webview can't read it. Generic Copy/Paste commands are registered first, so editors with their own (image, audio,
  text fields) keep theirs. Drags use pointer events (as tabs do) from an explicit copy/drag button rather than
  dragging on the canvas, where a drag already means move/draw/select. Files dropped from the system still open as
  tabs unless the view claims them (`claimsDrop`: the image editor, for pictures), so dropping a PDF on an editor
  never inserts its path by surprise.
- **The Windows setup is the app's own program, not a stock installer** (M41, requested: "custom installer, not
  just a standard looking windows one"). `cmd/setup` is a small Wails window (580×440, frameless, the app's tokens
  and fonts; UI in `frontend/setup`) around `internal/setup`, which does what the NSIS script did: files, Start menu
  (and optional desktop) shortcut, the `monoform` shim in the per-user WindowsApps folder, *Open with* entries, the
  *Quick peek* verb, optional defaults with backup/restore, and the Settings › Apps entry. It installs **per user by
  default** (`%LOCALAPPDATA%\Programs\Monoform`, HKCU — no UAC prompt; the manifest says `asInvoker` so Windows'
  installer detection doesn't force one); *For everyone* re-runs itself elevated and quiet (`--quiet --everyone`) into
  Program Files/HKLM. The
  uninstaller is the setup itself (`uninstall.exe --uninstall`); since Windows can't delete a running program but
  can move it, it moves itself to %TEMP% before deleting the folder and is deleted after it exits; when %TEMP% is on another drive (a move isn't possible there) it removes everything but itself, and itself and the folder right after it exits (found by CI: its install folder is on D:). Shortcuts are
  written through PowerShell's WScript.Shell (a `.lnk` is a COM object; no cgo); the registry through
  `golang.org/x/sys/windows/registry` (BSD-3, already a dependency). The app's files are embedded gzipped
  (`cmd/setup/pack`). The setup's own UI needs WebView2: Wails' `-webview2 embed` bundles Microsoft's Evergreen
  bootstrapper (redistributable, as the NSIS installer did) and installs the runtime before the window opens. All
  steps go through a `System` interface, so tests (and a demo on Linux that installs into a test folder) use a
  recording implementation; CI also runs a quiet install/uninstall on a real Windows runner. Rejected: a custom
  NSIS skin (still NSIS pages and widgets), MSIX (signing required, no `monoform` on PATH, restricted registry).
- **Dark canvases use Excalidraw's dark-mode filter** (`invert(93%) hue-rotate(180deg)`, `core/canvas.ts`) instead
  of re-colouring the drawing: it's what Excalidraw itself does, works the same for Excalidraw, draw.io, Mermaid and
  Graphviz (one CSS filter on the drawing layer, GPU-composited, bounded by the viewport), keeps every hue
  recognisable, and leaves the file and exports untouched. Mermaid's own `dark` theme was rejected: it would need
  a re-render on every theme switch and does nothing for Graphviz or drawings. On the board the drawing and the
  selection overlay are separate `<svg>` layers so handles keep the accent colour; photos get the inverse filter
  (as in Excalidraw); the paper and the label editor's text colour are computed with the same matrix. Drawings whose
  background is already dark aren't filtered. Off with `lightCanvases` (Settings › Appearance or the toolbar).
- **Note links are indexed in Go, resolved in TypeScript** (`internal/notes`, `modules/markdown/links.ts`). Reading
  every note of a folder from the webview would be one request per file; Go walks the folder (same skips as folder
  search, plus `.obsidian`/`.trash`), parses notes in parallel and keeps them by size + modification time, so the
  index refreshed after each save only re-reads what changed (limits: 20,000 notes, 4 MB each). Resolution follows
  Obsidian: wiki links match by note name (folders written in the link as a path suffix), case-insensitively, the
  note sharing the most folders with the linking one winning; Markdown links are relative paths. The current note's
  own links, headings and counts come from its (unsaved) text in the preview worker, so typing never waits on disk.
  Link parsing exists in both languages and both test suites check the same cases. Embedding notes (`![[Note]]`
  transclusion), unlinked mentions, the graph view and aliases from front matter were left out for now.
- **Counts follow Obsidian**: words are runs of letters/digits (inner apostrophes, hyphens and dots keep one word),
  each Chinese/Japanese character is a word, characters are everything except line breaks (an emoji is one); in
  Markdown, front matter, link targets and heading/list marks aren't counted. Shown in the status bar (`counts`),
  with "N of M" for a selection.
- **Interface languages: English text as the key, catalogs per language** (`core/i18n.ts`, `src/locales/<lang>/*.json`,
  docs/TRANSLATING.md). gettext-style keys keep the code readable and need no separate key names; the catalogs are
  flat JSON per area, merged, loaded only for the chosen language (a lazy chunk; English loads none). Plurals follow
  `Intl.PluralRules` (Polish one/few/many). The language is fixed for the life of the window: `main.ts` loads it
  before importing the app (`app.ts`), so strings can be translated anywhere, even at module level, without making
  every label reactive; changing the language reloads the window (the session brings the tabs back; with unsaved
  changes it waits for the next start). The system language comes from Go (`internal/locale`: AppleLanguages on
  macOS, the Windows display language list, LANGUAGE/LC_*/LANG elsewhere), because webviews report it unreliably.
  Unit tests find every `t()` key statically and scan markup and code for untranslated text, so nothing new can
  slip through untranslated; `m47` checks the running app. Self-tests run in English (`MF_SYSTEM_LANG=en`). Not
  translated yet: error texts made in Go and in web workers (no catalog there).
- **Pasting into an empty tab makes a scratch document**: the content goes to a temp file and opens like any file
  of its kind, so every editor works on it unchanged; the tab carries `scratch` (its name), counts as unsaved, and
  isn't kept in the session. Its first Save asks where, lets the editor write its temp copy the way it always saves,
  then copies that into place and points the tab there (`Workspace.saveScratch`) — no editor needed changes. Text is
  classified by content (`core/pasteKind.ts`) rather than asked about.
- **AI tools always visible** in the image editor (greyed until downloaded) rather than appearing after a download:
  people learn they exist where they'd use them, and the click leads to the one place they are installed (Settings ›
  AI models, `core/settingsLink.ts` scrolls to and highlights the row). They are actions next to Select object, not
  new tool modes. The standard Select subject keeps the bundled model so the two can be compared.
- **Paint bucket reuses the magic wand's flood fill** (in the vision worker, so a large picture doesn't stall the
  window) on the active layer's pixels and fills through that mask with the same blend the selection tools use, so
  an active selection limits it like every other pixel edit. It samples the active layer only (like most editors'
  default); tolerance and contiguous are shared with the wand. The edge is hard (no anti-aliasing), as in a plain fill.
- **Watermark clean-up is two adjustments, not a model.** Watermarks on drawings, scans and documents are pale or
  one colour over dark content, so turning light pixels (by luminance, with a soft 0.06 ramp) or one colour (by the
  largest channel difference) white removes them and keeps the lines — including where they cross the mark, which
  inpainting tends to bend or break. They are part of the GPU adjustment shader (first, so the other sliders see a
  clean page): live preview, selection-limited and undoable for free. On photos, where the mark's pixels must be
  replaced by something plausible, the answer is the existing object removal (Moebius) on a selection painted with
  the new selection brush (a stroked mask; its outline comes from the vision worker). "Un-blending" a
  semi-transparent watermark of known colour and opacity was considered and left out: it needs both values exact,
  which a user can't read off a picture.
- **Plain backgrounds are removed by colour, not by a model** (`vision/plainbg.ts`, in the vision worker). The
  border decides: the median colour of the border pixels, if ≥ 85 % of them are within 11 % of it. Then GIMP-style
  colour-to-alpha (the least opacity that explains the pixel over that colour, and the colour that gives it), with a
  noise floor (6 %) and an opaque ceiling (80 %): plain colour-to-alpha leaves a red subject on grey partly
  see-through. The subject models are trained on photos and lose thin lines in drawings; colour is exact there and
  instant. "Everywhere" vs "from the border" (a flood through mostly-background pixels plus the one-pixel rim):
  drawings and documents need closed areas cleared, product shots need white parts kept; picked by how much of the
  picture is background (≥ 60 % → everywhere), with the other choice one click away in the toast.
- **Layer reordering by dragging the row** with pointer events (a 4 px threshold so a click still selects; the drop
  gap from row midpoints) rather than HTML drag and drop, which WebKitGTK draws with a ghost image and no control of
  the drop line; one `placeLayer` step, so a drag is one undo.
- **Word editing stays a mapping onto the original XML, not a new document model.** The page is HTML (contenteditable)
  whose blocks and runs point back at their w:p / w:r elements; saving rebuilds document.xml from the page and writes
  a property only where the page differs from what that element showed (fmtOfRPr / applyParagraphStyle are run on the
  original to know). So theme colours, character styles, fields, revisions' surroundings and anything the editor
  doesn't model stay byte-identical, and a file opened and saved unchanged keeps its formatting. Considered: a
  ProseMirror/Tiptap model (MIT) — a full schema would have to model or round-trip every WordprocessingML feature,
  which is far more code than the mapping and loses what it doesn't know.
- **Lists are paragraphs with a numbering instance and level, as in Word** (data-num-id / data-ilvl), not HTML
  ul/ol: Word's numbering continues across tables and headings and restarts by definition, which nested HTML lists
  can't express. Markers are computed for the whole page after each edit (docxNumbering.renumber, a single pass) and
  drawn with CSS (::before content: attr(data-marker)). New lists get one abstract definition per kind (bullet,
  number) added to numbering.xml; counting follows Word (lists sharing an abstract definition continue each other,
  start overrides apply at their first paragraph).
- **New package parts go through one Go path** (office.Part: numbering.xml, styles.xml, pictures, external hyperlink
  relationships): content type and relationship are added only when missing, ids are prefixed rIdMf…, part names are
  checked against `word/…` and link targets against http(s)/mailto/#.
- **Pasted HTML is rebuilt, not sanitised in place** (docPaste.cleanPaste): only paragraphs, headings, lists, tables,
  links and run formatting are re-emitted from the clipboard's DOM, so nothing executable or unsaveable can enter
  the page. Several blocks are inserted as whole paragraphs because WebKit's insertHTML merges the last one into the
  paragraph at the cursor.
- **Dark documents invert the page** (filter: invert(0.9) hue-rotate(180deg), pictures put back) instead of
  restyling text: explicit black text, highlights and table borders all stay readable without touching the saved
  colours.
- **The board's "current style" is one setting (boardStyle), as in Excalidraw**: every style change — on a selection
  or with nothing selected while a drawing tool is on — updates it, and new shapes take the parts that fit them (text
  only the colour, connectors and freehand no fill, ellipses no corners). It lives in settings, not in the file, so it
  carries over between drawings and restarts; untouched keys keep each format's own defaults.
- **Updates from GitHub releases, no update server.** The check is one unauthenticated request to the public
  releases API (`/releases/latest`, so pre-releases are never offered); the package for the system is a release asset
  and is verified against the release's `SHA256SUMS`. Installing replaces the running copy by renaming (a running
  program can be renamed on every OS; the old file is removed by the new version), then starts the new version with
  `--after-update=PID`, which waits for the old process to exit (it holds the single-instance lock). Windows copies
  installed by the setup program update through it (`--update`: waits for the app to close, reinstalls with the
  recorded folder and choices, including the elevated "for everyone" case, then starts it) so the registry,
  uninstaller and shortcuts stay right. Not code-signed yet, so updates carry the same first-launch warnings as
  downloads. Rejected: a third-party updater framework (licences, cgo) and a custom update server.
- **File dialogs never start in the working directory**: Windows starts the app from Explorer, a file
  association or the installer with `C:\Windows\System32` as its working directory, and a dialog without a
  folder opens there. Save dialogs already chose one (`saveDir`); Open-file and Open-folder dialogs now start in
  the folder of the last dialog answer while it exists, else Documents (`openDir`).
- **Looks are one more stage of the adjustment shader**: each is a few lines of GLSL on the adjusted colour (the
  neighbourhood ones — emboss, pencil sketch — sample the source texture), mixed in by an amount, so they preview
  in real time on large photos, combine with the sliders and stay inside the selection's mask. B&W, sepia and
  invert are effects like the rest: every chosen effect has its own strength (a uniform array in the shader,
  applied in list order), and the sliders sit below all the chips, not between them.
- **Transforming a selection floats it on a layer**: the selected pixels are cut onto a layer above the one they
  came from, so the move tool's transformer (move, scale, rotate, snapping) works on them unchanged; applying
  renders that layer into the source layer's pixels and drops it, and the history in between collapses to one
  step (cancel restores the snapshot from before the lift). Changing tool, layer or saving applies it first.
- **Turning handles don't snap unless Shift is held**: Konva's 45° snap list (5° tolerance) pulled small turns
  back to 0°; with no list Konva's own Shift behaviour snaps to 15°, as in other editors. A small label by the
  pointer shows the angle while the round handle is dragged.
- **A selection's outline is moved with a transparent frame and a transformer** (image editor): the frame sits on
  the selection's box; dragging and turning it previews the original outline through the frame's matrix, and on
  release the selection is rebuilt from the original (mask drawn through the matrix, vector outlines carried by
  it, wand edges worked out again), so turning it many times doesn't blur it. The frame stays turned while that
  selection lasts. Only the rectangle, ellipse and lasso tools show it — the brush and the wand need clicks
  inside a selection.
- **Settings tiles never shrink** (`flex: none` on the multi-column box): in WebView2 a multi-column flex item may
  shrink to its container's height, and its columns then overflow sideways, out of the scrolling page.
- **Frosted glass is a shaped blur**: six taps at random offsets within the radius (per pixel, so the result is
  grainy rather than smooth) and a 10 % lift towards white, like light scattered by etched glass.
- **Adjust is a list of pages** (image editor): with twenty-odd sliders, chips and the clean-up in one column the
  panel was hard to read, so it lists its kinds of adjustment and opens one at a time; all pages still feed one
  preview and one Apply. Pixelate became an adjustment (the shader samples each block's middle) so it previews
  live and stays inside a selection's mask like the rest. The region tools preview by running the same raster
  function on just the area's pixels, so what is shown is what Enter applies.
- **Touch and touchpad in the image editor**: a wheel event with whole 120 notches (or lines) is a mouse wheel
  and zooms; anything else is a touchpad scroll and pans, and Ctrl+wheel (a pinch) zooms. Two-finger touch is
  handled before Konva sees it (capture phase), so a second finger can't start a drag or a stroke; it cancels
  whatever the first finger began. Lifting fingers does reach Konva, which ends drags it readied.
- **Turning the view rotates the stage's world group, not the document**: Konva maps the pointer through the
  rotation, so every tool keeps working; fitting uses the turned picture's bounding box, turning keeps the point
  in the middle of the window where it was, and renders for saving/merging reset the rotation like zoom and pan.
  Arrow keys alone already step through the folder's images, so turning is on Alt+← / Alt+→. The canvas
  backdrop (checkerboard, edge) is drawn turned too, so the whole canvas turns, not only its layers.
- **Moving a layer: only the active layer listens** (image editor): Konva hits an image as its whole rectangle,
  so any layer above — even an empty, transparent one — caught the pointer and the active layer's drag never
  started. With the move tool on, the other layers stop listening (`updateDraggable`, also run on every commit);
  other tools see all layers again.
- **The start page has no tool buttons**: a row of chips (hash, screenshot, compare, history, all commands)
  looked out of place next to Open and Create; those tools are in the ☰ menu and Ctrl+K.
- **One right-click menu for all editors** (`core/contextMenu.ts`): a `contextmenu` listener on the document —
  after the views' own handlers (file tree, tabs, grids keep theirs by preventing the event), before the Wails
  runtime's listener on the window, which drops right-clicks outside text fields when the default menu is off.
  Text items come from what is under the pointer (input, contenteditable, CodeMirror); a view adds its own items
  through `tab.handlers.contextMenu` (it may move the caret to the click first) and the rest are its registered
  commands from a short list per module, those available now — so the menu and the palette can't disagree.
  CodeMirror is worked through its API (selection captured at the right-click, history, `replaceSelection`):
  it ignores synthetic clipboard events and the menu takes the focus. Clipboard text goes through the Wails
  runtime (`ClipboardSetText` / `ClipboardGetText`), which reaches the system clipboard reliably; rich text and
  pictures through the async clipboard API where the webview allows it.
- **Tighter corners**: radius tokens 3 / 4 / 6 px (were 6 / 8 / 12) and the fixed radii scaled to match; chips and
  the start page's tools are rounded rectangles, not pills.
- **Settings are tiles in CSS columns** (`columns: 22rem`): as many columns as fit, reflowing as the window is
  resized, each card kept whole; the cards are inline boxes so a card's bottom margin doesn't push the next
  column down.
- **Side panels float in narrow panes** (< 600 px, `isNarrow`): over the content with a shadow, closed when the
  pane becomes narrow, opened from the toolbar — a 260 px panel beside a 400 px pane would leave the canvas or
  table unusable.

## Project page

- **The README's clips and screenshots are recorded from the real app**, not mocked, and show **real, freely
  licensed media**: `scripts/demo_files.py` builds a "Shuttle project" folder from NASA photos and footage of Space
  Shuttle Atlantis (public domain, no people in them), the official #3DBenchy model (CC0 since 2025), Kimiko
  Ishizaka's *Open Goldberg Variations* (CC0) and a Fluent Emoji icon (MIT). They are downloaded from their sources
  once, pinned by SHA-256, trimmed locally (never committed), and credited under the README's gallery; the notes,
  fact sheet, spreadsheet and report are written by the script. The
  `demo` scenario (`frontend/src/test/demo.ts`) plays scripted tours with a drawn pointer (a bare X server has no
  visible cursor, and synthetic events don't move one) on a 1280×800 Xvfb display with no window manager, recorded
  by ffmpeg. Re-running `scripts/readme-media.sh` after UI changes keeps the page truthful.
- **Animated WebP, not GIF or video.** GitHub plays only uploaded videos, not ones in the repository; GIF's 256
  colours band the UI and are ~10× larger. libwebp merges unchanged frames, so a 20 s clip is under 1 MB. Waits
  that aren't worth watching (a model working) are marked by the scene and cut.
- **The banner is an SVG with CSS animations** (light and dark versions through `<picture>`): the file-type icons
  swipe past in three rows, each swipe with a motion-blurred copy faded in (a horizontal Gaussian blur; one
  definition per icon, reused with `<use>`, keeps it under 200 KB). Text is converted to
  paths from the app's own fonts so it looks the same without them installed, and still for readers who ask for
  reduced motion. Badges are static: shields.io can't read a private repository.

## Dependencies & licenses

| Dependency | License | Where |
|---|---|---|
| github.com/wailsapp/wails/v2 | MIT | app shell |
| github.com/fsnotify/fsnotify | BSD-3-Clause | file watching |
| svelte, @sveltejs/vite-plugin-svelte, vite, vitest, svelte-check | MIT | build/test |
| typescript | Apache-2.0 | build |
| @lucide/svelte | ISC | icons |
| @fontsource-variable/inter, @fontsource-variable/source-serif-4 | OFL-1.1 | fonts |
| modernc.org/sqlite (+ modernc.org/libc, mathutil, memory) | BSD-3-Clause | SQLite databases (pure Go, no cgo) |
| github.com/dustin/go-humanize, github.com/mattn/go-isatty, github.com/ncruces/go-strftime | MIT | dependencies of modernc.org/sqlite |
| github.com/remyoudompheng/bigfft | BSD-3-Clause | dependency of modernc.org/libc |
| (own code) animated GIF/WebP, ICO/ICNS, font metadata | — | M24: Go's image/gif and golang.org/x/image/webp decode single images; frame compositing, animated-WebP demuxing (frames re-wrapped as stills), a median-cut quantiser, ICO/ICNS reading and writing (incl. Apple's RLE) and the OpenType name/cmap/fvar reader are small and well specified, so they're own code. Animated WebP is written with nativewebp (MIT, already used) |
| HEIC/HEIF | — (system) | M24: not decoded by the app. Every HEVC decoder is LGPL (libde265, libheif, ffmpeg) or patent-encumbered, so the OS decoder is used at run time (sips, WIC via PowerShell, heif-convert/ImageMagick/ffmpeg) and nothing is linked or shipped. CI installs libheif-examples to exercise the path |
| (own code) `monoform` console program | — | M32: a Windows GUI-subsystem exe can't print reliably to the console it was started from (the prompt returns at once), so the command line is a separate small console program (same `internal/cli` code) that runs `hash`/`verify`/`info`/`convert` itself and hands files to the app; the app binary also accepts the commands (attaching to the parent console on Windows). Quick peek is a launch mode of the one Wails window rather than a second window (Wails v2 has one window per process); the per-OS "spacebar" hooks (Quick Look extensions, Explorer preview handlers) need native code and signing, so peek is offered through Open With and the context menu |
| github.com/godbus/dbus/v5 | BSD-2-Clause | M31: talks to the desktop's screenshot portal (xdg-desktop-portal) in pure Go — the only way to take screenshots on Wayland, and it shows the desktop's own area/window picker. Was already an indirect dependency |
| (own code) screenshots | — | M31: no capture library: kbinani/screenshot needs cgo on macOS and can't see Wayland, so each OS uses what it ships (screencapture, the portal or a screenshot tool, .NET via PowerShell) and annotation reuses the image editor |
| tesseract.js, tesseract.js-core (Tesseract 5) | Apache-2.0 | M30: OCR in the web view (WASM, LSTM-only SIMD build, ~3.9 MB) — no native code or cgo; its deps (bmp-js, zlibjs, wasm-feature-detect, idb-keyval, is-url, regenerator-runtime) are MIT/Apache. The worker, core and model are copied into dist/tesseract/ and loaded from the app (its CDN defaults are never used) |
| @tesseract.js-data/eng (tessdata_best int, eng) | MIT package / Apache-2.0 data | M30: the bundled English model (2.9 MB gz). Other languages: the user adds Tesseract `.traineddata` files; nothing is downloaded (the app stays offline) |
| (own code) PDF text layer | — | M30: Tesseract's text-only PDF page for each scanned page is overlaid with pdfcpu's PDF stamp (already a dependency), the same way ocrmypdf works, so the text sits exactly over the image |
| (own code) Excalidraw / draw.io canvas | — | M29: Excalidraw's own editor is a React app (~several MB plus fonts loaded from a CDN) and draw.io's is a ~50 MB web app, so both formats are drawn and edited by own code on one canvas, changing only the elements/cells an edit touches |
| roughjs | MIT | M29: Excalidraw's hand-drawn rendering (the same library Excalidraw uses, so a seed gives the same strokes); also a mermaid dependency |
| perfect-freehand | MIT | M29: Excalidraw pen strokes (the library Excalidraw uses) |
| Virgil font (from @excalidraw/excalidraw's package) | OFL-1.1 | M29: Excalidraw's hand-drawn font, bundled (56 KB, loaded with the drawing module); the OFL text is next to it. Excalifont is used by newer files but its font file carries no licence statement, so Virgil stands in for it |
| jsdom (dev only) | MIT | M29: XML DOM for the draw.io unit tests (Vitest runs in Node); not shipped |
| mermaid 11.17 (+ d3 ISC, dagre-d3-es, cytoscape, katex, khroma, roughjs … MIT; dompurify MPL-2.0 OR Apache-2.0, used under Apache-2.0) | MIT | M28: Mermaid diagrams, loaded on first use. Pinned below 12: mermaid 12 depends on elkjs (EPL-2.0). `securityLevel: strict`, SVG (not HTML) labels |
| @dagrejs/dagre | MIT | M28: layered layout for Graphviz DOT files, run in a worker. Graphviz itself (and its WASM builds like @hpcc-js/wasm-graphviz / viz.js) is EPL, so the DOT parser and the Graphviz-style drawing are own code |
| (own code) OpenDocument (.odt/.ods) | — | M27: no permissively licensed Go/JS library edits ODF while keeping what it doesn't understand. .odt reuses the docx editor's approach (render content.xml to HTML with pointers back to the XML, rebuild from the original elements on save) so fields, notes, frames and sections survive. .ods loads into excelize (already used) for editing and recalculation, with own OpenFormula↔Excel formula conversion, and is written back by regenerating only the table rows — unedited cells byte for byte. Fixtures were made with LibreOffice (MPL, dev-only, not shipped) |
| (own code) .deb/.rpm/.iso/.msi readers | — | M26: mholt/archives has no ar, RPM, ISO 9660 or cabinet support; each reader is a few hundred lines over formats with public specs (ar, RPM header + cpio newc, ECMA-119 + Joliet + Rock Ridge NM, MSI tables via mscfb (already used for .doc/.xls) + CAB with MSZIP via compress/flate's preset dictionary). Compressed payloads reuse mholt/archives' decompressors. LZX/Quantum cabinets are listed only. Test samples were made with dpkg-deb, rpmbuild, xorriso and msitools' wixl (LGPL tools used only to create the checked-in fixtures, not linked or shipped) |
| .dmg | — (not supported) | M26: needs UDIF + HFS+ + APFS (+ LZFSE) readers; no permissive Go library, and an own APFS reader is far beyond a viewer's scope. Reported as a known issue rather than half-done |
| software.sslmate.com/src/go-pkcs12 | BSD-3-Clause | M25: reads .p12/.pfx including the AES/PBES2 files OpenSSL 3 writes by default (golang.org/x/crypto/pkcs12 is frozen and can't); certificates, CSRs, keys and PKCS#7 bundles use Go's crypto/x509 and encoding/asn1 |
| (own code) INI/.properties/.env parser | — | M25: needs value positions to patch edits into the text, which general-purpose parsers don't give |
| smol-toml | BSD-3-Clause | M23: TOML parsing for the data view (small, spec-complete, no dependencies) |
| (own code) XML → tree, log levels | — | M23: the XML mapping needs positions for errors and must run in a worker (no DOMParser there), so it is a small own parser; log level detection is a few regexes |
| (own code) diff | — | M22: Myers' O(ND) diff with the linear-space middle-snake bisection (the algorithm diff-match-patch uses, Apache-2.0 — reimplemented over integer sequences so lines, words and tokens share it); a time limit turns pathological inputs into a plain replace instead of a stall |
| (own code) PDF signing/redaction/compression on top of pdfcpu | — | M21: signatures are stamped as image XObjects in a new content stream (the old content wrapped in q…Q); redaction rasterises the page with pdf.js and replaces its content — the only way to be sure nothing under a box survives without a full content-stream editor; compression re-encodes 8-bit Gray/RGB images with Go's image/jpeg and golang.org/x/image/draw (both already dependencies) and keeps a result only when it is ≥ 10 % smaller |
| (own code) DXF reader/writer, B-spline evaluation, CAD tools | — | M20: no permissive JS DXF library both reads *and* writes while preserving unknown content (dxf-parser is read-only, dxf-writer write-only, both MIT); patching the original group lines keeps everything else byte-exact |
| @codemirror/* (state, view, commands, language, search, autocomplete, language-data, lang-*), @lezer/* | MIT | text editor (autocomplete: bracket closing and word/language completion, a direct dependency since M18; lang-sql for the SQL console since M19) |
| markdown-it (+ its deps entities, linkify-it, mdurl, punycode.js, uc.micro) | MIT | markdown preview |
| konva | MIT | image markup canvas |
| golang.org/x/image (bmp, webp decode) | BSD-3-Clause | image encoding |
| github.com/HugoSmits86/nativewebp | MIT | WebP (lossless) encoding |
| pdfjs-dist (incl. OpenJPEG BSD-2, PDFium JBIG2 BSD-3, QCMS MIT wasm) | Apache-2.0 | PDF rendering, annotations, forms |
| yaml | ISC | YAML parsing |
| github.com/xuri/excelize/v2 (+ xuri/efp BSD-3, xuri/nfp BSD-3, tiendc/go-deepcopy MIT) | BSD-3-Clause | .xlsx read/write |
| github.com/richardlehane/mscfb, msoleps | Apache-2.0 | OLE compound files (.xls/.doc) |
| github.com/mholt/archives (+ STARRY-S/zip BSD-3, bodgit/sevenzip BSD-3, bodgit/plumbing BSD-3, bodgit/windows BSD-3, nwaples/rardecode BSD-2, klauspost/compress BSD-3/Apache-2.0, klauspost/pgzip MIT, dsnet/compress BSD-3, andybalholm/brotli MIT, ulikunitz/xz BSD-3, mikelolasagasti/xz ISC, pierrec/lz4 BSD-3, minio/minlz Apache-2.0, sorairolake/lzip-go Apache-2.0/MIT, spf13/afero Apache-2.0, go4.org Apache-2.0) | MIT | archives |
| onnxruntime-web, onnxruntime-common (+ flatbuffers Apache-2.0, protobufjs + @protobufjs/* BSD-3, long Apache-2.0, guid-typescript ISC, platform MIT) | MIT | search by meaning: runs the model (WASM, lazily loaded) |
| @huggingface/tokenizers | Apache-2.0 | search by meaning: tokenizer |
| EmbeddingGemma 2 (`onnx-community/embeddinggemma-2-ONNX`, q4 text encoder) — **downloaded on request, not bundled** | Apache-2.0 | search by meaning: model weights |
| U²-Netp ONNX (`BritishWerewolf/U-2-Netp`, from xuebinqin/U-2-Net) — bundled model | Apache-2.0 | background removal |
| github.com/ebitengine/purego | Apache-2.0 | calls ONNX Runtime's C API without cgo |
| ONNX Runtime 1.31.0 native library (`Microsoft.ML.OnnxRuntime` NuGet package; licence and ThirdPartyNotices downloaded with it) — **downloaded on request, not bundled** | MIT | runs the optional image models |
| BiRefNet lite (`CoderViking/birefnet-lite-onnx`, a GridSample export of ZhengPeng7/BiRefNet_lite) — **downloaded on request** | MIT | better subject selection |
| Moebius (`simonw/Moebius-ONNX`, from hustvl/Moebius; its VAE from hustvl/PixelHacker, MIT) — **downloaded on request** | Apache-2.0 | object removal |
| EfficientSAM-Ti ONNX (`yunyangx/EfficientSAM`, from yformer/EfficientSAM), 8-bit matrix weights by `scripts/efficientsam.py` — bundled model | Apache-2.0 | click-to-select objects |
| lukechampine.com/blake3 (+ klauspost/cpuid/v2 MIT) | MIT | BLAKE3 hashing |
| third_party/golang-lru (ours, replaces hashicorp/golang-lru/v2) | MIT | 7z key cache |
| three (incl. example loaders; bundled libs fflate MIT, chevrotain Apache-2.0 for VRML, meshopt decoder MIT) | MIT | 3D viewer |
| Draco decoder (`three/examples/jsm/libs/draco`, from google/draco) | Apache-2.0 | 3D: Draco-compressed glTF |
| github.com/hajimehoshi/go-mp3 | Apache-2.0 | MP3 decoding |
| github.com/Eyevinn/mp4ff | MIT | MP4/MOV parsing and writing (lossless video edits) |
| github.com/mewkiz/flac (+ mewkiz/pkg Unlicense, mewpkg/term Unlicense, icza/bitio Apache-2.0) | Unlicense | FLAC decoding and encoding |
| github.com/jfreymuth/oggvorbis, jfreymuth/vorbis | MIT | Ogg Vorbis decoding |
| github.com/dhowden/tag | BSD-2-Clause | audio tags and cover art |
| Python tools for the demo folder and README banner — fontTools + brotli (MIT), openpyxl (MIT), python-docx (MIT), Pillow (MIT-CMU); ffmpeg and Chromium run as external programs — **dev only, not shipped** | permissive | `scripts/demo_files.py`, `scripts/readme_hero.py`, `scripts/readme-media.sh` |
| github.com/pdfcpu/pdfcpu (+ hhrutter/tiff BSD-3, xdg-go/stringprep Apache-2.0, go.yaml.in/yaml Apache-2.0, mattn/go-runewidth MIT, clipperhouse/uax29 MIT) | Apache-2.0 | PDF page operations |

`scripts/licenses.py` lists every Go module linked into the binary and every runtime npm package with its licence and fails on anything not on the permissive allow-list (MIT, BSD, Apache-2.0, ISC, CC0, OFL, PSF/Python, Unlicense, 0BSD). `argparse` (PSF-2.0) is only used by markdown-it's CLI and isn't bundled; `@napi-rs/canvas` is a Node-only optional dependency of pdfjs-dist and isn't bundled either.
