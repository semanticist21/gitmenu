# gitmenu 명세

## 목표
VS Code Source Control과 GitLens의 기능을 가벼운 macOS 메뉴 막대 앱(Tauri)으로 만든다. 코드 편집은 사용자의 에디터에서 하고, 이 앱은 git 패널, diff, 그래프를 맡는다. 기능·메뉴 위치·순서를 VS Code/GitLens와 동급으로 맞추는 것이 제품 목표이며, 속도와 가벼움이 최우선이다. 구현은 마일스톤 순서대로 한다.

VS Code와 GitLens가 이미 정해 둔 동작과 기본값은 그대로 따른다. 따로 정하는 것은 둘이 다루지 않거나 서로 다를 때, 또는 메뉴 막대 앱 구조상 그대로 옮길 수 없을 때뿐이다. 다만 앱의 실행과 빌드는 VS Code·GitLens 설치본에 의존하지 않는다.

**용어**: "메뉴 막대 아이콘"은 화면 위 막대에 있는 아이콘, "패널"은 그 아이콘을 눌러 열리는 창이다.

## 작업 방식 (필수)
- 요청받은 범위만 한다. 골격(scaffold)을 요청받으면 기능 코드를 쓰지 않는다.
- 구조적 결정이나 명세에 없는 선택은 코드 작성 전에 한 번 묻는다.
- 실행해서 보여주는 화면은 항상 실제 스택(React + coss ui)으로 만든다. 스택이 다른 테스트용 앱을 띄울 때는 미리 말한다.
- 생성 도구가 추가한 파일과 의존성은 확인한다(예: `init @coss/style`은 Next.js 전용 `geist` 폰트 import를 넣어 Vite 빌드를 깬다).
- 커밋, 공개 저장소 생성, 외부 게시는 사용자 확인 후에 한다.
- 사용자가 직접 띄운 개발 서버는 건드리지 않는다. 직접 띄운 프로세스는 작업 후 확실히 종료한다.

## 플랫폼
- **최소 macOS**: 13 Ventura.
- **git**: 기능은 사용자 저장소를 대상으로 직접 구현한다.
  - 읽기(status, log, 커밋 파일, diff, blame, ahead/behind, 그래프)는 `gix`.
  - 쓰기와 네트워크(stage, commit, reset, stash, fetch/pull/push, switch, `git apply`)는 사용자 Mac의 시스템 git CLI.
  - git을 번들하지 않고 `git2`(libgit2)도 쓰지 않는다. git이 없으면 설치 안내를 띄운다.
- **셸 환경**: GUI 앱에는 셸 PATH가 없다. 시작 시 `$SHELL -ilc env`를 백그라운드로 한 번 실행(타임아웃)해 받은 환경으로 git CLI를 실행한다. 준비 전 쓰기 작업은 대기(gix 읽기는 대기 안 함). git 경로는 설정에서 지정 가능. 실패 시 알림.
- **git 입력 요청**: VS Code 방식. GIT_ASKPASS, SSH_ASKPASS(+`SSH_ASKPASS_REQUIRE=force`), GIT_EDITOR를 앱 헬퍼로 지정 → 로컬 소켓으로 앱에 요청 → 패널 입력창(자격 증명, passphrase, fingerprint 확인, 메시지 편집). credential helper가 있으면 그것이 먼저.
  - 헬퍼는 별도 실행 파일이나 셸 스크립트를 두지 않고 **앱 실행 파일 자신**이다. `--askpass`, `--ssh-askpass`, `--editor` 같은 인자로 실행되면 창을 띄우지 않고 소켓으로 물어본 뒤 답을 표준 출력(편집기는 파일)에 쓰고 끝낸다. 소켓 경로는 환경 변수로 넘긴다. 서명·notarize 대상이 하나로 유지된다.
  - VS Code는 Electron 특성 때문에 `askpass.sh`가 본체를 Node 모드로 재실행하는 2단 구조를 쓰지만, 우리는 그 단계가 필요 없다.
