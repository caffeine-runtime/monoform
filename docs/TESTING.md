# Testing

## Automated

| What | Command |
|---|---|
| Go unit tests | `go test ./...` |
| Frontend unit tests (Vitest) | `cd frontend && npm test` |
| Type check | `cd frontend && npm run check` |
| In-app self tests (Linux) | `scripts/build.sh && scripts/selftest.sh <scenario> <arg> [settings.json]` |

`scripts/selftest.sh` runs the real binary (real WebKitGTK webview) with `HIA_TEST=<scenario>`; the
frontend loads `src/test/<milestone>.ts`, drives the app through the same APIs and shortcuts a user
would, and exits 0 on pass. Without a display it starts `Xvfb :99` and `openbox` (keyboard focus
needs a window manager).

| Scenario | Arg | Checks |
|---|---|---|
| `m0-setup` then `m0-restore` (same settings file) | a folder containing `a.txt`, `b.md`, `c.txt` | palette opens on Ctrl+K and lists every available command; fuzzy ranking; theme toggle changes colours; tabs, active tab, folder, theme and pins survive a restart; inactive tabs are not loaded |
| `m1` (or `m1-roundtrip`, `m1-external`, `m1-search`, `m1-markdown`, `m1-large`, `m1-baseline`) | fixtures dir from `scripts/fixtures.py <dir>` | 11 encoding/line-ending files save byte-identical unchanged and after edit+undo; real edits keep UTF-16 BOM + CRLF; external change shows the reload banner, own saves don't; folder search counts, regex, click-to-reveal; markdown preview, live update, image paste into `assets/`, view modes, relative links; 50 MB log opens, scrolls, types, saves with frame gaps logged |

| `m2` | fixtures dir | open PNG; crop, arrow, blur; undo/redo; save as JPG; reopen: size = crop, mean error < 6/255, blurred area smooth, arrow red, untouched area unchanged; rotate/flip/resize; save PNG/WebP/GIF/BMP and decode back; GIF opens animated, ← / → navigates the folder; SVG is view-only |

| `m3` then `scripts/verify-pdf.sh <dir>` | fixtures dir | 100-page PDF: first-page time, 100 search matches, thumbnails; free-text + ink + highlight annotations saved; form text field + checkbox filled and saved; reorder/rotate/append/delete then Save As; extract and split. The script then checks every output with **qpdf --check** and **poppler** (`pdftotext`, `pdfinfo`): annotation subtypes present, form values stored, page order/rotation, extract order, split page total. |

