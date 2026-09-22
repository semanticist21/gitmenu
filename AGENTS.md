# gitmenu

macOS menu bar git panel (Tauri 2). `SPEC.md` owns every product and architecture decision; read the section you touch before changing it.

## Commands
- Frontend: `bun run typecheck`, `bun run lint`, `bun run build`
- Rust (in `src-tauri/`): `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo fmt`
- App: `bun run tauri dev`, `bun run tauri build`
- Menu bar icons: `bun scripts/tray/build.ts` (needs `rsvg-convert`) regenerates `src-tauri/icons/tray/`
- App icon: render `scripts/icon/app.svg` to 1024px with `rsvg-convert`, then `bunx tauri icon <png>`; keep only the macOS outputs listed in `tauri.conf.json`
- File icons: `bun scripts/icons/files.ts` regenerates `src/features/fileIcons/icons.gen.ts` from the pinned Catppuccin Icons release
- GitLens strings: `bun scripts/i18n/extract-gitlens.ts` checks `src/i18n/gitlens/*.json` against the source (`--list` prints them)
- Mocked UI preview: `bun run dev:mock`, then `?window=panel` or `#/detail/<tab>`

## Release

`.github/workflows/release.yml` builds, signs and notarizes on a `v*` tag; everything below is
what the workflow does not do for you.

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
   (then `cargo update -p gitmenu --offline`) and `packaging/homebrew/gitmenu.rb`.
2. Commit, push, then push the `vX.Y.Z` tag. The workflow runs only when `APPLE_CERTIFICATE`
   is set; without it, it does nothing.
3. It leaves a **draft** release. Before publishing, mount the DMG and check the app:
   `spctl -a -t exec -vv` must say `source=Notarized Developer ID`, and
   `xcrun stapler validate` must pass. Then `gh release edit vX.Y.Z --draft=false --latest`.
4. Copy `packaging/homebrew/gitmenu.rb` into `kobbokkom/homebrew-tap`'s `Casks/`, with the
   published DMG's `shasum -a 256`. Until that lands, `brew` still installs the old version.

Notes that cost time when forgotten:

- Releases are Apple silicon only, and the DMG is named `gitmenu_<version>_aarch64.dmg`.
- The signing identity, notarization password and updater key live in the private archive
  collection `projects/gitmenu`; restore them with `$environment-sync`, never from Downloads.
- **Never rotate the updater key.** A shipped app verifies updates against the public key built
  into it, so a new key ends automatic updates for every version already installed.
- The updater feed is `releases/latest/download/latest.json`. It only appears when the
  `TAURI_UPDATER_PUBKEY` repository variable is set; without it the release ships without
  updates, matching `src-tauri/src/update.rs`.

## Rules
- Follow VS Code Source Control and GitLens behavior and defaults; decide separately only where they are silent, disagree, or cannot apply to a menu bar app.
- Never read VS Code or GitLens installs at build or run time.
- Reads go through `gix` (except `log -L` and `log -G`, which gix lacks); writes and network go through the system `git` CLI. No libgit2, no bundled git.
- Repository state lives in Rust. Windows request data and subscribe to change events; they never pass state to each other.
- Writes run one at a time per worktree. After a write finishes, re-read immediately; no optimistic UI.
- Stream results, virtualize long lists, page commits, send diffs one file at a time.
- `src/components/ui/`, `src/hooks/`, `src/lib/segmented-control.ts` come from the coss ui registry. Change them only on purpose and keep lint exemptions scoped to them.
- The shadcn `@coss/style` preset imports Inter/Geist; this app uses system fonts only.
- Commits, public repositories, pushes, releases and deploys need the user's confirmation.
