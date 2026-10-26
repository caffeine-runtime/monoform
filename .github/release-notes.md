## What's new

- **Save and convert** (File menu, the image and audio editors' Save menus, Ctrl/Cmd+Alt+Shift+S): save a file and also get it in another format next to it. Notes and Word documents as PDF (laid out by Monoform with its own fonts, page numbers and an outline), Word, a web page or text; pictures as JPEG, PNG, WebP, TIFF, icons or PDF; audio as FLAC or WAV; CSV, Excel, OpenDocument and JSON tables as Excel, CSV, JSON or a printable PDF. **Also update it every time I save** keeps the copy current.
- **Convert without opening**: right-click files in Explorer, Dolphin, Nautilus (Scripts) or Nemo → **Convert with Monoform…** opens a small window with just the formats; a whole selection converts at once. In the app, the sidebar's right-click menu has **Convert…**.
- `monoform convert IN OUT` converts every one of these pairs from a terminal.
- **Write on PDFs like in a notebook**: a marker (highlight anywhere, by hand), lines, arrows, rectangles and ellipses (Shift keeps them straight or even), a stroke eraser, colour swatches with thin/medium/thick, and blank, lined, squared or dotted pages to insert (Page operations). Everything is saved as standard annotations other PDF readers show. Pen, text and highlight colours apply again.
- **Word wrap is on by default**: long lines continue on the next row in every text editor. The Markdown tool bar has a **Word wrap** button; it, Alt+Z, the menu and Settings all change the same setting.
- **Add-ons**: the optional models some image tools use are now called add-ons; download or remove them in **Settings › Add-ons**.
- **Nightly builds, if you want them**: tick **Settings › About › Also offer nightly builds** (off by default) to be offered test builds between releases. The next normal release replaces a nightly.
- Longer labels fit: the image editor's layer properties in German and the Word tool bar's font field in Polish.

## Downloads

| System | File |
|---|---|
| Windows 10/11 | `monoform-amd64-installer.exe` (installer; making it the default app is an unchecked option) or `monoform-windows-amd64-portable.zip` |
| macOS 11+ (Apple Silicon and Intel) | `monoform-macos-universal.zip` — unsigned: the first time, right-click the app and choose **Open** |
| Linux x86-64 | `monoform-linux-amd64.tar.gz` — unpack and run `./install.sh` (needs WebKitGTK 4.1) |

`SHA256SUMS` lists the checksums of all files (Monoform can verify it: open the file in the app).

Builds are not code-signed yet, so Windows SmartScreen and macOS Gatekeeper will warn on first launch.
Everything runs offline; no telemetry, no account. Monoform is free and open source (MIT).

Version {{VERSION}}. What's done and what's known not to work yet: see `PROGRESS.md` in the repository.
