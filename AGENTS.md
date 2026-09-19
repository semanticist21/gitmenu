# gitmenu

macOS menu bar git panel (Tauri 2). `SPEC.md` owns every product and architecture decision; read the section you touch before changing it.

## Commands
- Frontend: `bun run typecheck`, `bun run lint`, `bun run build`
- Rust (in `src-tauri/`): `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo fmt`
- App: `bun run tauri dev`, `bun run tauri build`
- Menu bar icons: `bun scripts/tray/build.ts` (needs `rsvg-convert`) regenerates `src-tauri/icons/tray/`
- App icon: render `scripts/icon/app.svg` to 1024px with `rsvg-convert`, then `bunx tauri icon <png>`; keep only the macOS outputs listed in `tauri.conf.json`
- GitLens strings: `bun scripts/i18n/extract-gitlens.ts` checks `src/i18n/gitlens/*.json` against the source (`--list` prints them)
- Mocked UI preview: `bun run dev:mock`, then `?window=panel` or `#/detail/<tab>`

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
