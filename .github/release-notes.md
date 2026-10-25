## What's new

- Smooth, quick animations across the interface: the command palette, menus, dialogs, notifications, side panels, switching and closing tabs. Settings › Appearance › Reduce motion turns them off (they are also off when your system asks for less motion).
- The sidebar can be hidden from a button in its header (Ctrl+B as before, or drag its edge away); narrowed, it no longer spills its buttons over the tabs.
- At large interface sizes a long file tree no longer pushes the status bar out of the window.
- Word documents: Ctrl+B bolds and Ctrl+K inserts a link; code editor: Ctrl+/ comments lines.

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
