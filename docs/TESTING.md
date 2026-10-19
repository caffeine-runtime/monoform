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

| `m8` | fixtures dir | creates Markdown, Word, spreadsheet, CSV, SVG, HTML, JSON, text and PNG files (size + background pickers) in the open folder with free default names, each opening in its module; extension added when omitted; the type picker command; × on a recent row removes exactly that entry; Settings: theme switch, recents listed, × and "Clear" work, turning recents off forgets folders and records nothing |

| `m9` then `scripts/verify-images.sh <dir>` | fixtures dir (`HIA_TIMEOUT=400`) | layers: add, paint, hide, 50 % opacity blend, duplicate, delete, reorder, merge, undo; eraser → transparent pixels survive a PNG save; rect selection copy (crop + position), paste as layer, delete pixels; magic wand bounds on the disc, Shift-add; text in Source Serif; saturation −100 desaturates (UI frames logged); background removal (corner alpha 0, subject 255, timings + UI frames); object selection on the disc and the square (timings); 30° rotation enlarges the canvas with transparent corners; 2-layer .ora round trip keeps names and editable text; Save a copy leaves the original untouched; "keep originals" makes Ctrl+S write a copy. The script checks the .ora with Python's zipfile/xml (mimetype first and stored, stack.xml, PNG layers, merged image, thumbnail). |

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
- [ ] CSV: header toggle and delimiter override re-read correctly; click a header to sort (asc → desc → off); filter as you type.
- [ ] Grid: arrows/PageUp/PageDown/Ctrl+Home/End; type or Enter/F2 to edit, Enter/Tab commit, Esc cancels; Ctrl/Cmd+C copies a cell; drag header edges to resize.
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
