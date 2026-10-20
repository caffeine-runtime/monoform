# Releasing a new version

Releases are built and published by GitHub Actions (`.github/workflows/build.yml`). Nobody builds release files
on their own machine: CI runs every check and self-test, builds the Windows, macOS and Linux packages with the
version stamped in, and only then publishes the GitHub release.

## Version numbers

Use [semantic versioning](https://semver.org) without a leading `v` in the version itself:

| Kind | Example | Published as |
|---|---|---|
| Normal release | `2.1.0` | the repository's latest release, tag `v2.1.0` |
| Bug-fix release | `2.1.1` | latest release, tag `v2.1.1` |
| Test build for others | `2.2.0-beta.1`, `2.2.0-rc.1` | **pre-release** (anything with a `-suffix`), tag `v2.2.0-beta.1` |

Rules of thumb: new features → bump the minor number (`2.1.0` → `2.2.0`); only fixes → bump the patch number;
something users must relearn, or settings/file formats that change incompatibly → bump the major number.
A version can be published only once: GitHub refuses a second release with the same tag.

The version is checked in CI (`x.y.z` with an optional `-suffix` or `+build`); anything else stops the run before
building.

## Before releasing

1. The commit you release is on GitHub (pushed) and its last **Build** run is green
   (repository → **Actions → Build**). If you're unsure, run the workflow once without a version first.
2. `PROGRESS.md` describes what's in this version and its known issues — the release notes point there.
3. Optional but recommended for a non-beta: go through the manual checklist in `docs/TESTING.md` on Windows and
   macOS with the previous release's files or a build from **Actions → Build → a run → Artifacts**.

## Publish — option A: from the GitHub website (no tools needed)

1. Open the repository on GitHub → **Actions** → **Build** (left list) → **Run workflow** (right side).
2. **Use workflow from:** the branch to release (today: `claude/hold-it-all-v1-er4dqs`, the default branch).
3. **Version:** e.g. `2.1.0`. Leave it empty and the run only builds and tests, without publishing.
4. **Run workflow.** It takes about 10–15 minutes.
5. When the run is green, the release is on the repository's **Releases** page with:
   - `hold-it-all-amd64-installer.exe` — Windows installer
   - `hold-it-all-windows-amd64-portable.zip` — Windows, no install
   - `hold-it-all-macos-universal.zip` — macOS app (Apple Silicon + Intel)
   - `hold-it-all-linux-amd64.tar.gz` — Linux binary, the `holdit` command, `.desktop` files (app and Quick peek)
     and `install.sh`
   - every package includes `holdit` (inside the macOS app bundle; next to the Windows exe)
   - `SHA256SUMS` — checksums of all of the above

The tag (`v2.1.0`) is created by the release on the commit the run built.

## Publish — option B: push a tag (command line)

```sh
git checkout claude/hold-it-all-v1-er4dqs   # the branch to release
git pull
git tag -a v2.1.0 -m "Hold It All 2.1.0"
git push origin v2.1.0
```

Pushing a tag that starts with `v` starts the same workflow; the version is the tag without the `v`.

## Publish — option C: from an agent or the `gh` CLI

```sh
gh workflow run build.yml --ref claude/hold-it-all-v1-er4dqs -f version=2.1.0
gh run watch            # follow it
gh release view v2.1.0  # check the result
```

Agents with the GitHub MCP tools use `actions_run_trigger` with `method: run_workflow`, `workflow_id: build.yml`,
`ref: <branch>` and `inputs: {"version": "2.1.0"}`, then watch the run with `actions_list` and read failures with
`get_job_logs`.

## What the workflow does

1. **check** — `svelte-check`, Vitest, frontend build, `go vet`, `go test`, the license audit (`scripts/licenses.py`).
2. **selftest** — builds the Linux app and runs every in-app self-test under Xvfb, plus the PDF, archive and image
   verifiers.
3. **build** (Linux, Windows, macOS in parallel) — sets the version: it is compiled into the binary
   (`-ldflags -X github.com/caffeine-runtime/hold-it-all/internal/app.Version=<version>`, shown in **Settings**) and
   written as `productVersion` (the `x.y.z` part) into `wails.json`, which the Windows installer and macOS
   `Info.plist` use. `wails.json` in the repository is not changed.
4. **release** — only when a version was given or a `v*` tag was pushed, and only if all jobs above passed:
   downloads the three packages, writes `SHA256SUMS`, and runs `gh release create` with the notes from
   `.github/release-notes.md` (`{{VERSION}}` is replaced) followed by GitHub's automatic list of changes.

To change what the release page says, edit `.github/release-notes.md`.

## If something goes wrong

- **A check or self-test failed:** nothing was published. Open the failed job's log, fix the problem, push, and run
  the workflow again with the same version.
- **The release job failed after creating the release** (rare — e.g. an upload error): delete the half-made release
  and its tag (Releases page → the release → **Delete**; then `git push origin :refs/tags/v2.1.0` or delete the tag
  under **Tags**), then run again with the same version.
- **A published release is broken:** don't reuse its version. Fix it and publish the next patch version
  (`2.1.1`). If it must disappear, mark it as a pre-release or delete it on the Releases page.
- **"bad version"** in the build job: the version doesn't look like `2.1.0` / `2.1.0-beta.1`.

## Not done yet (by design or missing accounts)

- **Code signing.** Windows SmartScreen and macOS Gatekeeper warn about unsigned apps. Signing needs a Windows
  code-signing certificate and an Apple Developer account (for signing + notarization); both would be added as
  repository secrets and steps in the build job.
- **Auto-update.** The app never contacts the network, so it doesn't check for new versions; users download new
  releases themselves.
- **Linux distribution packages** (.deb, Flatpak, AppImage) — see `docs/DECISIONS.md` (Packaging) for why the
  tarball is used.
