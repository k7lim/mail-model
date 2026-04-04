# mail-model

A fork of [ankitvgupta/mail-app](https://github.com/ankitvgupta/mail-app) (exo) with configurable API host support and automated unsigned builds for friend distribution.

## What we changed

All customizations live on the `custom-api-host` branch:

- **Custom API host configuration** — allows pointing the app at a different API endpoint
- **Automated upstream sync** — weekly workflow keeps `main` in sync with upstream
- **Automated unsigned builds** — weekly workflow builds and publishes DMGs when upstream releases a new stable version
- **Update UX** — in-app update banner links to our releases page (since unsigned builds can't use electron-updater's auto-install)

## Branch strategy

| Branch | Purpose | Rules |
|--------|---------|-------|
| `main` | Clean mirror of upstream `ankitvgupta/mail-app` | Never commit directly. Auto-synced weekly. |
| `custom-api-host` | Default/working branch with all customizations | All workflow files and fork changes live here. |

## Workflows

### `ci.yml` (from upstream)

- **Triggers**: PRs to `main`
- **What it does**: Lint, typecheck, security audit, tests
- **Secrets**: None required

### `sync-upstream.yml`

- **Triggers**: Weekly (Monday 8:00am UTC), manual
- **What it does**: Fast-forwards `main` to match upstream, then merges `main` into `custom-api-host`. Opens an issue on merge conflict.
- **Secrets**: `GITHUB_TOKEN` (automatic)

### `build-on-upstream-release.yml`

- **Triggers**: Weekly (Monday 8:30am UTC, after sync), manual with optional `force_version` and `force_rebuild` inputs
- **What it does**: Checks upstream for new stable releases, builds an unsigned DMG from `custom-api-host`, creates a GitHub release with the DMG attached
- **Tag format**: `v0.6.0-mm.1` (upstream version + `-mm.1` suffix)
- **Secrets**: `GITHUB_TOKEN` (automatic), plus optional Google OAuth secrets (see table below)

## Installation

1. Download the latest `.dmg` from [Releases](https://github.com/k7lim/mail-model/releases)
2. Open the DMG and drag **exo** to Applications
3. On first launch, right-click the app and select **Open** (required for unsigned apps)
4. Alternatively: `xattr -cr /Applications/exo.app`

The app checks for new releases on startup and shows a banner when an update is available, linking to the releases page.

## Development setup

See `CLAUDE.md` for full instructions on environment files, tokens, and dev workflow. Key steps:

1. `npm install`
2. Copy `.env`, `.dev-data/tokens*.json`, `.dev-data/exo-config.json`, `.dev-data/exo-splits.json` from the main worktree
3. `npm run dev`

## Required secrets

| Secret | Used by | Required? | Notes |
|--------|---------|-----------|-------|
| `GITHUB_TOKEN` | All workflows | Auto-provided | GitHub Actions automatic token |
| `GOOGLE_CLIENT_ID` | `build-on-upstream-release` | Optional | Baked into build for Google OAuth. Without it, app builds but users can't authenticate with Google. |
| `GOOGLE_CLIENT_SECRET` | `build-on-upstream-release` | Optional | Same as above |
| `CSC_LINK` | `release` (upstream) | Not configured | Apple signing cert — only needed for signed builds |
| `CSC_KEY_PASSWORD` | `release` (upstream) | Not configured | Apple signing cert password |
| `APPLE_ID` | `release` (upstream) | Not configured | Notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | `release` (upstream) | Not configured | Notarization |
| `APPLE_TEAM_ID` | `release` (upstream) | Not configured | Notarization |
| `APPLE_API_KEY_ID` | `release` (upstream) | Not configured | Notarization polling |
| `APPLE_API_ISSUER_ID` | `release` (upstream) | Not configured | Notarization polling |
| `APPLE_API_KEY_P8` | `release` (upstream) | Not configured | Notarization polling |
