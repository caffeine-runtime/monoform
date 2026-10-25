# Releasing a new version

Releases are built and published by GitHub Actions (`.github/workflows/build.yml`). Nobody builds release files
on their own machine: CI runs every check and self-test, builds the Windows, macOS and Linux packages with the
version stamped in, and only then publishes the GitHub release.

## Version numbers

Use [semantic versioning](https://semver.org) without a leading `v` in the version itself:

| Kind | Example | Published as |
|---|---|---|
| Normal release | `1.1.0` | the repository's latest release, tag `v1.1.0` |
| Bug-fix release | `1.1.1` | latest release, tag `v1.1.1` |
| Test build for others | `1.2.0-beta.1`, `1.2.0-rc.1` | **pre-release** (anything with a `-suffix`), tag `v1.2.0-beta.1` |

Rules of thumb: new features → bump the minor number (`1.1.0` → `1.2.0`); only fixes → bump the patch number;
something users must relearn, or settings/file formats that change incompatibly → bump the major number.
A version can be published only once: GitHub refuses a second release with the same tag.

The version is checked in CI (`x.y.z` with an optional `-suffix` or `+build`); anything else stops the run before
building.

## Before releasing

1. The commit you release is on GitHub (pushed) and its last **Build** run is green
   (repository → **Actions → Build**). If you're unsure, run the workflow once without a version first.
2. `PROGRESS.md` describes what's in this version and its known issues — the release notes point there.
   Replace the **What's new** list at the top of `.github/release-notes.md` with this version's changes: the update
   popup in installed copies shows the first lines of the notes.
3. Optional but recommended for a non-beta: go through the manual checklist in `docs/TESTING.md` on Windows and
   macOS with the previous release's files or a build from **Actions → Build → a run → Artifacts**.

## Publish — option A: from the GitHub website (no tools needed)

1. Open the repository on GitHub → **Actions** → **Build** (left list) → **Run workflow** (right side).
2. **Use workflow from:** the branch to release (normally `main`, the default branch).
3. **Version:** e.g. `1.1.0`. Leave it empty and the run only builds and tests, without publishing.
   **Skip macOS** leaves the macOS package out (use it when GitHub has no macOS runner for the account — the
   job then waits and is cancelled, and nothing is published). The release notes then say there is no macOS
   package. Agents pass `"skip_macos": true` with the inputs.
4. **Run workflow.** It takes about 10–15 minutes.
5. When the run is green, the release is on the repository's **Releases** page with:
   - `monoform-amd64-installer.exe` — Windows setup (our own, `cmd/setup`)
   - `monoform-windows-amd64-portable.zip` — Windows, no install
   - `monoform-macos-universal.zip` — macOS app (Apple Silicon + Intel)
   - `monoform-linux-amd64.tar.gz` — Linux binary, the `monoform` command, `.desktop` files (app and Quick peek)
     and `install.sh`
   - every package includes `monoform` (inside the macOS app bundle; next to the Windows exe)
   - `SHA256SUMS` — checksums of all of the above

The tag (`v1.1.0`) is created by the release on the commit the run built.

## Publish — option B: push a tag (command line)

```sh
git checkout main   # the branch to release
git pull
git tag -a v1.1.0 -m "Monoform 1.1.0"
git push origin v1.1.0
```

Pushing a tag that starts with `v` starts the same workflow; the version is the tag without the `v`.

## Publish — option C: from an agent or the `gh` CLI

```sh
gh workflow run build.yml --ref main -f version=1.1.0
gh run watch            # follow it
gh release view v1.1.0  # check the result
```

Agents with the GitHub MCP tools use `actions_run_trigger` with `method: run_workflow`, `workflow_id: build.yml`,
`ref: <branch>` and `inputs: {"version": "1.1.0"}`, then watch the run with `actions_list` and read failures with
`get_job_logs`.

## What the workflow does

1. **check** — `svelte-check`, Vitest, frontend build, `go vet`, `go test`, the license audit (`scripts/licenses.py`).
2. **selftest** — builds the Linux app and runs every in-app self-test under Xvfb, plus the PDF, archive and image
   verifiers.
3. **build** (Linux, Windows, macOS in parallel) — sets the version: it is compiled into the binary
   (`-ldflags -X github.com/caffeine-runtime/monoform/internal/app.Version=<version>`, shown in **Settings**) and
   written as `productVersion` (the `x.y.z` part) into `wails.json`, which the Windows setup and macOS
   `Info.plist` use. `wails.json` in the repository is not changed. On Windows the setup program is built next:
   `npm --prefix frontend run build:setup` (its UI), `go run ./cmd/setup/pack` (the app's files, gzipped, into
   `cmd/setup/payload`), then `wails build -webview2 embed` in `cmd/setup`. The job then installs it quietly into a
   temporary folder, checks the files, uninstall entry, file class, Start menu shortcut and `monoform` command, and
   uninstalls it again (checking that nothing is left).
4. **release** — only when a version was given or a `v*` tag was pushed, and only if all jobs above passed:
   downloads the three packages, writes `SHA256SUMS`, and runs `gh release create` with the notes from
   `.github/release-notes.md` (`{{VERSION}}` is replaced) followed by GitHub's automatic list of changes.

To change what the release page says, edit `.github/release-notes.md`.

## If something goes wrong

- **A check or self-test failed:** nothing was published. Open the failed job's log, fix the problem, push, and run
  the workflow again with the same version.
- **The release job failed after creating the release** (rare — e.g. an upload error): delete the half-made release
  and its tag (**Actions → Delete releases**, see below), then run again with the same version.
- **A published release is broken:** don't reuse its version. Fix it and publish the next patch version
  (`1.1.1`). If it must disappear, mark it as a pre-release or delete it (below).
- **"bad version"** in the build job: the version doesn't look like `1.1.0` / `1.1.0-beta.1`.

## Updates

Installed copies look for a new version at startup (`internal/update`): they read the repository's **latest
release** (pre-releases are never offered) and download the asset for their system by its file name —
`monoform-amd64-installer.exe` (Windows, installed with the setup program), `monoform-windows-amd64-portable.zip`,
`monoform-macos-universal.zip`, `monoform-linux-amd64.tar.gz` — checked against `SHA256SUMS`. Keep those names and
the checksum file in every release. A normal (non-pre-release) version reaches everyone on their next start; test a
release as a pre-release first if unsure. The release notes' "What's new" part is shown in the update popup.
Copies from the Microsoft Store don't look: the Store updates them (see below).

## Microsoft Store

Every CI run also packs the **Microsoft Store package** (MSIX) on Windows: the same `monoform.exe` and `monoform`
command, with a manifest written by `cmd/msix` from the file types the setup program registers, the logos in
`build/windows/msix/Assets` (`scripts/icons.py --msix`) and a `resources.pri` from `makepri`. CI signs a copy with a
throwaway certificate, installs it, runs `monoform version` through its alias, starts the app and removes it again.
The package itself is **unsigned** — the Store signs it — so it isn't a release file (users couldn't install it); it
is the run's `store-msix` artifact.

