# Developing Monoform

Everything needed to edit, build and test the project — for people and for coding agents (Claude Code on the
desktop or the web, etc.). The short version for agents is in [`../CLAUDE.md`](../CLAUDE.md).

## Stack

| Part | Technology |
|---|---|
| Desktop shell | [Wails](https://wails.io) **v2.17.0** (Go backend + system webview: WebView2 on Windows, WKWebView on macOS, WebKitGTK 4.1 on Linux) |
| Backend | Go **1.26.0** (`go.mod`), pure Go apart from what Wails/the webview needs (no other cgo) |
| Frontend | Svelte 5 + TypeScript + Vite (in `frontend/`), no React |
| Tests | Go `testing`, Vitest, `svelte-check`, in-app self-tests driven inside the real webview |
| CI / releases | GitHub Actions (`.github/workflows/build.yml`), see [RELEASING.md](RELEASING.md) |

## Software to install

### Required on every OS

| Tool | Version | Check | Notes |
|---|---|---|---|
| Go | **1.26.0** or newer 1.26.x | `go version` | Some dependencies (pdfcpu, x/crypto) require 1.26 |
| Node.js + npm | **22** LTS | `node --version` | CI uses 22 |
| Wails CLI | **v2.17.0** exactly | `wails version` | `go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.0` (lands in `~/go/bin`; put that on `PATH`) |
| Git | any recent | `git --version` | |
| Python 3 | 3.10+ | `python3 --version` | fixtures, license audit, verifiers (standard library only) |

`wails doctor` checks the platform pieces below.

### Linux (Ubuntu 24.04 / Debian 13 / Fedora 40 or newer)

```sh
# Build
sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
# Audio/video playback in the app and in the self-tests
sudo apt install gstreamer1.0-plugins-good
# Self-tests and their verifiers
sudo apt install xvfb openbox xdotool imagemagick qpdf poppler-utils p7zip-full unzip
# Optional
sudo apt install ffmpeg           # deeper checks in internal/video tests; regenerating media fixtures
sudo apt install libreoffice      # scripts/verify-office.sh and regenerating Office fixtures
sudo apt install gstreamer1.0-libav  # to *play* H.264/AAC locally (not needed to build or test)
```

WebKitGTK **4.1** needs the Go build tag `webkit2_41` — `scripts/build.sh` adds it automatically; add
`-tags webkit2_41` yourself to `go vet`, `go test`, `wails dev` and `wails generate module`.

### Windows 10/11

- WebView2 runtime (preinstalled on current Windows).
- No C compiler is needed (Wails uses pure-Go WebView2 bindings on Windows).
- The in-app self-tests use Linux tools (Xvfb); on Windows run the Go/Vitest/svelte-check tests and rely on CI
  for self-tests.

### macOS 11+

- Xcode command-line tools: `xcode-select --install` (cgo for WKWebView).
- Universal build: `wails build -platform darwin/universal`.
- Self-tests, as on Windows, run in CI.

## First setup

```sh
git clone https://github.com/caffeine-runtime/monoform && cd monoform
cd frontend && npm ci && cd ..
go mod download
./scripts/build.sh            # Linux/macOS: frontend + app → build/bin/
```

Windows: `cd frontend && npm ci && npm run build && cd .. && wails build -platform windows/amd64`. The setup program
(`cmd/setup`) is built as in the Windows step of `.github/workflows/build.yml`; on Linux `scripts/setup-selftest.sh`
builds and runs its demo.

## Everyday commands

| Task | Command |
|---|---|
| Build the app (Linux/macOS) | `./scripts/build.sh` → `build/bin/monoform` (macOS: `build/bin/Monoform.app`) |
| Run with hot reload | `wails dev` (Linux: `wails dev -tags webkit2_41`) |
| Type-check the frontend | `cd frontend && npm run check` |
| Frontend unit tests | `cd frontend && npm test` |
| Go vet + tests | `go vet -tags webkit2_41 ./... && go test -tags webkit2_41 ./...` (needs `frontend/dist`, i.e. one frontend build first, because `main.go` embeds it) |
| License audit | `python3 scripts/licenses.py` (after a build; fails on anything not permissive) |
| Regenerate Go↔JS bindings | `wails generate module -tags webkit2_41` — after adding/changing exported methods on `internal/app.App`; commit `frontend/src/wailsjs/` |
| Make test fixtures | `python3 scripts/fixtures.py /tmp/fx` (re-run before each self-test session; it resets outputs) |
| Run one self-test | `scripts/selftest.sh m12 /tmp/fx` (exit 0 = PASS; prints timings and UI-frame measurements) |
| Screenshot the app | `scripts/screenshot.sh out.png "<folder>|<files>|<commands>|<search>|<palette query>|<wait ms>"` (`SHOT_DELAY=6` for slow scenes) |
| README clips and screenshots | `scripts/readme-media.sh [scene…]` (after a build; needs ffmpeg) → `docs/readme/*.webp`, `docs/screenshots/*.png` (the first run downloads the demo media, ~30 MB, into `~/.cache/monoform-demo`); `python3 scripts/readme_hero.py` redraws the banner (needs `pip install fonttools brotli`) |

Self-test scenarios and what each checks are listed in [TESTING.md](TESTING.md). Special ones: `m0-setup` then
`m0-restore` share a settings file (third argument); `m9` needs `MF_TIMEOUT=400`; `m6b` needs the search model
served locally (see TESTING.md). CI runs them all except `m6b`.

### Before every commit/push

```sh
cd frontend && npm run check && npm test && cd ..
./scripts/build.sh
go vet -tags webkit2_41 ./... && go test -tags webkit2_41 ./...
python3 scripts/fixtures.py /tmp/fx && for s in m1 m2 m3 m4 m4b m5 m6 m8 m10 m11 m12 m13 m14; do scripts/selftest.sh $s /tmp/fx || break; done
python3 scripts/licenses.py
```

Run the self-tests of the area you touched at least; CI runs everything.

## Repository layout

```
main.go                 Wails entry point (window, asset server, bindings)
wails.json              app name, version, file associations
internal/app            everything the frontend calls (bound methods) + HTTP routes for data
internal/server         local data channel (/__mf/*): file reads/saves, uploads, folder-scoped page route
internal/media          loopback HTTP server that streams audio/video to <audio>/<video>
internal/<feature>      archive, audio, filetype, fs, hash, imaging, jobs, newfile, office, pdf, search,
                        semantic, settings, video — plain Go packages with their own tests
frontend/src/main.ts    boot; frontend/src/shell = window chrome (sidebar, tabs, palette, status bar)
frontend/src/core       shared state and services (tabs, commands, keys, jobs, backend calls, settings)
frontend/src/modules    one folder per file type; registered in modules/registry.ts, loaded lazily
frontend/src/test       in-app self-test scenarios (only loaded when MF_TEST is set)
frontend/src/wailsjs    generated bindings (don't edit by hand)
scripts/                build, self-test, fixtures, verifiers, license audit, screenshots
build/                  packaging: icons, macOS Info.plist, Linux .desktop + install.sh
cmd/setup/              the Windows setup program (Wails; UI in frontend/setup, logic in internal/setup)
third_party/            our own replacement for a dependency with an unwanted license (see DECISIONS.md)
docs/                   DECISIONS (design + every dependency's license), TESTING, RELEASING, this file
PROGRESS.md             what's done, measured performance, known issues
```

## Rules of the project

These come from the original brief and are checked in review and CI:

- **Licenses:** only MIT, BSD, Apache-2.0, ISC, CC0, OFL, Unlicense (and similar permissive ones). No GPL, LGPL,
  AGPL or MPL — not even indirectly. Every new dependency goes into the table in `docs/DECISIONS.md` with its
  license, and `scripts/licenses.py` must report 0 problems.
- **No cgo** beyond what Wails needs. Prefer pure-Go libraries.
- **Offline and private:** no network calls, telemetry or accounts. The exceptions: the opt-in model downloads
  (search by meaning, image AI models), after explicit consent, and the update check at startup (one request to
  GitHub's releases API, off in Settings › About; an update is downloaded only when the user chooses to).
- **Translated:** every interface string goes through `t()`/`tn()` with Polish and Spanish catalog entries
  (docs/TRANSLATING.md); `npm test` checks it.
- **Fast:** start < 500 ms, initial JS bundle < 200 KB gzipped (keep feature code in lazily loaded modules), no
  main-thread task over 50 ms (move work to Go, a Web Worker, or chunk it), show progress for anything over 300 ms.
  Self-tests log the longest UI frame (`measureJank`) — keep an eye on it.
- **Plain files:** open and save standard formats; never lock users into our own format.
- **Keyboard first:** every action is a command (`core/commands.ts`) reachable from Ctrl/Cmd+K.
- **Stop and explain** if something requested is impossible or clearly wrong, instead of working around it silently.
- **Docs move with the code:** each milestone updates `PROGRESS.md` (done / next / known issues / performance),
  `docs/DECISIONS.md` (choices + dependency licenses) and `docs/TESTING.md` (new scenarios), and the README when
  user-visible.

## How a feature is usually added

1. **Backend** (if needed): a package under `internal/`, with tests; bound methods in `internal/app/<feature>.go`
   (long work runs as a job: `a.Jobs.Start(...)`, which the frontend awaits with `jobs.run(...)` and shows in the
   status bar); then `wails generate module -tags webkit2_41`.
2. **Frontend module:** `frontend/src/modules/<name>/` with `index.ts` (registers commands, exports the
   component), the Svelte component, and logic in plain `.ts` files with Vitest tests. Register it in
   `modules/registry.ts` (extensions, MIME types, lazy `import()`), and the file kind in
   `internal/filetype` if it's a new type.
3. **Self-test:** `frontend/src/test/mNN.ts` using test hooks the component exposes on its tab
   (`(tab as any).fooTest = {...}`), fixtures generated in `scripts/fixtures.py`, registered in
   `test/selftest.ts`, added to the self-test loop in `.github/workflows/build.yml`, and described in TESTING.md.
4. **Docs** as above; for user-visible features a gallery screenshot — a `still-<name>` in `frontend/src/test/demo.ts`
   and `scripts/readme-media.sh`, recorded from the demo folder (`scripts/demo_files.py`) — and a README line.

## Things that are easy to trip over

- **Linux build tag:** forgetting `-tags webkit2_41` gives "Package webkit2gtk-4.0 was not found".
- **`go vet`/`go test` on a fresh clone** fail with "pattern all:frontend/dist: no matching files" until the frontend
  has been built once.
- **Bindings:** after changing a bound method's signature, regenerate them, or the frontend calls the old shape.
- **Media files can't be loaded from `wails://`** in WebKitGTK/WKWebView — that's why `internal/media` serves
  audio/video over loopback HTTP; use `api.MediaURL()`/`AudioOpen`/`VideoOpen`, not `fileUrl()`, for `<audio>` and
  `<video>`.
- **Big responses cost the webview's main thread:** fetch large files in pieces (`core/fetchbytes.ts`), even from
  workers.
- **WebKitGTK quirks** found so far (details in DECISIONS.md): no `ctx.filter`, no SharedArrayBuffer (WASM is
  single-threaded), WebGL uploads of `ImageBitmap` are broken, autoplay needs a gesture (tests play muted).
- **The test VM has no GPU** (llvmpipe): timings in PROGRESS.md are pessimistic, and a few rendering artifacts are
  llvmpipe bugs (noted in PROGRESS.md).

## Commits and branches

- Work and push on the branch you've been given (today the default branch is `claude/monoform-v1-er4dqs`).
- Commit after each milestone with a message that explains the change and why; keep the repository's existing
  commit trailers if you're an agent that adds them.
- Don't open pull requests or publish releases unless asked; releasing is described in [RELEASING.md](RELEASING.md).
