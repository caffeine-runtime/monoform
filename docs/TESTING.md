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

`scripts/fixtures.py` modifies nothing outside the given directory; re-run it before `m1` (the round-trip test edits files).
`scripts/screenshot.sh out.png "<folder>|<files>|<commands>|<search>"` captures the window in a given state.

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
