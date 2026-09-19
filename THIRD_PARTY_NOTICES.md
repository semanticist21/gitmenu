# Third-party notices

gitmenu includes source copied from the projects below. The packages, crates and syntax
grammars it is built from are listed with their license texts in About gitmenu, which the
build collects into `licenses.json` (`scripts/licenses/licenses.ts`).

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

## Codicons

- Source: https://github.com/microsoft/vscode-codicons (npm `@vscode/codicons`), bundled into the app build
- Used in: every UI icon, through `src/components/Icon.tsx`
- License: the icon font and images are CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); the code is MIT. Copyright (c) Microsoft Corporation

## Visual Studio Code look

Colors (Light Modern and Dark Modern), metrics and component styles in `src/index.css`
and `src/components/ui/` follow Visual Studio Code (MIT, Copyright (c) Microsoft Corporation).

## Visual Studio Code shell integration

- Source: https://github.com/microsoft/vscode (`src/vs/workbench/contrib/terminal/common/scripts/shellIntegration-{env,profile,rc,login}.zsh`, `shellIntegration-bash.sh`)
- Adapted into: `src-tauri/src/terminal/` (how the startup files hand over to the user's own)
- License: MIT, Copyright (c) Microsoft Corporation

Visual Studio Code and GitLens are trademarks of their respective owners; gitmenu is not
affiliated with or endorsed by Microsoft or GitKraken.

## Oniguruma

- Source: https://github.com/kkos/oniguruma, compiled to WebAssembly by vscode-oniguruma
  (MIT, Copyright (c) Microsoft Corporation) and bundled through `@shikijs/engine-oniguruma`
- Used for: syntax highlighting
- License: BSD-2-Clause

```
Copyright (c) 2002-2021  K.Kosako  <kkosako0@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
SUCH DAMAGE.
```

## MIT License

The text of the MIT License, under the copyright lines given above for each MIT entry:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
