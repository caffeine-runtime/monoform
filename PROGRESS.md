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
- Markdown preview code blocks are not syntax-highlighted.
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
