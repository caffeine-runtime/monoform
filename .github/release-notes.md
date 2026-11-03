## What's new

- **Select several layers** in the image editor: in the Layers panel, Shift+click selects the layers from the one you clicked before, and Ctrl+click (⌘ on a Mac) adds or removes one. **Copy** then takes what's on them together, as you see it, and pasting makes it one layer. Cut, Delete and To layer (Ctrl+J) work on all of them too; painting and the opacity and blend settings stay with the layer you clicked last.

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