- **상태 소유**: 저장소 상태의 원본은 Rust가 들고, 패널과 상세 창은 각자 필요한 것만 요청하고 변경 이벤트를 구독한다. 창끼리 상태를 넘기지 않는다. 그래서 상세 창 WebView를 파기해도 상태가 남고, 같은 읽기를 두 번 하지 않는다.
- **동시성**: 쓰기는 worktree별 큐에서 하나씩 한다(index와 HEAD가 따로 노는 단위이자 `index.lock`이 걸리는 단위). 서브모듈과 각 worktree는 각자 큐를 가져 동시에 작업할 수 있다. 네트워크 작업은 별도로 돌리되 같은 종류 중복 실행 금지. `index.lock` 충돌은 짧게 재시도하고, 계속되면 lock을 잡은 프로세스를 알린다(lock 파일 자동 삭제 금지). 쓰기 중 감시 이벤트는 모았다가 끝난 뒤 한 번 갱신. 작업 취소 가능.
- **쓰기 직후 갱신**: VS Code git 확장과 같이, 쓰기 명령이 끝나면 감시 이벤트를 기다리지 않고 곧바로 다시 읽어 화면에 반영한다. 미리 바꿔 두는 낙관적 갱신은 하지 않는다.
- **프론트**: Vite + React + TypeScript, TanStack Query/Router/Hotkeys(`@tanstack/react-hotkeys`), `@tanstack/react-virtual`, Tailwind v4, shadcn CLI + coss ui(`@coss` 레지스트리), Bun. Next.js 쓰지 않음.
- **폰트**: 시스템 폰트(`-apple-system`, `ui-monospace`).
- **테마**: VS Code Light Modern / Dark Modern 색과 크기(13px, 22px 행, codicon)를 그대로 쓴다. 라이트/다크/시스템. 코드 하이라이트는 VS Code 기본인 Light+/Dark+. 색 preset과 VS Code 테마 JSON은 지원하지 않는다.
- **UI 언어**: 10개(English, 한국어, 日本語, 简体中文, 繁體中文, Deutsch, Français, Español, Português (Brasil), Русский). 기본은 시스템 언어, 설정에서 변경. VS Code 언어팩(`microsoft/vscode-loc`, MIT)에 같은 항목이 있으면 그 번역을 복사해 저장소에 커밋하고 THIRD_PARTY_NOTICES에 고지한다. 언어팩에 없는 문구(GitLens 뷰 등)는 직접 번역한다.
- **크래시 리포트**: 옵트인 Sentry(Rust panic + 프론트 에러). 저장소 경로·파일명·커밋 내용은 전송 전 제거.
- **접근성**: 키보드 완전 조작(화살표, Enter/Space, ⇧F10 컨텍스트 메뉴), tree/treeitem 역할과 aria-label로 VoiceOver 기본 지원.
- **라이선스**: MIT. 복사한 VS Code 언어팩 번역은 THIRD_PARTY_NOTICES에 고지한다. GitLens 소스의 `plus` 디렉터리(GitLens Pro 라이선스) 코드와 구현은 가져오지 않는다.
- **배포**: 직접 배포(Developer ID 서명 + notarize), 샌드박스 없음. Mac App Store는 보류(샌드박스가 git CLI 실행, ~/.gitconfig·~/.ssh·ssh-agent, hook, 서명을 막음).
  - 소스와 릴리스 모두 Kobbokkom 조직의 공개 GitHub 저장소 하나(MIT). 태그 푸시 → CI 빌드·서명·notarize → GitHub Releases.
  - 업데이트: Tauri updater(서명 검증). 업데이트를 찾으면 모달로 확인을 받고 "재시작해서 업데이트"를 누를 때만 설치한다. 토스트는 패널이 닫히면 놓치므로 쓰지 않는다. 자동 재시작 없음.
  - 설치 경로: DMG 다운로드 + 자체 brew tap(`kobbokkom/tap`). 공식 homebrew/cask는 나중에.
  - 소개/다운로드 페이지: `~/code/kobbokkom-forum`(kkom.net, Cloudflare Pages)에 단일 페이지. 스크린샷, 기능 요약, DMG 버튼, brew 명령, 릴리스 노트 링크를 넣고 사이트의 inlang 10개 언어 구조를 따른다.
  - `tauri-nspanel`은 crates.io에 없으므로 git 태그가 아니라 커밋 해시로 고정한다. M1에서 실제 사용 범위를 보고 저장소에 복사(vendoring)하거나 `objc2`로 직접 구현할지 정한다.
  - 비밀(서명 인증서, notarize, Sentry DSN, OpenAI API 키)은 저장소에 넣지 않고 `$environment-sync`와 CI secret으로 관리.

