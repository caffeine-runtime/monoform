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

## Next
- M3 PDF, M4 Data viewer, **M4b Office documents** (added on request: open, edit and save
  .xlsx/.docx in place; .xls/.doc open and edit, saved as .xlsx/.docx because the legacy binary formats
  can't be written faithfully with permissive libraries), M5 Archives, M6 Hashing,
  **M6b Omnisearch** (added on request: one box over file names, contents and commands; optional, off-by-default
  semantic search with a local Gemma embedding model in a worker that is unloaded when idle — needs a one-time
  model download and the Gemma licence, both to be confirmed in the UI), M7 Packaging.

## Performance (measured)

| Budget | Target | Measured | Where |
|---|---|---|---|
| Cold start → interactive | < 500 ms | 480–730 ms process start → first frame; 180–260 ms of that is the frontend (navigation → first frame) | Linux, Xvfb + llvmpipe software GL, 4 vCPU VM, no GPU |
| Initial JS bundle | < 200 KB gz | 129 KB raw entry chunk (M0) | `npm run build` |
| 50 MB / 580k-line log: open | no freeze | full text in 1.3–1.4 s; first screen sooner; worst frames 80–120 ms (one at start = first CodeMirror chunk compile, one at the end ≈ GC); idle frames ~25 ms | Linux VM, llvmpipe |
| 50 MB log: typing / scrolling | no freeze | typing worst frame 35 ms; jump-scrolling across the file 54–88 ms | same |
| 50 MB log: save | no freeze | 1.7–2.7 s, worst frame 40–57 ms (chunked upload) | same |
| Folder search | streamed | 200 files in 33–45 ms | same |

The Linux numbers are from a headless VM with software rendering; ~350 ms of each start is
GTK/WebKitGTK process start-up before our page loads. Not yet measured on Windows/macOS (no machines
available here).

## Known issues
- Start-up on the headless Linux VM is above the 500 ms budget; needs measuring on real hardware.
- Opening a 50 MB file has one or two 80–120 ms frames on the software-rendered VM (budget 50 ms).
- Markdown preview code blocks are not syntax-highlighted.