| `m4` | fixtures dir | invalid.json error at line 4 col 6 (same as Python's json), clicking it puts the cursor there; tree expand, copy path `$.nested.deep.list[2]["x key"]`, minify/format, save; YAML tree, "As JSON", YAML error line; semicolon CSV with quoted newline + CRLF detected; unchanged save byte-identical; one edited cell changes only that cell; 1M-row CSV loads, scrolls (frame gaps logged), reaches the last row, sorts numerically, filters to 125,000 rows |

| `m4b` then `scripts/verify-office.sh <dir>` | fixtures dir | .docx: headings, run formatting, list, table render; edit text, bold a word, add a paragraph, edit a table cell, save, reopen — all persisted; .doc opens with the legacy note, edits save as .docx; .xlsx: sheets, formula shown in the bar, value edit recalculates SUM, new formula computes, save; .xls opens and saves as .xlsx. The script then converts every output with **LibreOffice** (txt/csv) and checks the content, the bold run in document.xml, and that LibreOffice sees the recalculated totals. |

| `m5` then `scripts/verify-archives.sh <dir>` | fixtures dir | zip browsed and navigated; inner markdown/image open read-only in their modules; archive expands in the sidebar tree (nested folders too); zip, tar.gz, 7z and rar extract; RAR shows the read-only explanation; `slip.zip` extracts only its safe file and reports `../escaped.txt`, `/absolute.txt` and an escaping symlink; a ZIP is created from a folder + file. The script checks the created ZIP with `unzip -t`, `7z t` and Python's zipfile, and that nothing escaped. |

| `m6` | fixtures dir | MD5/SHA-1/SHA-256/SHA-512/BLAKE3 of `abc` and the empty file equal the published test vectors; pasting a matching/wrong/foreign-length hash gives match/mismatch/"different algorithm"; `SHA256SUMS` opens in the checksum view with 2 OK, 1 mismatch, 1 missing (all four rows rendered, incl. a duplicate name); BSD-style `files.md5` verifies; a sparse 3 GiB file reports progress at least every 250 ms with UI frames logged, and is cancelled from the status-bar button with no result left behind |

| `m6b` | fixtures dir; env `HIA_MODEL_DIR=<empty dir> HIA_MODEL_URL=http://127.0.0.1:8765 HIA_CACHE=<empty dir>` with the model files served by `python3 -m http.server 8765` from a copy of the pinned model (see `internal/semantic/model.go` for the four files) | search box finds text in files with the feature off and shows no "By meaning"; settings page shows the consent (license, source, memory) and nothing happens before agreeing; download is SHA-256-verified; indexing runs in two passes in the background (lock file skipped) with UI frames logged; seven queries that share no words with the files rank the right file first (and the right passage line); "By meaning" rows open the file; editing one file re-embeds only that file; the model unloads after the idle timeout and reloads on the next query; turning off unloads it and hides the section |

| `m8` | fixtures dir | the start page shows one button per new-file kind (labels fit; the Markdown note is created by clicking its button); creates Markdown, Word, spreadsheet, CSV, SVG, HTML, JSON, text and PNG files (size + background pickers) in the open folder with free default names, each opening in its module; extension added when omitted; the type picker command; × on a recent row removes exactly that entry; Settings: theme switch, recents listed, × and "Clear" work, turning recents off forgets folders and records nothing |

| `m9` then `scripts/verify-images.sh <dir>` | fixtures dir (`HIA_TIMEOUT=400`) | layers: add, paint, hide, 50 % opacity blend, duplicate, delete, reorder, merge, undo; eraser → transparent pixels survive a PNG save; rect selection copy (crop + position), paste as layer, delete pixels; magic wand bounds on the disc, Shift-add; text in Source Serif; saturation −100 desaturates (UI frames logged); background removal (corner alpha 0, subject 255, timings + UI frames); object selection on the disc and the square with exact bounds, and the disc mask compared pixel by pixel with the true disc (≤ 25 wrong pixels; 0 measured) (timings); canvas border drawn just outside the document and plain pasteboard further out; each blur kind applied to a selection over the disc's left edge softens that edge (surface blur keeps it) and leaves pixels outside the selection untouched (UI frames logged); a brush stroke across the selection edge paints only inside; Ctrl-drag with the rectangle tool makes a square with the chosen corner radius, then corners edited to sharp, undo; 30° rotation enlarges the canvas with transparent corners; 2-layer .ora round trip keeps names and editable text; Save a copy leaves the original untouched; "keep originals" makes Ctrl+S write a copy. The script checks the .ora with Python's zipfile/xml (mimetype first and stored, stack.xml, PNG layers, merged image, thumbnail). |

| `m10` | fixtures dir | SVG opens in its own module, in the Design view; Design: the inline copy of an SVG with an onclick handler, a script and a remote image is sanitized and nothing runs; dragging the circle 30 px writes exactly `transform="translate(…)"` on it while comments and indentation stay; the inspector's fill writes `fill`; the ellipse tool draws `<ellipse cx="15" cy="10" rx="10" ry="5" …>` into the source and selects it; Delete removes it, Ctrl+Z restores it; Shift+↓ nudges by 10; Ctrl+D duplicates with a unique id; Source view: size from attributes; a broken edit reports the XML error and keeps the last render; fixing it re-renders at the new size; PNG export at 2× has the right size, letterbox transparency and colours; HTML opens in the page module with CSP and base injected, title, 1 remote reference and 1 external link detected and neutralised, banner shown, iframe fully sandboxed; the folder route served the stylesheet and image but not the script; with scripts on the script is served and the iframe is still not same-origin |

| `m11` | fixtures dir | GLB: stats (1 mesh/24 vertices/12 triangles/1 texture), embedded texture arrives as pixels with the right colours, clips "Spin,Bounce" listed; clicking a clip plays it (the cube moves), clicking again pauses, the other clip rotates it; wireframe on/off; lighting off swaps in unlit materials keeping the texture and drops the environment, back on restores them; FBX lists "Wave,Nod" and plays; Draco GLB decodes (2304 triangles) through the decoder's nested worker; PBR spheres get the baked environment; a second 3D tab reuses the renderer and the canvas follows the shown tab and the remaining tab after a close; OBJ fetches its .mtl and texture through the folder route; STL triangles, PLY 1000 points, Collada parsed on the main thread; every model is checked to actually draw; open times and UI frames logged; orbiting the camera while an animation plays renders once per frame; "Save view as PNG" captures the model |

| `m12` | fixtures dir | tones.wav (3 × 1 s at different levels): info, loopback URL, waveform levels; muted playback advances; deleting the middle second shortens the timeline and playback skips it in the source; undo/redo and the dirty flag; fade out, −6 dB gain, normalize to −1 dBFS (measured in Go); Save as WAV reopens with the edits baked in; trim + FLAC export (codec/length/bit depth verified by reopening); MP3 tags and cover shown, a deletion saved in place as a lossless MP3 cut keeps tags and cover; OGG and FLAC editable with the right waveform; Opus play-only; AAC play-only (plays or explains, depending on system codecs); a 10-minute WAV is playable at once with the waveform streaming in; UI frames logged |

| `m18` | fixtures dir | Code editor on `code/sample.ts`: the minimap draws the code and a click near its bottom scrolls down; toggling hides/restores it; indent guides are drawn; Go to symbol (Ctrl+R) lists parseRecord, Ledger, addRecord, totalAmount, Record with kinds and lines, and picking one moves the cursor; in the editor Ctrl+Alt+↓ twice gives three cursors (status bar says so), Ctrl+Shift+L splits a 3-line selection, Ctrl+L twice selects two lines, Ctrl+Shift+D duplicates and Ctrl+Z undoes; "Convert to UPPERCASE" changes the word at the cursor; completion offers `totalAmount` for `tota` (longest UI frame logged) |
| `m25` | fixtures dir | `config/app.ini` → 5 settings by section, the duplicate `port` flagged, editing `host` in the table keeps the inline comment and saving writes only that change; `config/.env` (routed by name) → password and token masked, then revealed, quoted value; `config/app.properties` → `\u0020` escape and a continuation; certificates made by OpenSSL in fixtures.py: `certs/chain.pem` (10-day leaf + CA) → subject/issuer, "expiring" with days left, SANs, purpose, chain link, SHA-256, warning pill; `site.cer` (DER) and `site.csr`; `site.p12` → asks for the password, refuses a wrong one, then shows certificate, CA and a matching private key without its PEM |
| `m26` | fixtures dir | `packages/hia-test.deb` → archive view, control fields shown above the list, read-only banner, "Debian package" status, a file inside opened; `.rpm` → name/version/arch, a symlink's target; `.iso` → Rock Ridge long names browsed, extract all; `.msi` (made by wixl) → product/version/manufacturer, folders from the Directory table, a 114 KB file extracted from the embedded MSZIP cabinet; `app.jar`/`app.apk` → archive view as "JAR/APK package" |
| `m27` then `scripts/verify-odf.sh <dir>` | fixtures dir | `office/notes.odt` (LibreOffice-made): headings, "Strong" named style and automatic styles, bullet/nested/numbered lists, table, picture, footnote, date field, read-only section, tab and double space shown; last paragraph edited and a word bolded, "Step three" added with Enter, a table cell edited, saved: bold is an automatic style, note/picture/section/field/declarations kept, no duplicate `xml:id`; reopened with everything persisted and the item numbered 3. `office/budget.ods`: currency/date/percentage display, formulas (incl. cross-sheet) in the bar, an edit recalculates the total, saved as .ods and reopened. The script converts both with **LibreOffice** and checks the text, the new list item, the footnote and the recalculated total |
| `m28` | fixtures dir | `diagrams/build.dot` → 5 nodes, 5 edges, cluster label, two-line label; clicking the Parser node selects line 7; a `--` in a digraph reports line 3 and keeps the drawing; a new graph redraws; zoom/fit; PNG export written. `diagrams/flow.mmd` → Mermaid flowchart drawn (first and later render's longest frame logged), a broken edit reports an error. `diagrams/notes.md` → the Mermaid sequence diagram and DOT graph drawn in the preview, the broken Mermaid block shows its error and source |
| `m24` | fixtures dir | `img/anim.gif` → frame editor (2 frames); duplicate to 8, delete 2, undo/redo, reverse, 2× faster (100 → 50 ms), loop 3; save as GIF and as animated WebP and reopen both (6 frames, delays and loop kept); `img/sample.heic` decodes to 64×48 (logs which system decoder did it) and converts to a JPG next to it; ICO and ICNS written from an image list 7 and 11 sizes with the largest shown; `fonts/test.ttf` and `.woff` → family name, the face loaded into the page, 5 covered characters listed |
| `m23` | fixtures dir | `data/catalog.xml` → valid XML, "as JSON" shape (attributes, repeated elements, entities, CDATA), a broken closing tag reported on line 4; `data/config.toml` → JSON with dates as ISO strings and the As JSON view; `data/events.jsonl` (5,000 lines) → 5,000 records, table rows with the union of keys; `data/people.json` → table; `logs/app.log` → level counts (1 fatal, 500 error, 500 warn, 1,500 info, 500 debug), coloured error line, text filter (750), regex filter (100), level filter keeps the stack-trace lines with their error (1,501), next error twice, Follow picks up an appended line (counted as an error, tab not dirty, size tracked) |
| `m22` | fixtures dir | Compare (`compare/` pairs from fixtures.py): TypeScript files → 4 changes with stats, next change twice highlights `2`/`3` as the changed words, ignore whitespace drops the indentation change, only-changes folds the unchanged lines; JSON → changed/removed/added paths in order and 3 normalised hunks (key order ignored); CSV → rows matched by id (removed 2, changed 3 with the `city` cell, added 4) and the changes table; PNGs → exactly 100 changed pixels, swipe handle, tolerance 255 hides them; binary files → first difference at byte 8192; 100,000-line pair → 50 changes, open time and longest UI frames logged (twice), jumping through ten changes |
| `m21` | fixtures dir | PDF tools: 4 images (PNG, GIF converted via canvas, a 1200×900 photo-like PNG) → a 4-page PDF and an A4 one; compress the image PDF with JPEG 60 / 800 px (must be < 60 % of the size, images recompressed); on `pdf/tools.pdf` (page 2 rotated 90°) draw a signature in the pad (remembered in settings), click to place it on page 2, "Redact all matches" for "quick brown" (3 boxes, keep pages 1 and 3), Apply (longest UI frame logged): pages 1 and 3 have no text left, page 2 keeps its text and gains an image XObject, and the ink rendered where the signature was placed is wider than tall (upright on the rotated page); export pages as PNG; add an image as page 4; save. CI's `verify-pdf.sh` then checks the outputs with qpdf and poppler (no extractable text on the redacted page, the signature has a soft mask) |
| `m20` | fixtures dir | DXF (`cad/plan.dxf` R2000 cp1252 CRLF with layers, a block inserted 4× with rotations, bulge polyline, spline, hatch, TEXT/MTEXT, point, an off layer; `cad/r12.dxf` with padded codes; `cad/big.dxf` 52,000 objects): opens in the CAD module with the right layers, code page, units and texts; the off layer isn't drawn; the canvas has ink; pointer click picks the wall (area 60 m²), window and crossing selections pick the right objects; line with `@1000,0`, rectangle `@500,300`, circle radius `250`, 3-point arc; the cursor snaps to a corner; measure 3-4-5; move by `@100,0`, rotate text by `90` (group added), edit a radius, move a block (and undo/redo); Delete key; save → OBJECTS section and header byte-identical, $HANDSEED advanced, CRLF and cp1252 kept; SVG export; R12 polyline written as POLYLINE/VERTEX/SEQEND with padded codes; big drawing: open, wheel zoom, select and move 2,000 objects with longest UI frames logged |
| `m19` | fixtures dir | SQLite (`db/shop.db`, made by fixtures.py: customers 1000, orders 3000 with a foreign key, events 100k, a WITHOUT ROWID table, a view, an index, an update trigger): opens in the database module (open time + longest UI frame logged) with the full schema; first row values (REAL as 37.0); sort descending; search narrows to one row; a WHERE filter; row 76,544 of 100k fetched by page; two cell edits (one to NULL), a new row, two deletions → 5 pending, shown in the grid, Save writes all (checked through a separate read-only connection, trigger rows included); deleting a referenced customer fails with the FOREIGN KEY message and keeps the change pending; Revert; the SQL console runs a 3-statement script (GROUP BY, UPDATE, SELECT) and shows the last rows, and reports a missing table; CSV export of a filtered table; read-only mode ignores edits |
| `m16` | fixtures dir | Split view with a note, a CSV, an image and an STL: Ctrl+\\ shows the note and the next tab side by side at equal width (split button lit, tabs numbered); a pointer-down focuses the other pane; choosing a tab replaces the focused pane; dragging the divider to 30 % resizes the left pane; four-pane grid shows all four and fills the view; a synthetic tab drag shows a drop zone and dropping in a pane's middle replaces its tab; with two 3D panes the unfocused one keeps a still canvas; closing a tab removes its pane and the session snapshot keeps the 3-pane split; "one tab" shows only the focused tab. Interface size: two steps up = 125 % — body text 13→16.25 px, tab bar 38→47.5 px, icons larger, grid rows 35 px; reset. (CI also runs `m14` at 125 % to check pointer maths with scaled rows.) |
| `m15` | fixtures dir | Video effects on `video/clip.webm`: an image overlay animated from x=60 to x=260 over 0–2 s is drawn at x≈160 at 1 s by the live compositor; a feathered-off rectangular blur softens the yellow/blue bar edge inside it; 2× speed on 0–2 s + a cut at 3–4 s + a 0.5 s crossfade + fades give a 3.5 s output, with a transition marker, a speed band and two overlay tracks on the timeline; render → WebM probed by Go (VP9/VP8 320×180, 3.5 s, Opus) with ~87 frames, and a decoded output frame shows the overlay; the tab counts as saved. Tracking on `video/track.webm` (a 28 px bars patch moving along x = 16+60t, y = 40+10 sin 3t): 50 positions, max error < 3 px (2.5 px measured). Logs render/tracking time, decoder path (WebCodecs or `<video>`) and longest UI frames |
| `m14` | fixtures dir | CSV (`data/grid.csv`): header click selects the column and shows `Average: 2.5 · Count: 4 · Sum: 10` in the status bar; Ctrl+A; mouse drag and Shift+arrows select; copy gives Excel TSV; a 2-row paste on the last row adds a row; Ctrl+Z/Ctrl+Y; one pasted value fills the selection; Delete clears a range; cut + paste moves; dragging the fill handle continues 10, 20 → 30, 40; dragging the selection border moves A1:A2 two rows down (asks before replacing); typing `W`, `a` autocompletes `Warsaw` with the rest selected, Enter commits and moves down; save. XLSX (`office/grid.xlsx`): pasting `=SUM(B2:B3)` two columns right gives `=SUM(D2:D3)`, which recalculates after edits, undo and redo; fill right and Ctrl+D shift references; selection stats; AutoComplete from Go (`re` → `Rent`, none for numbers); save |
| `m13` | fixtures dir | WebM: info (VP9 320×180, 6 s), keyframes at 0–5 s, frames readable through CORS (snapshots) and the thumbnail strip drawn; the selection shows two drag handles and a bar with its length; cutting 1–3 s gives kept [0,1]+[3,6], flashes the cut part, labels it "removed" and toasts the change with Undo; its restore button puts it back (undone again); muted playback jumps over the cut; undo/redo + dirty flag; rotation refused for WebM; Save as → reopened: 4 s, 4 keyframes, audio + video; extract audio → audio-only file; MP4 (VP9): rotate 90° + remove audio + keep 2–4 s, saved in place → 2 s, rotation 90, no audio, rotation previewed; H.264 MP4 (not playable on the test VM): kept part saved and reopened as H.264/AAC 3 s; MKV (VP8/Vorbis) info. Go tests (`internal/video`) also decode every output with ffmpeg when installed (no errors, exact frame counts) and check rotation with ffprobe |

`bakeenv <path>` regenerates `frontend/src/modules/model3d/room-env.bin` (the viewer's pre-filtered reflection environment) — only needed after a three.js upgrade changes the PMREM format. The Draco fixture is `scripts/fixture-data/knot-draco.glb`, made once by `knot-draco.mjs` next to it.

Office fixtures live in `internal/office/testdata` and are regenerated with `scripts/office/make-fixtures.sh` (needs LibreOffice; dev-only).

`scripts/fixtures.py` modifies nothing outside the given directory; re-run it before `m1` (the round-trip test edits files).
`scripts/screenshot.sh out.png "<folder>|<files>|<commands>|<search>|<palette query>|<wait ms>"` captures the window in a given state (set `SHOT_DELAY` for long waits).

## Manual checklist (needs eyes)

Run on each OS before a release.

### Shell
- [ ] Window appears quickly with no white flash, in the OS theme.
- [ ] Sidebar is a shade darker than the main pane; selected/hovered rows are soft pills without borders.
- [ ] Headings and the app title are serif; everything else is Inter.
- [ ] Ctrl/Cmd+K opens the palette; arrows, Enter, Escape work; typing filters fuzzily.
- [ ] ☰ menu lists commands with shortcuts.
- [ ] Theme: Ctrl/Cmd+Alt+T toggles; "Theme: follow system" follows the OS live.
- [ ] Sidebar resizes by dragging its right edge; Ctrl/Cmd+B hides/shows it.
- [ ] Tabs: middle-click closes, drag reorders, dirty dot shows and turns into × on hover.
- [ ] Closing a tab with unsaved changes asks Save / Don't save / Cancel; closing the window with unsaved tabs asks first.
- [ ] Quit and relaunch: same folder, tabs, active tab, expanded folders.
- [ ] macOS: traffic lights don't overlap the title; window drags from the sidebar header and the tab bar.
- [ ] Linux: scrolling in the tree is smooth; text is crisp (WebKitGTK is the weakest webview).

### Text & markdown
- [ ] Typing feels instant; syntax colours are calm in both themes.
- [ ] Ctrl/Cmd+F opens find; Ctrl/Cmd+H replace; Ctrl+G go to line; Alt+Z wrap.
- [ ] A 50 MB log opens with its first screen quickly; scrolling with the wheel/trackpad is smooth to the end.
- [ ] Status bar shows Ln/Col, encoding, line endings; "Change line endings…" and "Change encoding for saving…" work.
- [ ] Edit the file in another editor while open → banner; Reload / Keep mine behave.
- [ ] Markdown: split / source / preview (Ctrl/Cmd+Shift+V cycles); preview follows the editor's scroll.
- [ ] Paste a screenshot into a note → `assets/pasted-….png` created, link inserted, image visible in preview.
- [ ] Drop an image from the file manager onto the note → copied into `assets/`; drag a file from the sidebar → relative link.
- [ ] Click a relative `.md` link in the preview → opens in a new tab; external links open the browser.
- [ ] Find in folder (Ctrl/Cmd+Shift+F): typing searches as you go, Stop works, clicking a result selects the match.

### Images
- [ ] Wheel zooms around the pointer; drag pans; 0 = fit, 1 = actual size; pixels are crisp (not blurry) above 200 %.
- [ ] ← / → walk the folder (asks before discarding edits); the toolbar shows "n / N".
- [ ] Crop/blur/pixelate: drag a region, adjust its handles, Enter applies, Esc cancels.
- [ ] Arrows, rectangles and text: draw, then move/resize/rotate with the move tool; Delete removes; double-click text to edit; colour swatches recolour the selection.
- [ ] Undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) across markup and raster edits.
- [ ] Save keeps the format; Save as offers PNG/JPEG/WebP/GIF/BMP; transparent PNG → JPEG gets a white background.
- [ ] Animated GIF plays; "Edit (first frame)" works. SVG scales crisply and is view-only.

### PDF
- [ ] Scrolling a 100-page PDF is smooth; pages appear blurry for a moment then sharpen when zoomed in a lot.
- [ ] Ctrl/Cmd+wheel zooms; Fit width / Fit page; page box jumps to a page; Ctrl+G go to page.
- [ ] Find (Ctrl/Cmd+F): Enter / Shift+Enter cycle, count shows "n of N".
- [ ] Highlight: select text with the highlighter tool; text comment: click to place, type; draw with the pen.
- [ ] Fill a form, save, open in another reader (Preview / Edge / Okular / Evince): values and annotations show.
- [ ] Thumbnails: drag to reorder (multi-select with Ctrl/Shift); right-click rotate/delete/extract; the banner says pages changed until saved.
- [ ] ⋯ menu: append PDFs, split into files, extract a typed range.
- [ ] External links in PDFs open in the browser; internal links jump within the document.

### Data
- [ ] JSON with an error: the toolbar shows "Line L, column C: …"; clicking jumps to it.
- [ ] Tree: arrow keys navigate/expand; big arrays page with "Show more"; Copy path / Copy value.
- [ ] Format and Minify are undoable (Ctrl/Cmd+Z in Raw).
- [ ] YAML: tree, "As JSON", Save as JSON…
- [ ] CSV: header toggle and delimiter override re-read correctly; the ▾ button in a header sorts (asc → desc → off); filter as you type.
- [ ] Grid: arrows/PageUp/PageDown/Ctrl+Home/End; type or Enter/F2 to edit, Enter/Tab commit, Esc cancels; drag header edges to resize.
- [ ] Grid like Excel (CSV and .xlsx): drag / Shift+click / Shift+arrows select a range, header and row-number clicks select columns/rows; the status bar shows Average · Count · Sum. Copy a range, paste it into Excel or LibreOffice and back (Ctrl/Cmd+C/V) — same cells; cut + paste moves; Delete clears; drag the selection border to move, Ctrl-drag to copy; drag the fill handle (1, 2 → 3, 4…; Mon → Tue…); Ctrl+D/Ctrl+R; typing the start of an existing entry autocompletes it; Ctrl/Cmd+Z undoes each step; in .xlsx a copied formula's references move.
- [ ] A 1,000,000-row CSV scrolls smoothly with the wheel and by dragging the scrollbar to the end.

### Word & Excel
- [ ] A real-world .docx (with images, headers, a table of contents, tracked changes) opens; the TOC/tracked-change paragraphs are shown read-only with a tinted edge; images display.
- [ ] Type, Enter for new paragraphs, Backspace to join, Ctrl/Cmd+B/I/U, Heading 1–3 from the style menu; undo/redo.
- [ ] Save, then open the file in Word/LibreOffice/Pages: text and formatting changes appear; headers, footers and images are unchanged.
- [ ] .xlsx: type numbers/text/`=SUM(…)` in cells or the formula bar; dependent totals update; add/rename sheets; insert/delete rows; save and open in Excel/LibreOffice — values and formulas are right.
- [ ] .xls/.doc: the note explains saving creates .xlsx/.docx; the original file is unchanged afterwards.

### Archives
- [ ] Single-click an archive in the tree opens the browser; the chevron expands it inline like a folder.
- [ ] Double-click a file inside → opens read-only in the right viewer; Save As writes a normal file.
- [ ] Extract here / Extract to… / Extract selected (Ctrl/Shift multi-select) show progress for big archives and can be cancelled from the status bar.
- [ ] An archive with `../` entries reports them as skipped and writes nothing outside the chosen folder.
- [ ] Compress to ZIP… on a folder; the result opens in Explorer/Finder/the Linux archive manager.
- [ ] RAR/7z show the read-only explanation.

### Hashing
- [ ] Palette → "Compute hash…" (Mod+Alt+H) on a multi-GB file: progress bar, time estimate, status-bar entry after 0.3 s; cancel works; UI stays usable.
- [ ] Paste a hash from a download page (with spaces / upper case / `sha256:` prefix) → green "Matches", or red with the expected/actual shown.
- [ ] Open a `SHA256SUMS` from a Linux ISO download → each file listed OK/mismatch/missing; "Verify again" after editing a file.
- [ ] Copy buttons put the lower-case hex on the clipboard.

### Search
- [ ] Ctrl/Cmd+K, type a word that appears inside files → "In files" rows with file:line; Enter opens the file at that line.
- [ ] "Turn search by meaning on/off" opens the terms; nothing downloads until the box is ticked; the status bar shows download progress and Cancel works.
- [ ] With a real notes folder: the status bar shows "Indexing for search by meaning" with a time estimate; typing stays smooth while it runs.
- [ ] A query phrased differently from the text ("money I owe" for an invoice) finds the right file under "By meaning".
- [ ] After the idle timeout the app's memory drops back (Activity Monitor / Task Manager / `ps`); the next query reloads the model (~10 s on slow machines).
- [ ] "Remove model…" deletes the model and indexes; the feature is off afterwards.

### Packaging (per platform, on real machines)
- [ ] Windows installer: components page shows "Open supported files … by default" **unchecked**; install without it → double-clicking a .md still opens the previous app, and *Open with* lists Hold It All; reinstall with it → .md/.pdf/.png open in Hold It All; uninstall → previous defaults are back.
- [ ] Windows: opening a second file while the app runs adds a tab to the running window.
- [ ] macOS: the unsigned app opens via right-click → Open; Finder *Open With* lists it for .md/.pdf/.csv; *Change All* makes it the default; double-clicking a file while it runs opens a tab.
- [ ] Linux: `./install.sh` → app in the launcher and in *Open With*; `--set-default` → `xdg-mime query default text/markdown` is `hold-it-all.desktop`; `--uninstall` removes it.

### Settings & new files
- [ ] Ctrl/Cmd+, opens Settings; theme, font size and wrap apply immediately and survive a restart.
- [ ] Hover a recent file in the sidebar → × appears in place of the folder name; clicking it removes only that entry.
- [ ] Ctrl/Cmd+Alt+N → Word document → the new .docx opens in the editor and in Word/LibreOffice.
- [ ] New image → 1080 × 1080, transparent → opens in the image editor with a checkerboard background.

### Image editor v2
- [ ] Magic wand / Select object / Select subject on a real photo; Shift adds, Alt subtracts; outline readable on light and dark areas.
- [ ] Ctrl+C on a selection, paste into another app (GIMP, a chat window) → transparent PNG of just the selection; Ctrl+V of a screenshot → new layer.
- [ ] Move tool (V): drag, rotate and scale a pasted layer; then brush on it (it is baked first).
- [ ] Adjust panel on a 20+ MP photo: sliders preview smoothly; Apply; undo.
- [ ] Remove background on a portrait and a product photo → transparent PNG/WebP opens with transparency elsewhere.
- [ ] Save with layers (.ora) → open in GIMP or Krita: layers and names present; reopen in Hold It All: text still editable.
- [ ] Settings → Keep originals → edit and Ctrl+S → "name (edited).ext" appears, original unchanged.

### SVG & HTML pages
- [ ] An SVG exported from Illustrator/Inkscape renders like in a browser; Export PNG at 4× is sharp.
- [ ] A saved web page (HTML + _files folder) shows its images and styles; remote fonts/images appear only after "Load remote content".
- [ ] A page with JavaScript (e.g. an interactive chart) works after enabling Scripts; "Open in browser" opens it in the default browser.
