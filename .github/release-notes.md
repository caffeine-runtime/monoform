## What's new

- **Parts of 3D models**: a Parts panel beside the view lists a STEP assembly's parts (or a glTF's, OBJ's or FBX's objects, or an STL's separate pieces). Click a part to select it, then **hide** it (H), **show only it** (I), see the rest **through glass** (X) or **zoom to it** (F); **Show all** (Alt+H) brings everything back. Also in the right-click menu.
- **Parts list**: each part once, with how many there are and its size; copy it into a spreadsheet or export it as CSV.
- **The sidebar keeps the name "Monoform"** when it's narrow or the interface is larger: header buttons move into the ☰ menu instead.
- **"Save your changes?"** shows the file on its own card, with its folder, so it's clear which file it's about.
- **Quick view for more files**: PDFs, Word documents, Markdown notes, songs, videos and 3D models now open in the quick view, like pictures, when Monoform is their default app. Click **Edit** for the full editor.

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