Inside the package the app knows it runs packaged (`update.InStore`): it never asks GitHub for updates, offers no
*Check for updates*, and Settings › About says the Store keeps it up to date.

Once, in Partner Center:
1. **Apps and games → New product → MSIX or PWA app**, reserve the name **Monoform**.
2. **Product management → Product identity**: copy *Package/Identity/Name*, *Package/Identity/Publisher* (`CN=…`)
   and *Package/Properties/PublisherDisplayName* into the repository's **Settings → Secrets and variables → Actions →
   Variables** as `MSIX_IDENTITY_NAME`, `MSIX_PUBLISHER` and `MSIX_PUBLISHER_NAME`. Until they are set CI uses
   stand-ins (`Monoform.Dev`, `CN=Monoform Dev`), which the Store rejects.
3. The Store listing: description, screenshots (`docs/screenshots/`), and a privacy policy URL — the README's
   *Privacy* section (`https://github.com/caffeine-runtime/monoform#privacy`) says what the app sends (nothing; the
   Store build doesn't even check for updates; optional models only when asked).

For each version: after the release run, open it (**Actions → Build → the run**), download the `store-msix` artifact,
unzip it and upload `monoform-store-x64.msix` in a new Partner Center submission (**Packages**). The package version
is the release's `x.y.z` plus `.0`, so each upload needs a new release version.

## Deleting releases

**Actions → Delete releases → Run workflow** with the tags to remove, separated by spaces (e.g.
`v1.1.0-beta.1 v1.1.0-beta.2`): each release is deleted together with its tag. Agents: `actions_run_trigger`,
`workflow_id: delete-releases.yml`, `inputs: {"tags": "…"}`. A deleted version can be published again.

Numbering started over at **1.0.0** on 2026-10-22: the earlier `2.0.0-beta.1`…`2.0.0-beta.9` pre-releases (there was
never a 1.x before them) were deleted, so the first published release is 1.0.0.

## Not done yet (by design or missing accounts)

- **Code signing.** Windows SmartScreen and macOS Gatekeeper warn about unsigned apps. Signing needs a Windows
  code-signing certificate and an Apple Developer account (for signing + notarization); both would be added as
  repository secrets and steps in the build job.
- **Linux distribution packages** (.deb, Flatpak, AppImage) — see `docs/DECISIONS.md` (Packaging) for why the
  tarball is used.
