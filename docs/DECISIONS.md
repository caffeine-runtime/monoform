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

- **Request bodies are always ArrayBuffers.** WebKitGTK segfaults in `webkit_uri_scheme_request_get_http_body` when a custom-scheme POST carries a `Blob`; empty bodies are sent as an `X-Empty-Body: 1` header instead of a zero-length body for the same reason (`core/backend.ts`).
- **Big saves are chunked**: anything over 4 MB is uploaded as 4 MB pieces (`/__hia/upload/{begin,chunk,commit,abort}`) into a temp file that Go renames atomically on commit. WebKitGTK copies request bodies on the page's main thread (≈120 ms per 16 MB), so one 50 MB POST froze the UI for ~0.5 s.
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

- **Office documents (added on request, M4b) are editable, not read-only.**
  - **.xlsx/.xlsm** are edited through excelize (BSD-3) in Go: only cells you change are rewritten, so styles, number formats, other sheets, charts and defined names stay as they were. Input follows spreadsheet rules (`=…` formula, number, TRUE/FALSE, otherwise text). After every edit the sheet's formula cells are recomputed (excelize's calculation engine) so dependent values update live; on save the computed results are written into the formula cells' cached values **and** the workbook asks for full recalculation on load, so Excel, LibreOffice and file previews all show correct numbers.
  - **.docx** is edited on a page-like canvas. The XML is parsed in the webview; each paragraph/run keeps a pointer to its original element, and saving rebuilds `word/document.xml` reusing the original paragraph and run properties (fonts, sizes, colours, spacing, numbering). Every other package part (styles, headers/footers, images, comments, settings) is copied byte-for-byte. Paragraphs containing tracked changes, fields, content controls or equations are shown read-only and written back untouched. Bold/italic/underline/strike and Heading 1–3/Normal can be changed; pasting is plain text (foreign HTML can't be mapped onto Word formatting). Bullets/numbering are kept but can't be created yet.
  - **Legacy .xls and .doc can be opened and edited, but are saved as new .xlsx/.docx files next to the original** (which stays unchanged), with a clear note. There is no permissive library that writes the old binary formats faithfully: `shakinm/xlsReader` is GPL-3 (excluded), `extrame/xls` is read-only and unmaintained. We read them ourselves on top of `richardlehane/mscfb` (Apache-2.0): BIFF8 cell values (numbers, dates, text, booleans, cached formula results) and the Word 97 piece table (text). Formulas/formatting of .xls and images/tables/formatting of .doc are not carried over (said in the UI).
  - Images inside .docx are served from the package via `/__hia/zip`.
  - Numeric-looking grid cells are right-aligned (spreadsheet convention).

- **⚠️ `hashicorp/golang-lru/v2` (MPL-2.0) is replaced by our own ~50-line LRU** (`third_party/golang-lru`, MIT) via a `replace` directive in `go.mod`. `mholt/archives` → `bodgit/sevenzip` uses it only for a 10-entry 7z AES-key cache (`New`, `Get`, `Add`). MPL-2.0 is weak copyleft, not on the allowed list, so rather than ship it we provide the same three functions under MIT. Flagged here because it is a deliberate workaround: if MPL-2.0 is acceptable to you, delete the `replace` line.
- **Extraction safety** (`internal/archive`): entry names with `..`, absolute paths, drive letters or reserved names are refused; symlinks are created only if their target stays inside the destination (never on Windows); hard links, devices and pipes are skipped; every write goes through an **`os.Root`** opened at the destination, so even a symlink already present (or created earlier in the same archive) can't redirect a write outside it. setuid/setgid bits are dropped. Skipped entries are listed to the user with the reason.
- **Decompression-bomb limits**: 200,000 entries, 32 GiB total, and a 1000:1 expansion ratio once more than 1 GiB has been written. Bytes are counted as they are written (headers aren't trusted); a partial file is deleted when a limit stops extraction.
- **Existing files** default to "rename" (`name (2).ext`) when extracting; nothing is overwritten silently.
- **Selecting a folder inside an archive** extracts it relative to its parent (`a/b` → `b/…`).
- **Archives in the sidebar tree** expand like folders (their listing is cached per path+size+mtime); clicking an archive opens the archive browser; inner files open in their normal module as read-only tabs (Save As to edit a copy), streamed from memory — no temp files.
- **RAR and 7z are read-only by design** and the archive view says why in a banner (RAR compression is proprietary; 7z creation isn't supported) instead of showing disabled buttons. Only ZIP can be created ("Compress to ZIP…" on any file/folder, "Create ZIP from files…" in the palette); `.zip`, images, media and Office files are stored without recompression.
- **RAR test fixtures are generated** (stored RAR5 written from the public format description), since RAR files can't be created with free tools.

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
| @codemirror/* (state, view, commands, language, search, language-data, lang-*), @lezer/* | MIT | text editor |
| markdown-it (+ its deps entities, linkify-it, mdurl, punycode.js, uc.micro) | MIT | markdown preview |
| konva | MIT | image markup canvas |
| golang.org/x/image (bmp, webp decode) | BSD-3-Clause | image encoding |
| github.com/HugoSmits86/nativewebp | MIT | WebP (lossless) encoding |
| pdfjs-dist (incl. OpenJPEG BSD-2, PDFium JBIG2 BSD-3, QCMS MIT wasm) | Apache-2.0 | PDF rendering, annotations, forms |
| yaml | ISC | YAML parsing |
| github.com/xuri/excelize/v2 (+ xuri/efp BSD-3, xuri/nfp BSD-3, tiendc/go-deepcopy MIT) | BSD-3-Clause | .xlsx read/write |
| github.com/richardlehane/mscfb, msoleps | Apache-2.0 | OLE compound files (.xls/.doc) |
| github.com/mholt/archives (+ STARRY-S/zip BSD-3, bodgit/sevenzip BSD-3, bodgit/plumbing BSD-3, bodgit/windows BSD-3, nwaples/rardecode BSD-2, klauspost/compress BSD-3/Apache-2.0, klauspost/pgzip MIT, dsnet/compress BSD-3, andybalholm/brotli MIT, ulikunitz/xz BSD-3, mikelolasagasti/xz ISC, pierrec/lz4 BSD-3, minio/minlz Apache-2.0, sorairolake/lzip-go Apache-2.0/MIT, spf13/afero Apache-2.0, go4.org Apache-2.0) | MIT | archives |
| third_party/golang-lru (ours, replaces hashicorp/golang-lru/v2) | MIT | 7z key cache |
| github.com/pdfcpu/pdfcpu (+ hhrutter/tiff BSD-3, xdg-go/stringprep Apache-2.0, go.yaml.in/yaml Apache-2.0, mattn/go-runewidth MIT, clipperhouse/uax29 MIT) | Apache-2.0 | PDF page operations |

`scripts/licenses.py` lists every Go module linked into the binary and every runtime npm package with its licence and fails on anything not on the permissive allow-list (MIT, BSD, Apache-2.0, ISC, CC0, OFL, PSF/Python, Unlicense, 0BSD). `argparse` (PSF-2.0) is only used by markdown-it's CLI and isn't bundled; `@napi-rs/canvas` is a Node-only optional dependency of pdfjs-dist and isn't bundled either.
