# Monoform — notes for coding agents

Monoform (formerly Hold It All) is a free, open-source (MIT), AI-written cross-platform desktop app (Wails v2.17.0 + Go 1.26.0 + Svelte 5/TypeScript/Vite) that opens and edits everyday
files: text/Markdown, PDF, images (layered editor), SVG, HTML, JSON/YAML/CSV, Word/Excel, archives, hashes, 3D models,
audio and video. Offline, no telemetry, permissive licenses only.

Read first: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (tools, commands, layout, rules) ·
[PROGRESS.md](PROGRESS.md) (state, known issues) · [docs/DECISIONS.md](docs/DECISIONS.md) (why things are as they
are, dependency licenses) · [docs/TESTING.md](docs/TESTING.md) (self-tests) · [docs/RELEASING.md](docs/RELEASING.md).

## Commands (Linux)

```sh
cd frontend && npm ci && npm run check && npm test && cd ..   # frontend types + unit tests
./scripts/build.sh                                             # frontend + app → build/bin/monoform
go vet -tags webkit2_41 ./... && go test -tags webkit2_41 ./...  # needs frontend/dist from a build
wails generate module -tags webkit2_41                         # after changing bound Go methods
python3 scripts/fixtures.py /tmp/fx && scripts/selftest.sh m12 /tmp/fx   # in-app self-test (Xvfb)
python3 scripts/licenses.py                                    # must say "0 need attention"
scripts/readme-media.sh                                        # re-record README clips + gallery (after a build)
```

Always pass `-tags webkit2_41` on Linux. On Windows/macOS run the Go/Vitest/svelte-check tests; CI runs the
self-tests.

## Must hold

- Only permissive licenses (MIT/BSD/Apache-2.0/ISC/CC0/OFL/Unlicense). No GPL/LGPL/AGPL/MPL. No cgo beyond Wails.
  Record every new dependency and its license in docs/DECISIONS.md.
- No network access, except: the opt-in, consented model downloads (search by meaning, and the image editor's AI
  models in Settings › AI models), and the update check (one request to GitHub's releases API at startup, on by
  default, off in Settings › About; downloading an update only after the user chooses it).
- Every user-visible string goes through `t()`/`tn()` (core/i18n.ts) with Polish and Spanish entries in
  src/locales/ — see docs/TRANSLATING.md; `npm test` fails on untranslated text.
- Responsiveness: no main-thread task > 50 ms, progress for > 300 ms, feature code lazily loaded, entry bundle
  < 200 KB gz. Self-tests log the longest UI frame.
- Each feature: Go tests and/or Vitest + an in-app self-test (`frontend/src/test/mNN.ts`, added to CI) + updates
  to PROGRESS.md, DECISIONS.md, TESTING.md (README if user-visible).
- If a request is impossible or clearly wrong, stop and explain instead of silently working around it.
- Don't open pull requests or publish releases unless asked.
