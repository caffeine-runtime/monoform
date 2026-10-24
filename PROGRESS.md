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
  Windows (own setup program with opt-in file associations + portable zip), macOS (universal .app, listed in Open With
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

## After the first test builds
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
- **M19 — Database browser (SQLite).** .db/.sqlite/.sqlite3 files (also recognised by their header) open in a
  database view: tables (with row counts), views, indexes and triggers on the left; a table's rows in the
  spreadsheet grid, paged from Go (100k rows scroll smoothly), with column sorting, search across columns and an
  SQL WHERE filter; editing cells (type NULL for null), adding and deleting rows — pending, marked on the rows, with
  undo — written in one transaction with Save (or dropped with Revert); a Structure view (columns, keys, defaults,
  indexes, the CREATE statement); an SQL console with highlighting and schema-aware completion, Ctrl+Enter runs
  the selection or the script, a result per statement; CSV export of a filtered table; read-only mode.
- **M20 — DXF viewer and light CAD editor.** .dxf drawings (ASCII, R12 to 2018) open in a CAD view: lines,
  polylines with arcs and widths, circles, arcs, ellipses, splines (NURBS), texts and MTEXT, points, solids, hatches,
  leaders, blocks (nested, rotated, scaled, arrays, BYBLOCK/BYLAYER colours) and dimensions (via their blocks), in
  the drawing's colours on a dark or light background; layers can be hidden for viewing, made current, or used to
  select everything on them. Tools: select (click, Shift+click, window left→right, crossing right→left, drag a
  selection to move it), pan/zoom (wheel, middle-drag, Space+drag), measure (distance, ΔX, ΔY, angle), line,
  polyline (click the start to close), rectangle (Ctrl/Shift = square), circle, 3-point arc, text, move, copy
  (repeated), rotate (Shift = 15° steps), scale, delete, duplicate; object snaps (ends, midpoints, centres,
  quadrants, insertion points), grid snap, ortho, and typed input like AutoCAD ("x,y", "@dx,dy", "len<angle", a
  length along the cursor, a radius, an angle, a factor). Properties panel: layer, colour (ACI), coordinates,
  radius, angles, heights, text, closed flag, block scale/rotation, length and area. Undo/redo; export SVG (real
  arcs, units kept) or PNG. Saving patches the original text: only changed values are rewritten, new objects get
  handles from $HANDSEED and R13+ subclass markers (R12 files get POLYLINE/VERTEX records in their padded-code
  style), code page and line endings are kept, and everything the editor doesn't understand survives byte for
  byte. Parsing, editing and drawing run in a worker (OffscreenCanvas); the page only scales the last frame while
  the next one renders, so a 52,000-object drawing zooms without stalls.
- **M21 — PDF tools.** Sign like Preview: draw a signature (mouse, trackpad or pen, pressure-aware), type it, or
  import a photo/scan (the paper turns transparent); it's remembered for next time, placed with a click, then moved
  and resized on the page, and stamped into the page content as a transparent image (upright on rotated pages).
  Redact: drag black boxes, or mark every match of a search ("Redact all matches"); applying turns each redacted
  page into an image of itself with the boxes burnt in, so the text, images and annotations underneath are really
  gone (checked with poppler in CI). Text boxes, drawings and highlights get a colour, a text size and a line width.
  Compress: images re-encoded as JPEG and downscaled (two strengths) plus a lossless structure clean-up, with the
  size before → after. Export pages (or the selected ones) as PNG/JPEG at 72–300 dpi; add images as pages; File →
  "Create PDF from images…" (one page per image, page size of the image or A4/Letter; GIF/BMP/AVIF/SVG converted on
  the way). Everything works on the working copy, so Save writes it and closing without saving discards it.
- **M22 — Compare two files.** File → "Compare files…", "Compare this file with…", a tab's "Compare with…" (pick
  another open file or browse), or the file tree's "Select for compare" → "Compare with …". Text and code: side by
  side with line numbers, changed words highlighted inside changed lines, an overview strip of all changes (click
  to jump), next/previous change (F7 / Shift+F7), only changes (3 lines of context, gaps expand on click), ignore
  whitespace, swap sides, compare again. JSON/YAML: a list of changed paths (added/removed/changed with both values)
  and a normalised side by side (keys sorted, formatting ignored). CSV/TSV: rows matched by a key column, so
  reordering isn't a change; changed cells listed by column name. Images: side by side (zoom and pan together),
  swipe, onion skin, difference (changed pixels in magenta, count and share, a tolerance for JPEG noise). Anything
  else: byte by byte, reporting the first difference. Diffing runs in a worker (Myers' O(ND) in linear space), so a
  100,000-line pair compares in ~0.1 s without stalls.
- **M23 — XML, TOML, JSON Lines and logs.** XML (.xml, .plist, .csproj, .gpx, .kml, .rss, .xsd…) and TOML open in
  the data view: tree, validation with the line and column of the first error, "As JSON" and "Save as JSON" (XML
  maps to the usual "@attribute" / "#text" shape; repeated elements become lists). JSON Lines / NDJSON: one record
  per line, the bad line pointed out; lists of records (JSONL, or a JSON array of objects) also get a Table view
  (the spreadsheet grid, columns from the keys). Log files (.log, .out, .err) open in a log view: the editor with
  error/warning lines tinted and the level word and timestamp coloured (ERROR, [WARN], level=info, JSON "level",
  Android "E/", klog "E1020"), chips counting errors, warnings, info and debug lines (lines without a level, such as
  stack traces, belong to the line above), a text or regex filter listing the matching lines below (click to jump),
  next/previous error (F8 / Shift+F8), and Follow: new lines appear as the file grows — only the added bytes are
  read, a shrunk (rotated) file is reloaded.
- **M24 — More image formats.** HEIC/HEIF (iPhone photos) and AVIF open in the image editor: when the webview
  can't decode them, the operating system's own decoder converts them — sips on macOS, Windows Imaging Component
  (with Microsoft's free HEIF extension) on Windows, libheif's heif-convert/heif-dec, ImageMagick or ffmpeg on
  Linux; nothing is bundled (every HEVC decoder is LGPL or patent-encumbered). Edits save as a JPEG copy next to the
  original; the file tree offers "Convert to JPG / PNG". Animated GIF and WebP open in a frame editor: play/pause,
  step (← →), preview speed, select frames (Shift/Ctrl), delete, duplicate, move, reverse, per-frame timing, whole
  animation faster/slower, drop every other frame, loop count, undo; saved as GIF (median-cut palette per frame,
  dithered) or lossless animated WebP; export a frame as PNG. ICO/CUR/ICNS show every size inside (PNG, BMP with
  masks, legacy RLE) and can be exported per size, rebuilt from any image, or converted to the other format; any
  image can be saved as ICO (16–256) or ICNS (16–1024, @2x). Font files (TTF, OTF, TTC, WOFF, WOFF2) open in a
  preview: names, version, designer, copyright and licence, weight, glyph count, variable axes with sliders, your
  own sample text at any size, a size waterfall, paragraphs, and every covered character by Unicode block (click
  to copy).
- **M25 — Config files and certificates.** INI (.ini, .cfg, .desktop, .inf, .reg), Java .properties and .env files
  (opened by name: .env, .env.local, …) get a Table view next to the text: settings by section, problems listed
  (a key set twice, malformed lines) with a jump to the line, secret-looking .env values (passwords, tokens, keys)
  masked until revealed; editing a value in the table rewrites just that value (quotes, escapes, continuations,
  inline comments kept) as one undo step; .env and .cfg/.conf-style files are highlighted. Certificates and keys
  (.pem .crt .cer .der .p12 .pfx .p7b .csr .crl) open in a certificate view: subject and issuer, validity with a
  warning when it expires within 30 days (or has), names (SANs), key type and size, signature, usages, serial,
  SHA-256/SHA-1 fingerprints and the public-key pin (click to copy), OCSP/CA issuer/CRL URLs, root/intermediate/end-
  entity roles and whether each certificate is signed by the next one in the file; CSRs (signature checked),
  private keys (type only — never shown), public keys and CRLs; .p12/.pfx ask for their password (modern
  AES-encrypted files from OpenSSL 3 too); copy or save any certificate as PEM.
- **M26 — Packages and disk images.** .deb, .rpm, .iso and .msi browse like archives (open files inside, extract
  some or all) with their package details above the list: Debian control fields, RPM header (name, version,
  architecture, licence, summary…), ISO volume/publisher, MSI product name, version, manufacturer and product code.
  Own readers: .deb (ar + gzip/xz/zstd/bzip2 tar), .rpm (header + cpio in any compression), .iso (ISO 9660 with Joliet
  and Rock Ridge long names), .msi (files listed from the installer's tables with their real folder paths, extracted
  from the embedded cabinets). Zip-based packages — .jar .war .ear .aar .apk .xapk .apks .ipa .xpi .vsix .nupkg .whl
  .appx .msix (+ bundles) — open in the archive view too, also from the sidebar tree. Packages and disk images are
  read-only.
- **M27 — OpenDocument text and spreadsheets.** .odt (and .ott) open in the document editor: headings, paragraph
  alignment and spacing, bold/italic/underline/strike from automatic and named text styles, colours and sizes,
  links, bullet, nested and numbered lists, tables, pictures, footnotes, fields, tabs, line breaks and runs of
  spaces; sections, indexes and other blocks the editor can't change are shown read-only and kept. Saving writes
  content.xml back into the .odt (every other part untouched): original paragraphs, spans and list elements are
  reused, formatting changes become automatic styles, Enter in a list adds an item. .ods (and .ots) open in the
  spreadsheet with values shown as LibreOffice shows them (currency, dates, percentages), OpenFormula formulas
  converted to the recalculating engine and back, sheets added/renamed, rows inserted/deleted; saving writes an .ods
  that copies unedited cells byte for byte and keeps styles, column widths, merges, comments, header rows and
  anchored shapes (or saves as .xlsx). Renaming a sheet now also updates formulas that refer to it (for .xlsx too).
  Password-protected OpenDocument files are refused with a message.
- **M28 — Graphviz and Mermaid.** .dot/.gv and .mmd/.mermaid open with the source (highlighted) beside the
  drawing: zoom with the wheel, drag to pan, click a node, edge or cluster to select its line; errors name their line
  (click to jump) and keep the last good drawing; export SVG or PNG. DOT is parsed by our own parser (subgraphs,
  clusters, attribute scoping, edge chains, ports, HTML labels) and laid out with dagre in a worker, drawn in
  Graphviz's style (its node shapes, records, arrowheads, colours incl. HSV and grayNN, rank direction). Mermaid
  (all its diagram types) loads on first use. ```mermaid and ```dot / ```graphviz blocks in Markdown previews are
  drawn too (cached, so typing elsewhere doesn't redraw them); a broken block shows its error and source.
- **M29 — Excalidraw and draw.io.** .excalidraw and .drawio/.dio open on one drawing canvas. Excalidraw is drawn the
  way Excalidraw draws it (roughjs with each element's seed, perfect-freehand pen strokes, its fill styles, rounded
  corners, arrowheads and the hand-drawn Virgil font, bundled); draw.io pages (compressed or not) show their common
  shapes, swimlanes and containers, HTML labels and edges routed straight, orthogonally or curved with draw.io's
  arrowheads and labels. Editing: select (click, shift-click, marquee; groups select together), drag to move (bound
  labels and connected arrows/edges follow), resize with handles (shift keeps proportions), draw rectangles, ellipses,
  diamonds, lines, freehand and text, arrows that connect the shapes they start and end on, double-click to edit a
  label (or add text on an empty spot in Excalidraw), stroke/fill colours, line width and style (and Excalidraw's
  fill style and sloppiness), duplicate, front/back, delete, undo/redo, arrow-key nudges, tool keys (V R D O A L P
  T / 1–8), pan (space/middle drag, wheel) and zoom (Ctrl+wheel), draw.io pages, SVG/PNG export (the font
  embedded). Only the elements/cells an edit touches change; everything else in the file is kept.
- **M30 — Text recognition (OCR).** Offline Tesseract (tesseract.js, WASM, LSTM model) ships with the app with
  English; more languages are Tesseract `.traineddata` files the user adds ("Add language file…", copied into the
  app's data, never downloaded); the chosen languages are remembered. Images: the Recognise-text button (or "Text"
  on a selection) opens a panel with the recognised text to edit and copy, and its confidence; a selection is read
  on its own (cropped with a margin, enlarged when small). PDFs: read this page or all pages; scans are detected
  (no text on the first pages) with a banner; "Make searchable" recognises every page without text at 300 dpi and
  lays Tesseract's invisible text-only page over it (pdfcpu stamp), so the PDF can be searched and copied from in
  any viewer — the page looks the same. Recognition runs in a worker (released after 90 s idle).
- **M31 — Screenshots and colours.** "Take a screenshot of an area" (Ctrl+Shift+X), "…of the whole screen" and
  "…in 3 seconds" hide the window, capture with what the system has — macOS `screencapture` (drag an area or pick
  a window), the desktop's screenshot portal on Linux (GNOME/KDE, also Wayland, over D-Bus without cgo), else
  gnome-screenshot / spectacle / grim+slurp / xfce4-screenshooter / maim / scrot / ImageMagick, and on Windows a copy
  of all monitors via .NET (opened with Crop, since there's no area picker) — save to Pictures/Screenshots with a
  dated name and open in the image editor, whose arrows, boxes, ellipses, text, blur and pixelate tools do the
  marking up. "Pick a colour from the screen" opens a temporary shot with the new colour picker (I): the colour as
  HEX/RGB/HSL (click to copy, or use it to draw) and the image's palette (5/8/12 dominant colours by share; copy
  the list or CSS variables, save a .gpl palette) in a Colours panel. After reading an image's text (M30), "Hide
  text" pixelates every recognised word (passwords, names, numbers) in one undoable step.
- **M32 — Command line, quick peek, preview mode.** `monoform` (a small console program shipped with the app; the
  app binary accepts the same commands): `monoform FILE…` opens files (a running window takes them), `--peek` and
  `--preview`; `monoform hash [-a md5,sha1,sha256,sha512,blake3|all] FILE…` prints sha256sum-/BSD-style lines,
  `monoform verify LIST…` checks SHA256SUMS-style lists (names relative to the list or the current folder),
  `monoform info` shows type, size, pages / image size, `monoform convert IN OUT` converts images (HEIC via the system);
  patterns the shell didn't expand (Windows) are globbed; exit codes 0 / 1 (a check failed) / 2. Packaging: Linux
  tarball + install.sh, the Windows installer (a `monoform` shim in the per-user WindowsApps folder, which is on
  PATH, and a "Quick peek" context-menu verb), the macOS bundle (Settings → Install the monoform command links it into
  /usr/local/bin). Quick peek (`--peek`, Open With → Quick peek): a 960×680 window with just the file, read-only,
  no sidebar or tabs; Esc closes it, "Open in editor" makes the window full size, the file editable and brings back
  the last session (peeking never overwrites it). Preview mode: any file tab can be switched between preview
  (read-only) and editing from the status bar or Ctrl+Alt+E (the view is rebuilt; unsaved changes are asked about);
  "Open files in preview mode" makes it the default. Read-only text editors are now really non-editable (before,
  typing into a read-only tab — e.g. a file inside an archive — changed the text on screen).
- **M33 — Layouts that fit any pane.** Toolbars no longer push buttons past the edge (they were cut off with a
  hidden scrollbar) or squeeze button text into a column: when a toolbar doesn't fit, buttons show only their
  icon and are named in the hover tooltip (with any description they had); if even that doesn't fit, the bar
  wraps onto another row. Every toolbar button that had only text now has an icon. Side panels — the image
  editor's Layers/Adjust/Colours, CAD properties, PDF thumbnails, the database's table list — float over the
  content in a pane narrower than 600 px (split view, small window) instead of squeezing it, close when the pane
  becomes narrow and open from the toolbar. Settings rows put their control under the label when narrow; the
  hash checker's summary and time readouts don't break mid-phrase. Checked at 320–1100 px pane widths and the
  640×400 minimum window (self-test `m33`; `uiaudit` lists wrapped labels and overflowing bars for every view).
- **M34 — File history.** Every save made in Monoform keeps the file's earlier content and the new one
  (text, images, documents, spreadsheets, PDFs, drawings, audio/video exports — anything written through the
  app). *Show file history* (Ctrl+Alt+Y, the tab or file-tree menu) lists the versions by day — before the first
  save, saved, changed by another program, restored — with size changes; each opens read-only, compares with the
  file now (in Compare) or restores (the open tab reloads; what the file had becomes a version, so a restore can
  be undone). *File history: all files* lists every file with versions, deleted ones too (restoring recreates
  them). History follows renames made in the app. Contents are stored once per SHA-256, gzipped unless already
  compressed; the content being replaced is hard-linked (no copy on the save path), the new content copied; a
  save costs ~20 ms extra for small files. Limits in Settings → File history: on/off, total space (default 2 GB,
  oldest versions dropped first, never a file's newest) and versions per file (default 100); files over 256 MB
  aren't versioned. The app's own settings, caches and working copies are never versioned.
- **M35 — Resizable splits.** The source | preview split of Markdown, HTML, diagrams and SVG has a divider:
  drag it (the share is shown while dragging), double-click for 50/50, arrow keys to nudge; each kind remembers
  its ratio. The split view's dividers between tabs (2, 3 or 4 tabs) now have a visible handle, show the share
  while dragging, reset to equal sizes on double-click and move with the arrow keys when focused.
- **M36 — A grouped app menu.** The ☰ menu listed every command (~50 lines). It now shows the everyday actions
  (Go to file, Search, Open, Save…) and submenus: New, This file, Folder, Edit, the open file's own commands
  (Image, PDF, Video…), Tools, View, Split view, Appearance, Tabs, Help — 18 lines with an image open. A file type
  with many commands gets its tools, editing and viewing commands grouped again (Image › Tools › Brush), and
  submenu items drop a prefix that repeats the submenu ("Split view › Two side by side"). Commands not placed
  explicitly still appear under their category, so new ones never go missing. Any menu can now have submenus:
  they open on hover (short delay), click, Enter or →; ← / Esc go back a level; near the screen edge they open
  to the left. Fixed on the way: with a menu open, arrow keys were also handled by the app's shortcuts (← / →
  switched images in the image editor) — open menus now own the keyboard.
- **Start page without the name, and less like an editor's welcome tab.** No title or tagline: the page opens
  with a large drop area ("Drop files here") with Open file / Open folder, then **Create** as square tiles with a
  coloured badge per file type (instead of rows of icon + label + shortcut), **Tools** as rounded chips (hash
  check, screenshot, compare, file history, all commands — shortcuts in the tooltips), and **Recent** with
  file-type icons. The renaming itself is postponed. Then, on feedback, the badges lost their per-type colours
  (green, blue…): every icon now uses the app's own neutral tones and is smaller (17 px in a 34 px badge, tiles
  ~100 px wide).
- **M37 — First-run welcome.** On the very first start (not when the app is opened with a file, in quick peek or
  in a self-test) a short welcome walks through four steps: what opens, that edits keep history, that it's
  offline, and a theme choice (like my computer / light / dark) with the Ctrl+K tip. Skip, Back/Next, dots, ← → Enter
  and Esc; app shortcuts are off while it's shown. Finishing records `welcomeDone`; Help › Welcome shows it again.
  It's a separate lazily loaded chunk, so the entry bundle doesn't grow.
- **Fixed: a second hash request while one was running was dropped.** Ticking another algorithm (or the tool's
  own first run still going when one was ticked) left that digest missing; choosing another file mid-run could
  show the earlier file's digests. Requests now queue: when a hash ends, what is still missing for the file
  chosen now is computed, and results for a file no longer chosen are discarded. (Showed up as a rare m6 stall.)
- **Fixed: a video blur "stopped working" after a few seconds.** A new blur or image overlay covered only the 5 s
  after the playhead (and nothing before it), so playing or scrubbing past that showed the plain video. They now
  cover the whole clip (or the selection, if there is one); the panel's **Whole video** button resets a shortened
  one. Checked on a 14 s clip: pixelation holds through playback and every seek.
- **M38 — Masks.** *Video:* the blur button offers an ellipse (faces), a rectangle (plates, screens, text) or **any
  shape** — drag around the object on the picture to draw its outline (simplified to ≤ 64 points), then drag its
  points, double-click the outline to add one, right-click a point to remove it. Any area can be **inverted** (blur
  everything else) and has a soft edge. Image overlays get the same mask (rectangle, ellipse or freeform), or *cut
  this shape out*. Masks follow the layer's movement, scale and rotation (and tracking) and are rendered into the
  export. *Images:* every layer can have a **layer mask** that hides parts of it without erasing them: add it
  showing everything, hiding everything or from the selection; paint it with the brush (hides) and eraser (shows),
  X swaps; hide/show the selection on it, invert it, turn it off (Shift+click its thumbnail), apply or delete it.
  The layers panel shows the mask beside the layer; click either thumbnail to paint on it. Markup on a masked layer
  is masked too; flips, rotations, resizes, crops and moving the layer carry the mask along; merging bakes it in.
  `.ora` files keep it editable (other apps get the layer with the mask already applied).
- **Fixed: "select object" on people picked a part.** One click on a person gave a badge, a pocket or just the face:
  of Segment Anything's three answers (part, larger part, whole) the app took the one the model scored highest,
  which for the small quantized model is usually the smallest. It now takes the whole object when the model is
  still confident about it and it isn't background. On a portrait, a click on the face selects the whole person
  and a click on the suit the whole suit. Alt-click exclusions still use the model's top choice. "Select subject"
  (whole image) is unchanged — it already found people well in the test photos.
- **M39 — Tabs: new tab, drag to reorder, drag out to a new window.** A **+** after the last tab (Ctrl+T) opens a
  start page in a tab; whatever is opened from it takes its place. Tabs drag with the mouse (pointer events instead
  of HTML drag and drop, which webviews handle differently): along the bar to reorder, with a mark where the tab will
  land and the tab following the pointer; onto a view's edge to split (as before); **out of the window to give the
  file a window of its own** — it opens where the tab was dropped (kept on screen), and the tab closes here. A tab
  with unsaved changes asks to save first. Also in the tab's menu and Tabs › *Move tab to a new window*. The new
  window is a second app process (`--new-window`, Wails v2 has one window per process): it shows just that file,
  doesn't restore or save the session (the main window's tabs come back as they were) and doesn't index for search
  by meaning; settings it changes (theme…) are saved without touching the main window's session. Checked with real
  mouse drags under X11 (xdotool): reorder, no text selection sweeping over the editor, the second window appears.
- **M40 — Between editors: copy, paste and drag.** Pictures and text move from one tab to another. The image editor
  and the video player have a copy/drag button (click copies; drag it onto another tab's view): the image editor gives
  the selection or the picture as it looks, the video the frame at the playhead. Ctrl+C / Ctrl+V do the same where no
  text field has focus. While dragging, a chip shows what it is and whether the view under the pointer takes it (the
  view is outlined); hovering a tab in the tab bar brings it up, so it doesn't have to be in split view. Who takes
  what: **video** — a picture or picture files become an overlay where dropped, text a text overlay; **image editor** —
  a picture or picture files become layers, text a text object (picture files dropped from the system go in as layers
  instead of opening); **Markdown note** — a picture is saved into assets/ and linked, files are linked, text
  inserted; **text/code** — text; **SVG** — a picture is embedded, text becomes a text element. Text dragged out of
  an editor and files dragged from the sidebar can be dropped the same way. A tab that can't take something says so.
- **M41 — Our own Windows setup.** The NSIS installer is replaced by Monoform's own setup program, in the app's
  look: one card with the app icon, *Install* (or *Update*, showing the version it replaces), and an *Options* fold
  with the folder, *For everyone on this computer*, desktop shortcut, the `monoform` command and the (unchecked) default
  app choice; then a progress bar and *Open Monoform*. It installs for the current user without asking for
  administrator rights; *For everyone* asks. It notices a running Monoform (and can close it). The uninstaller (Settings › Apps) is the same program: *Remove Monoform?* with an option to delete settings, history and the search index too; file defaults go back to what they were.
  `--quiet` installs/uninstalls without a window (used by CI on a real Windows runner). Off Windows it runs as a demo
  that installs into a test folder (`scripts/setup-selftest.sh`).
- **Rename: Monoform.** Hold It All is now **Monoform** — free, open source (MIT, `LICENSE`) and
  AI-written — with a new logo (a single rounded M) on the app icon, the sidebar, the setup and every file icon. Each
  file type's icon now has one shared form (page, tile, symbol, M) and differs only in colour and symbol. The
  command is `monoform` (`monoform hash`, `verify`, `info`, `convert`).
- **A shorter app menu.** Families of options are one row each: the theme is a System / Light / Dark toggle,
  interface size and text size are sliders (double-click resets), split view is a row of layout buttons; on/off
  options (sidebar, side panels, path bar, hidden files, word wrap, minimap, spaces and tabs, preview mode) are
  checked items with short names. The individual commands stay in the command palette with their shortcuts.
- **M43 — Optional AI models: better subject selection, object removal.** *Settings › AI models* lists two optional
  downloads, each with its size, model and licence: **Better subject selection** (BiRefNet; *Select subject* and
  *Remove background* find people, hair and objects far more precisely — the bundled model stays the default) and
  **Object removal** (Moebius; select something, *Remove* in the selection bar or *Image › Remove object*, and the gap
  is painted in with what could be behind it, in ~25 s with progress and Cancel in the status bar; undo and run again
  for a different fill). A dialog asks before anything is downloaded; the first use offers it. Models run natively
  (ONNX Runtime, downloaded with the first pack), only while used, and are freed after a minute.
- **M42 — Path bar, side panels, quick view for pictures, per-type file icons.** The open file's **full path** shows
  above it (*View › Show / hide the path bar*); each folder in it opens a small **folder browser**: the folder's
  subfolders and files (the open file marked), `..` to go up, typing to filter, a click opens a file, *Open as folder*
  makes it the sidebar folder and *Show in Explorer / Finder / the file manager* opens the system's. **Side panels**
  (image layers/adjust/colours, video effects, SVG properties, CAD, 3D animations, database objects) hide and come back
  with a tab bar button or *View › Show / hide side panels* (`Ctrl+Alt+B`). On Windows, **pictures open in a quick
  view** (`--peek`) — just the picture, ← / → through the folder — and **Edit** hands it to the full editor (a running
  window takes it); quick views are their own small processes, so several can be open next to the editor. **Each file
  type has its own icon** in Explorer (text, Markdown, data, tables, PDF, pictures, vector, Word, archives, checksums,
  web pages, audio, video, 3D) and the **app icon** fills its tile, so it no longer looks tiny on the taskbar.
- **Fix: Save dialogs for new files opened in System32 on Windows.** A file without a folder yet (a new tab, a new
  file with no folder open, an export from an unsaved tab) was offered the working directory, which is
  `C:\Windows\System32` when Windows starts the app from Explorer or the installer. It now opens in the folder you
  last saved into, else Documents (Windows' known folder, so OneDrive redirection is followed; XDG on Linux).
- **A project page.** The README opens with an animated banner (light/dark; the file-type icons swipe past with motion
  blur), clips recorded from the app (opening every kind of file in one window; selecting the Space Shuttle in a NASA
  photo, copying it and pasting the cut-out into a note; Markdown with a live diagram; four files side by side, the
  3DBenchy model among them), the file types with their icons, and a gallery at the bottom — made by
  `scripts/readme-media.sh` from real, freely licensed media (NASA, #3DBenchy, The Open Goldberg Variations). Found on
  the way and fixed: a **PDF at Fit width didn't refit** when the window or its split pane changed size (self-test
  `m33`); **Excel files written by scripts showed formulas without results as empty cells**, now calculated on open
  (Go test); and **the 3D floor grid drew stray grey triangles** on software OpenGL (VMs, no GPU driver) — it is now
  one shader-drawn plane that fades out around the model (self-test `m11`); and **STL/3MF/AMF models lay on their
  side** (Z-up files shown Y-up) — they now stand as in a slicer (`m11`).
- **Fix: the SVG editor froze on big drawings.** Opening a CAD export (a 98 KB gear-pump drawing, ~380 elements)
  took 38–75 s with the window frozen, every edit froze it again, and closing was slow: the design view's build
  effect re-ran itself ~1000 times. It now builds once (~0.4 s, with "Opening the drawing…" while it does), zooming
  scales the drawing until the wheel rests (≤ 50 ms frames instead of ~130 ms), and an edit is one rebuild. Self-test
  `m44` on a generated CAD drawing.
- **Dark canvases.** In the dark theme, Excalidraw and draw.io drawings, Mermaid and Graphviz diagrams and the
  diagram blocks in Markdown previews are darkened the way Excalidraw's own dark mode does it (white paper →
  near-black, black ink → near-white, colours keep their hue). The files and exports keep their colours, photos
  inside a drawing stay as they are, and a drawing that already has a dark background is left alone. A moon button
  in the drawing/diagram toolbar (and *Settings › Appearance*) keeps them light. CAD drawings already followed the
  theme. Unit tests (`core/canvas.test.ts`) and self-test `m45`.
- **Obsidian-style notes; outline for documents.** Markdown notes link with `[[Note]]`, `[[folder/Note#Heading|label]]`,
  `![[picture.png]]` and relative `[text](Note.md)` links: resolved by note name across the open folder (nearest note
  first, as Obsidian does), followed by a click in the preview or Ctrl+click in the source, and a link to a note that
  doesn't exist yet is dimmed and creates it when clicked. `[[` completes note names. A side panel (*Outline*) shows the
  note's headings as a foldable tree (click to go; the heading you're in is highlighted, in the editor or the preview),
  **backlinks** — every note linking here, with the line — and outgoing links. The status bar counts words and
  characters (of the selection too), Obsidian-style. Word/OpenDocument documents get the same outline of their
  headings and the counts. The folder's links are indexed in Go (`internal/notes`, parallel, unchanged files
  remembered). Go tests, unit tests and self-test `m46`.
- **Polish and Spanish.** The whole interface (about 2,400 strings, the Windows setup program included) is in English,
  Polish and Spanish. On first start Monoform follows the system language (macOS/Windows language list, Linux
  locale); the welcome screen's first step and *Settings › Appearance › Language* pick another ("Like my computer",
  English, Polski, Español); changing it reloads the window with the tabs kept. Numbers and dates use the language's
  format, Polish gets its plural forms, the code editor's own phrases (search, Go to line) are translated too. Unit
  tests fail on any untranslated interface text or missing translation; self-test `m47` runs the app in Polish and in
  Spanish over a file of every kind. Messages that come from the Go side (some errors) are still English. See
  docs/TRANSLATING.md.
- **Paste into an empty tab** makes a new document in the editor for its kind: a picture in the image editor (all
  its tools), a table copied from a spreadsheet in the grid, JSON in the data view, SVG in the SVG editor, Excalidraw/
  draw.io on the board, Mermaid/Graphviz as a diagram, Markdown as a note, certificates, plain text; copied files
  open as themselves; dragging something from another tab onto an empty one works the same. It is unsaved ("Not
  saved yet") until Save, which asks where; closing asks first. Unit tests and self-test `m48`.
- **AI tools in the image editor's tool column**: below Select object, *Select subject (AI)* and *Remove object (AI)*
  are always there — greyed out with a download mark until their model is installed, when a click opens *Settings ›
  AI models* at that model (highlighted); once installed they work in place (the standard Select subject uses the
  bundled model). Self-test `m43`.
- **Updates.** At startup Monoform asks GitHub for the newest release (on by default; *Settings › About* turns it
  off; Help › Check for updates asks by hand). A new version shows a popup with what's new: *Download and install*
  downloads it with progress, checks it against the release's SHA256SUMS, saves unsaved work (after asking) and
  restarts as the new version — Windows installs through the setup program (`--update`: same folder and choices),
  a portable copy, the macOS app bundle and the Linux binary replace themselves; a copy in a folder it can't write
  (a distro package) links to the download page. *Skip this version* keeps it quiet until the next one. Go tests
  (`internal/update`: version order, checksums, replacing a running binary/bundle), self-test `m49`, and an
  end-to-end run on Linux (1.0.0 updating itself to 1.0.1 from a local stand-in for GitHub, `m49real`).
- **Fix: changing the text or interface size left the editor mis-measured** (clicks and the caret landed on the
  wrong line until a restart): the code editor kept the old line height. It now re-measures when either changes, and
  the interface-size slider applies when released (it showed the value while dragging but rescaled the menu under
  the pointer on every step). Self-test `m50`.
- **Image editor: drag layers** up and down the Layers panel to restack them (a line shows where it lands; undoable);
  **paint bucket** (G): a click fills the area of similar colour on the active layer with the current colour, only
  inside the selection when there is one, with Tolerance and Contiguous in the toolbar (the magic wand's fill, off
  the main thread). Self-test `m51`.
- **AI models download side by side**, and *Settings › AI models* offers *Download all* (one question, the shared
  runtime counted once) when more than one is missing; each row shows its percentage. Go test (two installs at once
  fetch the shared runtime once) and self-test `m43`.
- **Watermark removal** in the image editor (*Image › Remove a watermark…* opens *Adjust › Clean up*): *Light
  marks* turns pale marks white — a light watermark, scanner shading — and keeps dark lines and text, also where
  they cross the mark; *A colour* (picked in the image with the eyedropper) turns one colour white, with a
  tolerance. Both preview live on the GPU, work inside a selection and undo. For a watermark over a photo, the new
  **selection brush** paints over it, then *Remove object (AI)* fills it in (the button is on the brush's toolbar).
- **Plain background removal without AI**: *Remove background* first checks the picture's border; when it is one
  colour (a drawing, a scan, a product on white) that colour turns transparent the way "colour to alpha" does —
  soft edges fade instead of keeping a white fringe, solid parts stay solid in their own colour. In a drawing
  (mostly background) closed areas go too (the inside of a circle); otherwise only background connected to the
  border goes, so white parts of a subject stay — the toast offers the other choice. A busy border goes to the
  model as before; *Image* also has *Remove a plain background (one colour)* and *Remove background with AI*.
  Unit tests (`plainbg.test.ts`) and self-test `m52`.
- **Word documents: a real document editor.**
  - **Lists**: read from numbering.xml and from paragraph styles (bullets, numbers, letters, roman numerals, Word's
    counting, levels, hanging indents); bulleted / numbered list buttons (Ctrl+Shift+8 / 7), Tab / Shift+Tab and the
    level buttons, Enter on an empty item and Backspace at its start end it.
  - **Formatting**: font, size, text colour, highlight, superscript / subscript, clear formatting; alignment
    (Ctrl+L/E/R/J), indent, line spacing; Title and Heading 1–6.
  - **Insert**: links (Ctrl+K; Ctrl+click opens), pictures (also pasted ones), tables (with rows and columns added or
    removed, and column widths and row heights resized by dragging their borders), page breaks (Ctrl+Enter).
  - **Find and replace** (Ctrl+F / Ctrl+H, match case, replace one or all); **paste** keeps bold/italic, colours,
    links, headings, lists and tables (Ctrl+Shift+V pastes plain text).
  - **Dark page** in the dark theme (with drawings and diagrams), switchable in the toolbar.
  - Saving writes only what changed; new list definitions, styles, pictures and links are added to the package with
    their content types and relationships. The files open in LibreOffice and python-docx as edited. .odt documents
    keep the earlier, simpler toolbar (bold, italic, underline, strikethrough, headings 1–3).
  - Unit tests (docxNumbering, docxFormat, docFindPaste), Go test for added parts, self-tests `m53`–`m55`.
- **Drawing board (Excalidraw / draw.io) fixes**: the style you pick (colour, fill, line width, dash, corners, fill
  style, sloppiness) is now what new shapes get, kept across drawings and restarts; the style bar shows while a
  drawing tool is on, so it can be set before drawing; **Sharp / Round corners** for rectangles, diamonds and
  connectors (draw.io's rounded style too); the text being edited is no longer drawn under its edit box. Self-test
  `m56`.
- **STEP CAD models (.step / .stp)** in the 3D viewer: B-rep solids and surface models (planes, cylinders, cones,
  spheres, tori, B-spline and swept surfaces), assemblies with their placements (parts shared between
  instances, named after their products), colours on parts and faces, drawn edges, read in the load worker with
  progress. Own reader and tessellator (no permissive STEP kernel exists). Checked on the as1 test assembly
  (AP203 and AP214). Unit tests (parser, band and pole faces, the fixture assembly), self-test `m57`.
- **After 1.1.2 (image editor)**: **move, resize and turn a selection's outline** — with the rectangle, ellipse or
  lasso select tool a selection gets handles: drag inside it to move it, a side or corner to resize it, the round
  handle to turn it (any angle, shown by the pointer; Shift for 15° steps), so a tilted area can be selected; the pixels don't move (the earlier
  pixel-moving command is now **Transform pixels**, Ctrl+Shift+R). Shift / Alt still draw another selection to
  add or take away, and a click inside drops it. **Effects**: Black & white, Sepia and Invert join the looks as
  one list of eighteen; each chosen effect gets its own strength slider, listed below all the chips, and effects
  combine. **Turning the view** turns the whole canvas — its checkerboard and edge turned with the layers (only the
  layers turned before). **Touchpad and touch**: two fingers on a touchpad pan, a pinch zooms (a mouse wheel still
  zooms); on a touch screen one finger works like the mouse (draw, select, drag layers, selections and handles,
  bigger handles), two fingers pinch-zoom and pan, and a second finger cancels what the first began. Unit tests
  (wheelIntent, viewWith, effects), self-tests `m61` (turned canvas), `m62`, `m63`, `m64`.
- **Adjust is a list of pages, pixelate and blur with their own settings**: the Adjust panel lists Light, Colour,
  Detail, Blur, Pixelate, Effects and Clean up (a dot marks the changed ones); each opens a page with only its own
  controls and a Back button. **Pixelate** (block size) is new there — live on the GPU and limited to a selection.
  The selection bar's Blur and Pixelate buttons open their page with a visible strength already set. The **Blur
  region** and **Pixelate region** tools have a strength / block size in the tool bar and show the result inside
  the area before Enter. Self-test `m65`.
- **Canvas size** (image editor, Image › Canvas size…, Mod+Alt+C): unlike Resize the picture stays as it is and
  the canvas grows (or shrinks, cutting) around it; a 3×3 anchor says where the picture sits, and the new space is
  transparent or the current colour (painted into the bottom layer). Every layer moves with the picture; one undo
  step. Self-test `m70`.
- **Gradient tool** (image editor, Shift+G): drag from where the colour starts to where it has faded — linear or
  radial, the colour fading to transparent, white or black, reversed if wanted, with opacity; previewed while
  dragging (a guide line shows), Shift keeps the angle to 45°, only inside the selection if there is one. On a
  layer mask it fades the layer out (shown → hidden). Fix found on the way: a one-layer picture with a mask was
  saved (and copied) without its mask. Self-test `m69`.
- **Levels and Curves** (image editor, Adjust): Levels has the histogram, black point / midtones / white point,
  output black and white, and Auto (clips 0.1 % at each end); Curves edits a tone curve for RGB or for red,
  green or blue alone over the histogram — click to add a point, drag it, double-click to remove it. Both preview
  live on the GPU (one 256-entry table per channel) and stay inside the selection. Unit tests (tone), self-test
  `m68`.
- **Clone stamp and spot healing brush** (image editor, S and J): Alt-click the source, then paint — the layer as
  it was shows through a soft round brush, aligned (the source moves with the brush, a mark shows where);
  opacity and size in the tool bar, inside the selection only if there is one. The spot healing brush replaces
  what was painted over with a patch from nearby that fits its surroundings, blended seamlessly (the patch's
  texture, the light of where it goes), in the vision worker, one undo step. Unit tests (heal), self-test `m67`.
- **Select › Modify** (image editor): **feather, expand, contract, smooth, border** a selection by a number of
  pixels — from the selection bar's Modify menu, right-click › Modify selection or Ctrl+K. True (Euclidean)
  distances, so expanded corners are round and edges anti-aliased; worked out in the vision worker over the
  selection's box only. Unit tests (selmodify), self-test `m66`.
- **Turning is free** (image editor): the round handle of a layer, floating pixels or a selection no longer
  snaps within 5° of every 45° (3°, 5° or 10° were impossible); the angle shows by the pointer while turning,
  and Shift snaps to 15° steps. `m63` turns a selection 5° and, with Shift, to exactly 90°.
- **Better click-to-select (image editor)**: the bundled model is now **EfficientSAM-Ti** (was SlimSAM-77; same
  14 MB): whole thin parts (a shuttle's tail boom and pods), just the thing clicked (the orbiter, not the stack
  and its flame). Edges are snapped to the picture with a colour guided filter instead of re-deciding pixels by
  colour, which pulled clouds into a white shuttle and bit holes in it. The analysis starts when the tool is
  chosen (~15 s once per image in the app's WebAssembly runtime; ~21 s before), clicks take ~0.3–0.8 s. A face
  click still selects the whole person (a second, confirming question to the model). Unit tests (snapMask,
  pick, inner point), `m9` (disc pixel-exact, people), `scripts/efficientsam.py` rebuilds the model.
- **After 1.1.3**: **Frosted glass**, an eighth kind of blur (a few taps scattered at random within the radius —
  grainy, with a slight milky lift). **Settings** could not be scrolled to its last tiles (About…) in some window
  sizes on Windows: WebView2 squeezed the tiles to the window's height and the extra columns spilled off to the
  right; the tiles now keep their height and the page scrolls. Self-tests `m9` (frosted glass), `m59` (short
  settings page).
- **Image editor: fifteen looks** in Adjust › Effects besides black & white, sepia and invert — Vintage, Faded,
  Warm, Cool, Noir, Teal & orange, Cross-process, Lomo, Posterize, Solarize, Threshold, Emboss, Pencil sketch,
  Film grain, Thermal — one at a time with an Amount slider, previewed live on the GPU and limited to the
  selection like every adjustment. Settings tiles wrap long paths (the command-line path ran out of its tile).
  Unit test, self-test `m62`; `m59` checks no tile overflows.
- **Image editor: turning things**: **rotate / scale / move selected pixels** (selection bar, right-click, Ctrl+Shift+R)
  — the selected pixels float with the move tool's handles (any angle; Shift for 15° steps), Enter puts them back into
  their layer as one undo step, Esc puts everything back; **rotate the active layer** 90° either way or by an
  angle (live preview) from the move tool's bar, a layer's right-click menu in the Layers panel (also rename,
  duplicate, merge down, delete) and the editor's right-click menu, about the layer's middle; **turn the view**
  (not the picture) in 15° steps with the toolbar buttons or Alt+← / Alt+→, Alt+0 or the angle label
  straightens it — every tool draws under the pointer in a turned view. Self-test `m61`.
- **Fixes after 1.1.1**: the Ctrl+K palette's search box was squeezed (cut off at the top) while the list was
  long, as when it opens on the recent files; Open-file and Open-folder dialogs (Compare, Check a hash, Open…)
  started in `C:\Windows\System32` on Windows — they now start where the last dialog was answered, else in
  Documents; the start page drops its row of tool buttons (they are in the ☰ menu and Ctrl+K); in the image
  editor the move tool couldn't drag a (pasted) layer with another layer above it — even a transparent one
  caught the drag. Go test `TestOpenDir`, self-tests `m59`, `m60`.
- **Right-click menus in every editor** (the webview's own menu is off in the app, and the Wails runtime swallowed
  right-clicks outside text fields): in any text field, rich text or code editor Undo, Redo, Cut, Copy, Paste
  (rich text and pictures where the editor takes them; Paste as plain text in documents), Delete, Select all;
  Copy for selected text in previews; then the editor's own actions — code editors their line, case and search
  commands; Word documents formatting, lists, link (edit / open), the table under the pointer and Insert;
  drawings the shape under the pointer (edit text, duplicate, order, delete) and export; image, PDF, SVG, audio,
  video, 3D, CAD, data, database, compare, log and archive views their main commands. A right-click while a menu
  is open opens the menu for the new spot. Unit test (`contextMenu.test.ts`: lists name real commands), self-test
  `m58`.
- **Tighter corners** across the interface (cards, buttons, chips, menus, the installer) and **Settings as tiles**
  side by side that reflow with the window.
- **Fix: the board unit tests** expected the style without the new corner setting (broke the first 1.1.0
  release run).
- **Fix: a CI self-test (`m6`) failed on a fast runner**: the 3 GiB hash finished inside the 2.5 s it watched
  progress for. It now watches while the hash runs and tests Cancel on a fresh run.

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
| DXF (52,000 objects, 2.6 MB) | no freeze | opens in 0.5–0.8 s, worst UI frame 41–58 ms; zooming worst frame 38 ms (frames render in the worker in ~0.5 s each on llvmpipe; the page shows the previous one scaled meanwhile); moving 2,000 objects 60 ms | same |
| Compare 100,000-line files (50 changes) | no freeze | 0.26–0.42 s to show (diff 0.09–0.13 s in the worker); worst UI frame 23–135 ms when the tab opens (varies run to run: GC/worker start), jumping between changes ≤ 48 ms | same |
| 100-page PDF: first page visible | < 300 ms | 133–287 ms once the PDF module is loaded; 490–570 ms for the first PDF of a session (worker + fonts cold) | same |

The Linux numbers are from a headless VM with software rendering; ~350 ms of each start is
GTK/WebKitGTK process start-up before our page loads. Not yet measured on Windows/macOS (no machines
available here).

## Known issues
- Quick peek can't be opened with Space in Finder or Explorer: that takes a native Quick Look extension (Swift,
  signed) or a Windows preview handler (COM, C++), both outside this app's no-native-code rules; it's in Open With /
  the context menu instead. A running app shows peeked files as preview tabs (one window per app in Wails v2).
- Screenshots: on Windows the whole screen is taken and opened with Crop (no area picker without a native
  overlay); on Linux without the portal or any screenshot tool it says what to install. macOS asks once for the
  Screen Recording permission. The colour picker reads from a screenshot of the screen, not live.
- OCR: "Make searchable" skips pages with a /Rotate (turn them upright first); handwriting and very low-resolution
  scans read poorly (Tesseract's limits); languages other than English need their Tesseract language file. Text
  recognition needs WebAssembly SIMD (every supported web view has it). The first recognition of a session loads
  ~6 MB of WASM and model data (~0.8 s on the test VM).
- Drawings: shapes can't be rotated on the canvas (rotated ones are shown rotated); draw.io stencil shapes
  (`mxgraph.*` libraries: AWS, network, UML icons…) show as labelled boxes, and images must be embedded (linked
  ones show a placeholder, as the app stays offline); edited HTML labels become plain text; compressed draw.io
  pages are saved uncompressed. Excalidraw's Excalifont text uses the bundled Virgil (its predecessor) because
  Excalifont's licence isn't stated in the font. Dragging on the test VM has the odd 50–70 ms frame.
- Mermaid draws on the main thread (it measures text through the DOM, so it can't run in a worker): a drawing is
  one ~130 ms frame on the test VM. The diagram view waits for a pause in typing before redrawing.
- Graphviz layout uses dagre, not Graphviz: results differ from `dot`'s, and dense graphs with many cycles are slow
  (300 nodes / 600 random edges ≈ 10 s, in a worker with a progress note; typical dependency-style graphs of that
  size take ~0.1–0.5 s). `neato`/`fdp`-style layouts, `splines=ortho` and HTML-label tables aren't supported
  (HTML labels show their text).
- OpenDocument: new paragraphs, headings and list items use the document's own styles, but there's no style
  picker beyond Normal/Heading 1–3; images, tables and sections can't be inserted (existing ones are kept). In .ods
  files, a cell that's edited loses rich text inside it (mixed formatting within one cell). Flat XML (.fodt/.fods)
  isn't supported.
- Disk images: .dmg isn't browsable. A DMG is a UDIF container (zlib/bzip2/LZFSE/LZMA chunks) holding an HFS+ or
  APFS file system, so it needs three readers, two of them large (APFS especially); no permissively licensed Go
  library covers them. ISO images that keep their files only in UDF (Windows/Blu-ray media) show just their small
  ISO 9660 part with a note. MSI files whose cabinets use LZX or Quantum compression, or that keep them outside the
  .msi, list their files but can't extract them (MSZIP and stored cabinets — what WiX and most tools write — work).
- Start-up on the headless Linux VM is above the 500 ms budget; needs measuring on real hardware.
- Opening a 50 MB file has one or two 80–120 ms frames on the software-rendered VM (budget 50 ms).
- Markdown preview code blocks are not syntax-highlighted, and task lists (`- [ ]`, `- [x]`) show as plain text, not checkboxes.
- The first PDF opened in a session takes ~0.5 s to show page 1 (cold worker/fonts); later ones meet the 300 ms budget.
- PDF: applying a page operation, compression, signatures or redactions reloads the document; pdf.js's first repaint of it is one ~170–250 ms frame on the test VM. Redacted pages become images (by design: nothing under the boxes survives), so their text is no longer selectable — OCR (planned) can bring it back. Signatures are images, not cryptographic (certificate) signatures.
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
- Databases: SQLite only (no server databases — they'd need network access); WITHOUT ROWID tables and views are edited through the SQL console, not the grid; BLOBs are shown summarised, not edited.
- Video effects: starting a render or a track sets up WebKitGTK's codec pipelines on the main thread — one 80–170 ms UI frame on the test VM; the frame loop itself stays under ~60 ms.
- Video effects: tracking follows translation (not rotation or scale) and stops when the object is lost or covered; overlays and effects aren't saved inside the original file — render, or they're lost when the tab closes (the tab asks first).
- Video: rotation is saved for MP4/MOV only (WebM/MKV have no standard rotation flag); fragmented MP4 (some screen recorders, DASH) and AVI/OGV are play-only.
- Video playback depends on the system's codecs: on Linux, H.264/HEVC/AAC need GStreamer's libav or bad plugins (the app explains this and still lets you edit and save).
- 3D: the first model opened in a session has one ~90–115 ms frame on the software-rendered VM (creating the WebGL context and compiling shaders, which WebKitGTK does synchronously even with `KHR_parallel_shader_compile`); later opens stay ≤ 55 ms.
- 3D: on the software-rendered Linux VM (llvmpipe) a floor-grid line passing under the camera can show as a wide grey bar; the same scene renders correctly in Chromium's software renderer, so it looks like a llvmpipe/WebKitGTK rasterisation bug. Toggle the grid (G) if it appears.
- 3D: glTF files with KTX2/Basis textures (`KHR_texture_basisu`) aren't supported yet (clear error); FBX files with external textures need them next to the model; USD support is three.js's (USDA/USDC/USDZ geometry and materials, no variants or skeletal animation).
- Applying a large blur (40 px, lens/motion) on the software-rendered VM is one 40–150 ms frame (WebGL on llvmpipe); real GPUs render it in a few ms.
- HEIC/HEIF depends on a decoder the system has (see M24); without one the app says what to install. HEIC can't be written. Animated WebP is saved losslessly (larger than lossy originals); GIF frames are re-quantised on save. Font preview reads names from WOFF2 only through the browser (no metadata panel for WOFF2).
- CAD: binary DXF and DWG aren't supported (DWG is a closed format; save as ASCII DXF). Dimensions, hatches' patterns, multileaders, tables, images and 3D solids are shown but not edited (dimensions can be deleted, recoloured or moved to another layer; moving one needs its block regenerated). Text uses a sans-serif stand-in for SHX/TTF styles. Selecting or moving thousands of objects at once costs one 55–60 ms frame on the test VM.
- Object selection analyses the whole image once (~15–18 s on the test VM, single-threaded WASM); clicks are fast afterwards. Background removal uses a small model (U²-Netp) — fine hair and glass are approximate. Edge refinement fixes edges within a few pixels of the model's outline; if the model picks the wrong region (e.g. part of a second person), add/exclude with Shift-/Alt-click.
- Grid: one rectangular selection at a time (no Ctrl+click multi-ranges); a CSV paste wider than the table is cut
  at the last column (with a notice) — add columns first; rows can't be reordered by dragging their numbers.
- Grid: in .xlsx, editing a date-formatted cell shows the stored serial number (e.g. 46327), not the date.
- CSV undo history is cleared by changing the delimiter or header setting; .xlsx undo by inserting/deleting rows.
