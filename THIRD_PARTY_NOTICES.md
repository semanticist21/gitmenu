# Third-party notices

gitmenu includes source copied from the projects below. Dependencies installed
through Cargo or Bun keep their own license files and are not listed here.

## coss ui

- Source: https://github.com/cosscom/coss (`apps/ui`)
- Copied into: `src/components/ui/`, `src/hooks/`, `src/lib/segmented-control.ts`, `src/lib/utils.ts`
- License: MIT (the `apps/ui` directory is MIT; the rest of that repository is AGPL-3.0 and is not used)

## Visual Studio Code language packs

- Source: https://github.com/microsoft/vscode-loc
- Copied into: `src/i18n/` (menu and message strings that match VS Code's own)
- License: MIT, Copyright (c) Microsoft Corporation

## VS Code and GitLens menu structure

Menu placement, ordering, command titles, and default keybindings follow the
Visual Studio Code git extension (MIT, Copyright (c) Microsoft Corporation) and
GitLens (MIT, Copyright (c) 2021-2026 Axosoft, LLC dba GitKraken; Copyright (c) 2016-2021 Eric Amodio). No code from
GitLens' `plus` directory, which is under the GitLens Pro license, is used.