## 창과 프로젝트
- **메뉴 막대 앱**: 아이콘을 누르면 패널이 열린다. Dock 아이콘 항상 숨김.
  - 다른 앱을 클릭하면 패널이 닫히고, 우리 상세 창이나 입력창으로 포커스가 가면 열린 채 유지한다.
  - 핀을 누르면 고정 + 항상 위.
  - 패널 기본 360×640, 드래그로 크기를 바꾸면 기억한다(높이는 화면 높이 이내).
  - 전역 단축키 1개: 패널 열기/닫기(기본 미할당).
  - 로그인 시 자동 실행: 첫 실행 때 묻고(SMAppService) 설정에서 변경.
- **패널 뷰 배치**: VS Code 사이드바처럼 접이식 세로 섹션. 기본 표시는 Source Control과 Commits, 나머지는 뷰 제목 메뉴의 체크로 켠다. 섹션 높이는 드래그로 조절하고 기억한다.
- **메뉴 막대 아이콘**: 아이콘만 쓰고 옆 텍스트는 없다(숫자·브랜치·ahead/behind 표시 안 함, 관련 설정도 없음).
  - 본체는 커밋 그래프 마크(세로선 위 커밋 점 셋 중 하나가 옆으로 갈라지는 모양) 한 장으로 고정이고, 본체 자체는 움직이지 않는다. branch·merge 같은 동작 기호는 뜻이 좁아 쓰지 않는다.
  - 상태는 오른쪽 아래 작은 배지(약 11px)로만 나타낸다. 평소에는 배지가 없다. git 작업 중에는 작업별 배지가 깜빡인다(push 위 화살표, pull 아래 화살표, fetch 도는 화살표, 커밋 점). merge 충돌은 빨간 느낌표, 작업 실패는 빨간 ×이고 둘 다 깜빡이지 않는다.
  - 본체와 작업 배지는 흑백 템플릿 이미지라 메뉴 막대 색을 따라간다. 빨간 배지가 붙는 상태에서만 색이 있는 합성 이미지를 쓴다.
  - 프레임은 OpenAI 이미지 API로 만들어 템플릿 PNG(@1x/@2x)로 후처리한다.
- **상세 창**: 하나만 두고 탭으로 diff, Graph, Settings, Keyboard Shortcuts, 터미널을 연다(이미 열린 파일이면 그 탭으로 이동). WebView는 패널 + 상세 창 최대 2개. 닫으면 WebView를 파기하고, 다시 열 때 탭 상태를 복원한다. 다른 창 뒤로 가면 패널 버튼과 단축키로 불러오고, 상세 창에도 항상 위 토글이 있다.
- **에디터 연동 없음**: 파일 열기는 macOS 기본 앱. CLI 진입점 없음.
- **프로젝트**: Open Project와 최근 프로젝트 목록, 패널 안 프로젝트 탭. 탭 하나에 저장소 여러 개(서브모듈, 중첩 저장소)를 담고 Repositories 목록으로 선택한다. 감지 기본값은 VS Code와 같다(detectSubmodules 10개, autoRepositoryDetection 깊이 1, 상위 폴더 저장소는 물어보기, untracked는 mixed). 폴더를 열면 탭이 먼저 생기고 저장소는 백그라운드 스캔이 찾는 대로 흘려보낸다. 저장소 개수는 제한하지 않되, 깊이를 무제한(-1)으로 두면 디렉터리 5만 개 또는 10초에서 멈추고 잘렸다고 알린다.
- **프로젝트 경로가 없을 때**
  - 첫 실행에는 패널을 자동으로 열고, 빈 화면에 "프로젝트 열기" 버튼과 폴더 끌어다 놓기 안내를 보여준다. 폴더를 고르면 프로젝트 탭을 만들고 저장소를 감지한다. Dock 아이콘이 없는 보조 앱이라 폴더 선택 창을 앞으로 내보내려면 잠깐 활성화가 필요하므로 M1에서 확인한다. 두 번째 실행부터는 탭을 복원하고 패널을 자동으로 열지 않는다.
  - 저장된 경로가 사라지면 탭을 지우지 않고 "찾을 수 없음"으로 흐리게 둔다. 누르면 다시 찾기와 제거 버튼을 준다. 그 탭은 git 작업도 감시도 하지 않고, 경로가 돌아오면 저절로 복구된다.
  - 폴더가 git 저장소가 아니면 "저장소 초기화"(`git init`) 버튼을 보여준다. 상위 폴더가 저장소인 경우는 감지 기본값대로 물어본다.
