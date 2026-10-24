## What's new

- Word documents: Ctrl+B makes the selection bold and Ctrl+K inserts a link (they hid the sidebar and opened the command palette).
- Code editor: Ctrl+/ comments and uncomments lines (it showed the shortcut list).
- The code editor's Ctrl+K Ctrl+U / Ctrl+K Ctrl+L case shortcuts are gone (Ctrl+K is the command palette); UPPERCASE and lowercase are in the palette and the right-click menu.

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
