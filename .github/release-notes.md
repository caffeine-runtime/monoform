## What's new

- **A compact sidebar**: drag the sidebar's edge and it narrows, then becomes a strip of icons (Files, Find, Open folder, your pinned and recent files, Settings, the menu) with labels beside them, then hides. Its header button or **Ctrl+Shift+B** switches between the full sidebar and the strip; Ctrl+B still hides it.
- **Resizable side panels**: the outline beside a note, a 3D model's parts, image adjustments, SVG properties and the other editors' side panels are as wide as you drag them, and remember it. Double-click the edge for the usual width.
- **Smoother sidebar**: a line now sets it apart from the editors' toolboxes beside it. Going between the full sidebar and the strip, the logo stays put while the name folds into it, the lists slide away and the strip's icons pop in one after another; files glide to their new place in the lists.
- **Animations: System · On · Off** in Settings › Appearance. With *System* Monoform follows your system, and Windows asks for no animations whenever *Animation effects* is off (also after *Adjust for best performance*). Choose *On* to have them anyway.
- **Markdown in colour**: in a note's source, the marks of formatting each have their colour: `**` of bold in red, `*` of italic in purple, `#` of headings, code backticks, list bullets and task boxes, quotes and links. Struck text, task lists and tables are recognised as on GitHub.

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
