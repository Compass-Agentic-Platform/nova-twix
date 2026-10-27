# Nova Twix — Release & Distribution

> **This repository contains no application source code.** It is the release and
> distribution scaffolding for **Nova Twix**, a local-first meeting recorder,
> transcriber and diarisation app built with **Tauri 2 (Rust)** and a
> **Python processor sidecar**.

The actual source lives in a private Azure DevOps repository and is fetched at
build time by the CI workflows. This mirrors the `compass-desktop`
release-repository pattern, but the pipeline is adapted for Tauri/Rust rather
than Electron.

---

## What's here

| Path | Purpose |
| --- | --- |
| `.github/workflows/publish-mac.yml` | Build, sign, notarise and upload the macOS release |
| `.github/workflows/update-release-hashes.yml` | Recompute SHA-256/size metadata on every release |
| `scripts/sha256.js` | Streams a file and prints its SHA-256 hash |
| `scripts/update-hashes.js` | Merges asset metadata into `latest.json` (local + CI modes) |
| `scripts/prepare-mac-icon.js` | Produces an `.icns` icon from the source repo's assets |
| `assets/macos-entitlements.plist` | Hardened-runtime entitlements used for macOS signing |
| `latest.json` | Update manifest consumed by the desktop auto-updater |
| `.github/ISSUE_TEMPLATE/` | Bug and feature templates |
| `assets/nova-twix-banner.svg` | Repo branding banner |

---

## Repositories

- **Distribution (this repo):** `https://github.com/Compass-Agentic-Platform/nova-twix`
- **Source (private):** `https://dev.azure.com/oakpeak-devops/Kore/_git/nova-twix`

The source is never committed here. During CI it is cloned from the secret
`NOVA_TWIX_REPO` (see below).

---

## macOS release pipeline

`publish-mac.yml` is triggered manually (`workflow_dispatch`) and runs on macOS.
It builds in a matrix for **Apple Silicon (`arm64`)** and, when requested,
**Intel (`x64`)** (an `architectures` input defaults to `both`) and:

1. Validates all required signing/notarisation secrets.
2. Clones the source from `NOVA_TWIX_REPO` into `source-app/`.
3. Installs Rust (with both Darwin targets), Node.js, and Python 3.12 + `uv`.
4. Builds the Python processor sidecar with **PyInstaller** and places the
   Mach-O binary as `src-tauri/binaries/nova-twix-processor-<target-triple>`.
5. Generates a macOS `.icns` icon if the source only ships a Windows `.ico`.
6. Imports the Developer ID Application certificate into a temporary keychain.
7. Patches `tauri.conf.json` (targets `app` + `dmg`, `.icns` icon) and applies
   `assets/macos-entitlements.plist`, which adds the microphone entitlement the
   recorder needs and the native-library allowances the Python sidecar needs.
8. Runs `tauri build` (signing the `.app` and producing a `.dmg`), then
   notarises and staples both the `.app` and the `.dmg` with `xcrun notarytool`.
9. Uploads the `.dmg` (and a zipped `.app`) to the latest GitHub Release.

The notarisation flow deliberately mirrors `compass-desktop`: Tauri's own
built-in notarisation is bypassed and `xcrun notarytool` is run explicitly for
both the `.app` and the DMG.

> **Intel (`x64`) builds need an Intel runner.** The Python sidecar is built
> with PyInstaller, which cannot cross-compile, so `x64` requires an Intel
> macOS machine. GitHub is sunsetting the `macos-13` (Intel) runner — if it is
> retired, point that matrix entry at a self-hosted Intel runner, or run with
> `architectures: arm64` only.

---

## Required secrets

Create these as **environment secrets** on the `nova-twix-build` environment (or
remove the `environment:` line from `publish-mac.yml` to use repository
secrets).

| Secret | Description |
| --- | --- |
| `NOVA_TWIX_REPO` | Full Azure DevOps clone URL including an embedded PAT, e.g. `https://<token>@dev.azure.com/oakpeak-devops/Kore/_git/nova-twix` |
| `MAC_CSC_LINK` | Base64-encoded `.p12` Developer ID Application certificate (`base64 -i cert.p12 \| tr -d '\n'`) |
| `MAC_CSC_KEY_PASSWORD` | Password for the `.p12` file |
| `APPLE_ID` | Apple ID used for notarisation |
| `APPLE_ID_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID (required for signing/notarisation) |
| `RELEASE_PAT` | *Optional.* Used by `update-release-hashes.yml` when branch protection blocks the default `GITHUB_TOKEN` |

---

## Source-side prerequisites

The pipeline is self-contained, but the source repository must satisfy a few
requirements for the macOS build to succeed:

- **Rust sidecar resolution:** `src-tauri/src/sidecar/mod.rs` resolves the
  sidecar as `nova-twix-processor` + the platform suffix. On macOS the pipeline
  must produce `binaries/nova-twix-processor-aarch64-apple-darwin` and
  `binaries/nova-twix-processor-x86_64-apple-darwin`. This is handled by the
  workflow.
- **Python sidecar:** the source declares the package `nova-twix-processor`
  (Hatchling) with a `pyproject.toml`. The workflow builds it with PyInstaller.
  If the source's ML dependencies (e.g. `torch`, `whisperx`, `pyannote.audio`)
  change, update the PyInstaller command in `publish-mac.yml`.
- **App icon:** for best results the source should ship a 1024×1024
  `src-tauri/icons/icon.png` or `icon.icns`. If only `icon.ico` is present, the
  workflow generates an `.icns` on a best-effort basis (`prepare-mac-icon.js`).
- **Bundle config:** the workflow patches `tauri.conf.json` at build time to
  target `app` + `dmg` and reference the generated icon. No source edit is
  required.

---

## `latest.json` and the hash update flow

`latest.json` is the manifest the desktop app's auto-updater reads. It is kept
in sync by `update-release-hashes.yml`, which fires on every release
create/edit:

1. Downloads each non-source binary asset attached to the release.
2. Computes its SHA-256 and byte size.
3. Writes the results into `latest.json` and pushes the change with `[skip ci]`.

Draft releases are skipped. Asset downloads retry up to three times with
exponential backoff. The workflow maps filenames to platform keys
(`darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64`).

---

## Triggering a release

1. Go to **Actions → "Publish macOS (Signed)" → Run workflow**.
2. Optionally set the source branch/tag (default `master`).
3. Confirm a GitHub Release already exists — the upload step targets the latest
   existing release and fails if none is found.
4. After upload, `update-release-hashes.yml` runs automatically and refreshes
   `latest.json`.

---

## License

[MIT](./LICENSE) © 2026 Brighten SA.