- **감시**: 모든 탭을 FSEvents(`notify` + debouncer)로 감시한다. 워처는 탭마다 한 번 등록하고 다시 만들지 않으며 디바운서의 file-id 캐시는 쓰지 않는다(등록만으로 폴더 전체를 stat 한다). 이벤트 분류와 gitignore 판정은 전용 워커 스레드에서 하고, 새 `.git`은 프로젝트를 다시 감지하지 않고 그 폴더만 연다. gitignore 경로는 버리고 Rust에서 debounce하며, 저장소 하나당 다시 읽기는 초당 한 번까지. `git.statusLimit`을 넘긴 저장소는 VS Code처럼 갱신을 멈추고 한 번 경고한다. 비활성 탭은 "변경 있음" 점만 표시하고 git 작업은 하지 않으며, 탭을 열 때 다시 읽는다. 프론트에는 debounce가 없다.
- **상태 저장**: 프로젝트 탭, 활성 탭, 뷰 표시·접힘·높이, 창 위치·크기, 상세 창 탭을 모두 복원한다. 설정은 `settings.json`, 단축키는 `keybindings.json`이 원본이고 화면·파일 어느 쪽에서 바꿔도 즉시 반영한다. 두 파일은 VS Code와 같은 자리인 `~/Library/Application Support/gitmenu/`에 둔다. 우리가 모르는 키는 지우지 않고 그대로 보존한다.
- **macOS 폴더 권한**: Desktop/Documents/Downloads/iCloud Drive 아래 저장소는 첫 접근 때 시스템 권한 창이 뜬다. 거부 시 안내.

## 기능 동등성
- **기준**: VS Code Source Control과 GitLens의 메뉴 위치·순서·표시 조건, 단축키, 설정을 동급으로 구현한다. 명령·메뉴·단축키·명령 팔레트는 **명령 레지스트리 한 곳**에서 정의한다. 적는 형태는 VS Code의 `contributes`를 따른다: 명령(id, 제목, 카테고리, 아이콘), 메뉴(어느 메뉴에 붙는지와 group, order, when), 단축키(key, mac, when), 설정(키와 기본값).
- **뷰**: Source Control, GitLens Commits, File History, Line History, Search & Compare, Stashes, Branches, Remotes, Tags, Worktrees, Contributors.
- **대체와 제외**
  - Open File → 기본 앱 / Reveal in Explorer View → Reveal in Finder / Open Changes with → 상세 창
  - Open on Remote, Share 링크 → remote URL로 구현
  - blame/annotation → 상세 창(diff, 특정 리비전 파일 보기)에서 토글
  - 터미널에서 열기: 저장소 폴더를 터미널 앱으로 연다(`open -a <터미널 앱> <경로>`). 패널 머리말 버튼과 저장소·worktree 컨텍스트 메뉴("Finder에서 보기" 옆)에 둔다. 기본값은 macOS 기본 Terminal이고, 설정에서 다른 터미널 앱을 고를 수 있다(설치된 앱 목록에서 고르거나 직접 지정).
  - 통합 터미널: VS Code 편집 영역의 터미널처럼 상세 창 탭에서 사용자 로그인 셸을 PTY로 실행한다. New Terminal(`workbench.action.terminal.new`, `` ⌃⇧` ``)은 탭 줄 오른쪽 + 버튼과 패널에서도 쓰고, 활성 탭의 저장소 → 활성 프로젝트 → 홈 순서로 시작 폴더를 정한다. 탭을 닫으면 셸을 끝내고, 셸이 끝나면 탭을 닫는다. 셸은 상세 창을 닫거나 앱을 끝내면 모두 끝나고, 복원된 터미널 탭은 새 셸로 시작한다.
  - 제외: vscode.dev, Launchpad, Drafts/Cloud Patches, Workspaces, Pull Request 뷰, Home/Welcome/Timeline
- **staging**: VS Code와 동일. Staged/Changes 그룹, stage한 파일이 없으면 커밋 시 전체 stage 확인("항상" 옵션). 상세 창에서 변경 블록 단위 Stage/Revert 버튼과 선택 영역 Stage/Revert(명령·단축키). patch를 만들어 `git apply --cached`로 적용한다(Revert는 `-R`).
- **커밋**: 입력창 ⌘Enter, Commit 드롭다운(Commit, Amend, Commit & Push).
- **pull과 충돌**: 사용자 git 설정을 따르고 Sync(pull 후 push)를 제공한다. 충돌 파일은 Merge Changes 그룹, merge/rebase 진행 배너에 Continue/Abort. 파일별 Accept Current/Incoming, 직접 해결은 기본 앱, stage하면 해결 완료. 3-way merge 창은 만들지 않는다.
- **안전장치**: 기본값은 VS Code와 동일(discard, Sync, force push, 커밋된 파일 삭제, no-verify 커밋, 빈 커밋 전 확인창, untracked discard는 휴지통). 확인창마다 설정 토글과 "다시 묻지 않기". reset --hard와 discard 전에는 `git stash create`로 복구 지점을 만들고 토스트에 되돌리기를 둔다.
- **diff**: 상세 창 탭, side-by-side 기본 + inline 토글.
  - Shiki(`shiki/core` + Oniguruma WASM 엔진)를 Web Worker에서 실행하고, 문법은 필요할 때 로드한다. 하이라이트는 현재 테마 하나만 만들고 테마가 바뀌면 다시 만든다. 큰 파일은 색 없이 먼저 보여주고 끝나면 색을 입힌다.
  - 표시 한도는 VS Code 기본값을 따른다. 50MB가 넘는 파일은 비교하지 않고 안내만 보여준다(`diffEditor.maxFileSize`). diff 계산이 5초를 넘으면 중단한다(`diffEditor.maxComputationTime`). 줄 끝 공백만 바뀐 것은 변경으로 세지 않는다(`diffEditor.ignoreTrimWhitespace` 켜짐). 20,000자가 넘는 줄은 색칠하지 않고, 10,000자 뒤는 그리지 않는다(`editor.maxTokenizationLineLength`, `editor.stopRenderingLineAfter`).
  - 인코딩은 UTF-8 고정이고 추측하지 않는다(`files.encoding` utf8, `files.autoGuessEncoding` 꺼짐). 줄바꿈(CRLF/LF) 변경은 git이 알려주는 대로 표시한다.
  - 이미지(jpg, jpeg, png, gif, bmp, ico, webp, avif, svg)는 이전·이후를 나란히 놓고 크기와 용량을 표시한다. 그 밖의 바이너리는 "바이너리 파일 변경됨"과 용량 변화, 기본 앱으로 열기 버튼만 보여준다.
- **Line History**: 상세 창 diff 탭이나 파일 보기(blame) 탭에서 줄을 선택하면 패널의 Line History가 그 범위를 따라간다(`git log -L`). 파일 보기 탭은 "Open File at Revision"으로 연다.
- **Graph**: 상세 창 Graph 탭. 전체 브랜치 기본, 브랜치/remote/stash 필터와 검색. lane은 Rust에서 계산하고 행을 가상화한다.
- **Worktree**: 새 프로젝트 탭으로 열기. Open in Finder, 기본 에디터로 폴더 열기.
- **Remote 호스팅**: GitHub(Enterprise 포함), GitLab, Forgejo/Gitea, Bitbucket, Azure DevOps. 잘 알려진 호스트는 URL로 자동 인식한다. 자체 호스팅 도메인은 GitLens처럼 `remotes` 설정으로 지정한다(domain, type: GitHub/GitLab/Gitea/Bitbucket/BitbucketServer/AzureDevOps/Custom). API 조회로 자동 판별하지 않는다.
- **아바타**: GitHub noreply 이메일은 바로 변환 → GitHub remote이고 `gh auth token`이 있으면 GraphQL로 묶어 조회 → Gravatar → 이니셜. 이메일 기준 디스크 캐시, 보이는 행만 요청, 설정에서 끄기(GitLens와 같이 기본 켜짐).
- **AI 커밋 메시지**: Apple Foundation Models만 사용(Swift 브리지). 버튼은 커밋 입력창의 ✨ 위치.
  - 최소 macOS 버전은 올리지 않고 실행 시점에 확인한다. 사용할 수 없으면 버튼을 비활성화하고 이유(기기 미지원, Apple Intelligence 꺼짐, 모델 준비 중)를 툴팁으로 보여준다. 컨텍스트 초과는 실행 후 에러로 알린다.
  - 큰 diff는 파일별로 요약한 뒤 합친다.
  - 설정: 커밋 메시지 언어(기본 English, 전역), GitLens와 같은 custom instructions, 제외 glob(기본: lock 파일, 빌드 결과물).
- **파일 아이콘**: 경로 옆 아이콘은 Catppuccin Icons(MIT)를 벤더링해서 쓴다. 색은 `--ctp-*` 변수로 빠져 있어 라이트는 Latte, 다크는 Mocha를 쓰고, 매칭되는 아이콘이 없으면 기존 코디콘 `file`로 떨어진다.
- **단축키**: VS Code/GitLens 기본 단축키와 when 조건(포커스 위치)을 따르고 `keybindings.json`으로 재지정. 명령 팔레트(⌘⇧P). ⌘P는 VS Code의 Quick Open 자리이며, 파일 대신 열린 프로젝트와 최근 항목을 같은 quick input 위젯으로 고른다.

## 성능 규칙
합격선 수치는 두지 않는다. 아래 규칙을 지키고, 느리거나 무겁다고 느껴질 때 원인을 찾아 고친다.
- 결과가 나오는 대로 화면에 흘려보낸다. 다 모은 뒤 한 번에 그리지 않는다.
- 긴 목록(커밋, 변경 파일, 그래프, diff 줄)은 가상화한다.
- 커밋은 Rust에서 페이지 단위(cursor + limit)로 준다. diff는 파일 하나씩 보낸다.
- 하이라이트 결과와 diff 토큰은 화면에서 벗어나면 버린다.
- 저장소별 gix 객체 캐시 크기는 메모리를 보며 정한다.
- 유휴 상태에서는 타이머나 폴링을 두지 않는다.
- IPC 필드는 camelCase.

## 검증된 스파이크 결과 (코드는 남아 있지 않음, 수치만 참고)

### gix 0.87.1
`default-features = false`, features `status, blame, revision, parallel, max-performance-safe, sha1`
- **status**: `repo.status(Discard)?.untracked_files(UntrackedFiles::Files).into_iter(None)`. `Outcome::write_changes()`를 부르지 않으면 index를 쓰지 않는다. git CLI와 일치(수정, stage, rename, typechange, 충돌, 서브모듈 등). 예외: `git add -N` 파일의 rename은 삭제+추가로 나온다. 결과 순서가 고정이 아니라 정렬이 필요하고, git status 문자·서브모듈 표시 매핑(~100줄)은 직접 구현한다.
- **log**: `rev_walk([head]).sorting(ByCommitTime(NewestFirst))`. 16,627개까지 일치. subject 앞 공백은 `summary()`가 잘라내므로 메시지 첫 줄을 직접 읽는다.
- **blame**: `repo.blame_file(path, head, Options { rewrites: Some(Default), .. })`, myers diff가 git과 가장 가깝다. 줄 수는 같지만 애매한 줄 소수가 다른 커밋으로 귀속된다(1887줄 중 최대 14줄). ignore-revs, -M/-C, mailmap, 커밋 안 된 변경의 blame은 CLI 대체가 필요하다.
- **속도**(M2 Pro, warm): Hannote status 21ms(git 36ms), log 1.4ms(git 12.6ms), blame 5~7ms(git 15~119ms). commit-graph가 없으면 1.5~2배 느리다(gix는 쓰지 못하므로 `git commit-graph write`). 저장소 핸들을 열어두고 객체 캐시를 주면 반복 요청이 크게 빨라진다.

### 코드 하이라이트 (shiki 4.4.3, giallo 0.5.2, M2 Pro)
- 반복 실행 중앙값(테마 하나), Safari 26.5.2: Oniguruma 엔진은 TS 323줄 9ms, TSX 1,165줄 51ms, Rust 5,000줄 137ms, CSS 1,086줄 20ms. JS 정규식 엔진은 같은 파일에서 3~12배 느리다(TSX 634ms). 사전 컴파일 문법을 써도 같다.
- Node 기준 Oniguruma: JS 2만 줄 2.1초, 압축 JS(한 줄 4천 자) 1.06초.
- 색 결과: JS 정규식 엔진은 2만 줄 JS에서 55줄이 Oniguruma와 달랐다. giallo는 모든 파일에서 Oniguruma와 100% 같았다.
- 두 테마를 함께 만들면 Shiki는 시간이 2배가 된다(테마마다 다시 분석).
- giallo를 쓰지 않는 이유: 라이선스가 EUPL-1.2이고, 문법 220개를 모두 올려 메모리가 약 75MB이며, 테마 하나 기준으로 대부분 파일에서 느렸다(CSS 4.5배, JS 2만 줄 3배).

### Apple Foundation Models (Xcode 26.6, Swift 6.3.3, macOS 26.5.2 arm64)
- **빌드**: `build.rs`에서 `xcrun swiftc -emit-library -static -target arm64-apple-macosx13.0`로 Swift 파일을 정적 라이브러리로 빌드하고, `@_cdecl` 함수(availability, context_size, token_count, generate, free)를 `extern "C"`로 호출한다. 링크 플래그: Swift 라이브러리 검색 경로(SDK `usr/lib/swift`, 툴체인 `usr/lib/swift/macosx`), `-Wl,-weak_framework,FoundationModels`, `-Wl,-rpath,/usr/lib/swift`. 호출은 블로킹이라 메인 스레드 밖(`spawn_blocking`)에서.
- 최소 macOS 13 빌드에서 FoundationModels가 `LC_LOAD_WEAK_DYLIB`로 확인됨(구형 macOS 실제 실행은 미검증).
- 컨텍스트 4096 토큰. 약 2만 토큰 입력은 4.3초 후 `exceededContextWindowSize`. `tokenCount(for:)`는 macOS 26.4+.
- 속도 0.5~1초(짧은 diff). 품질이 약해 엄격한 프롬프트, 크기 확인·분할, 출력 형식 검증이 필요하다.

### 메뉴 막대 패널 동작 (tauri 2.11.5 `tray-icon`, tauri-plugin-positioner 2.3.4, global-shortcut 2.3.2, window-state 2.4.1, tauri-nspanel git `v2.1`, objc2 0.6)
- Tauri API로 되는 것: `set_activation_policy(Accessory)`, `.icon_as_template(true)` + `set_title`, 애니메이션은 `set_icon_with_as_template(img, true)`(그냥 `set_icon`은 템플릿 플래그가 빠짐), 유휴 시 스레드 park로 CPU 0%. 아이콘 위치는 앱 시작 직후 `tray.rect()`가 틀리므로 클릭 시점에 읽는다. 핀은 `set_always_on_top`, 크기 기억은 window-state 플러그인.
- 바깥 클릭 닫기: blur 후 80ms 뒤 우리 창 중 `is_focused()`가 없으면 숨긴다. 닫힌 직후 300ms 안의 아이콘 클릭은 무시한다.
- 전체화면 앱 위 표시와 포커스를 뺏지 않는 열기는 `tauri-nspanel`이 필요하다(NSPanel, non-activating, collectionBehavior CanJoinAllSpaces|FullScreenAuxiliary). 패널 호출은 반드시 `run_on_main_thread`에서 한다(아니면 데드락). 적용 후 Tauri 포커스 이벤트가 끊기므로 닫기 감지는 `window_did_resign_key`로 하고, 크기 이벤트도 끊길 수 있어 window-state 동작을 다시 확인해야 한다.

### 메모리 참고 (M2 Pro, physical footprint)
- WKWebView 하나를 띄운 최소 Swift 앱: 앱 본체 21.5MB + WebContent 17.9MB + GPU 11.1MB + Networking 5.3MB = 약 56MB.
- 같은 구성에서 하이라이터를 여러 개 만들고 결과를 들고 있으면 WebContent가 수백 MB까지 늘어난다. 메모리를 좌우하는 것은 화면에 들고 있는 데이터다.
- 참고로 RunCat(네이티브, WebView 없음)은 65MB다.

## 구조(제안)
```
src-tauri/src/
  tray.rs      메뉴 막대 아이콘 프레임과 배지, 패널 위치·닫기·핀, Dock 숨김
  env.rs       로그인 셸 환경, git 경로, askpass/editor 헬퍼 소켓
  settings.rs  settings.json / keybindings.json 읽기·쓰기·감시
  project.rs   탭별 프로젝트, 저장소 감지, 워처
  queue.rs     저장소별 쓰기 큐, 네트워크 작업, index.lock 재시도, 취소
  read/        gix: status, log, commit_files, diff, blame, remote, graph
  write/       git CLI 헬퍼와 쓰기 명령, patch 적용, 복구 지점
  avatar.rs    아바타(noreply, gh GraphQL, Gravatar, 디스크 캐시)
  terminal.rs  통합 터미널(PTY 셸, zsh/bash 시작 파일은 terminal/)
  crash.rs     옵트인 크래시 리포트(경로 제거)
  ai/          Foundation Models Swift 브리지
  update.rs    updater(릴리스 빌드에만 키·피드), 로그인 시 자동 실행
src/
  commands/    명령 레지스트리
  i18n/        10개 언어(VS Code 언어팩 복사분 + 직접 번역)
  routes/      panel(프로젝트 탭 + 뷰), detail(diff, graph, settings, keyboard-shortcuts, terminal 탭)
  features/remote/  호스팅별 remote URL(순수 계산이라 프론트)
  features/<뷰 또는 기능>/{api.ts,components/}
  workers/     shiki worker(Oniguruma WASM)
scripts/       아이콘 생성, 번역 가져오기·검사
site/          kkom.net 페이지
packaging/     Homebrew cask 템플릿
.github/       검사·릴리스(서명·notarize·universal) 워크플로
```

## 마일스톤
0. **골격과 스파이크**: Tauri + Bun + Vite + React + coss ui 골격(빌드 통과, 시스템 폰트), 필요한 모듈 설치, 메뉴 막대 패널 수동 검증(coss ui 화면으로). 루트 `AGENTS.md`(확정 결정 요약, 50줄 이하) + `CLAUDE.md` 심볼릭 링크, MIT LICENSE, THIRD_PARTY_NOTICES. 검사 통과 후 사용자 확인을 받고 첫 커밋과 공개 저장소 생성.
1. **기반**: 메뉴 막대 아이콘과 패널, 셸 환경과 askpass/editor 헬퍼, 쓰기 큐, settings/keybindings, i18n, 테마 preset, 명령 레지스트리와 팔레트, 프로젝트 탭, 저장소 감지, 감시, 상태 복원, 로그인 시 자동 실행.
2. **Source Control**: 그룹, 파일 메뉴, 커밋(smart commit, amend, commit & push), 안전장치, 충돌 처리, AI 커밋 메시지.
3. **상세 창**: diff 탭(side-by-side/inline, Shiki worker), 블록·선택 영역 Stage/Revert, blame 토글, Settings·Keyboard Shortcuts 탭.
4. **GitLens 뷰 1**: Commits, File History, Line History, Search & Compare, Remote 동기화, remote 링크와 아바타.
5. **GitLens 뷰 2**: Branches, Remotes, Tags, Stashes, Worktrees, Contributors, 뷰 보이기/숨기기.
6. **Graph 탭**.
7. **배포**: CI 서명·notarize, 공개 릴리스, updater, 자체 brew tap, 옵트인 Sentry, 전역 단축키, 아이콘 프레임 확정, kkom.net 페이지.

## 검증
- **Rust**: `cargo clippy`, `cargo test`. tempdir에 git CLI로 만든 fixture 저장소(서브모듈, 충돌, rename 포함)에서 명령을 실행하고, gix 읽기 결과를 git CLI 출력과 비교한다.
- **프론트**: `bun run typecheck`, `bun run lint`, `bun run build`. IPC를 모킹한 Vite 화면을 Playwright로 띄워 메뉴 순서·조건·단축키가 명령 레지스트리 정의와 일치하는지 확인한다.
- **실제 앱**: tauri-driver가 macOS를 지원하지 않으므로 릴리스 전 체크리스트로 VS Code와 나란히 수동 비교한다. 파괴적 작업은 fixture 저장소에서만 한다.

## 화면 동작 확인 (M1)
터미널 앱에 손쉬운 사용과 화면 기록 권한이 있으면 에이전트가 클릭·드래그·키 입력 이벤트를 보내고 화면을 캡처해 직접 확인한다. 권한은 사용자가 시작을 지시할 때 부여한다. 대상:
- 아이콘을 클릭했을 때 패널이 제 위치에 열리는지
- macOS 26 메뉴 막대가 붐빌 때(노치) 아이콘이 숨겨지는지
- 패널 가장자리를 끌어 크기를 바꾸고 그 크기가 기억되는지
- 다른 앱이 전체화면일 때 그 위에 열리는지, 열려도 포커스를 뺏지 않는지(전체화면 앱을 먼저 띄워 둬야 함)
- 전역 단축키로 열고 닫히는지
- 폴더 선택 창이 앞으로 나오는지
