# Webview 터미널 전환 설계

## 배경

현재 Pseudoterminal API 기반 터미널은 xterm.js에 대한 직접 접근이 불가능하여 스크롤 제어, 커스텀 UI 삽입 등에 한계가 있다. WebviewPanel에 xterm.js를 직접 로드하는 방식으로 전환하여 터미널 렌더링을 완전히 제어하고, 하단 입력창을 통합한다.

## 아키텍처

```
Extension (Node.js)
├── TerminalManager — WebviewPanel 생성/관리, Go 브릿지 연결
├── ShellPty — Go 브릿지 JSON IPC (기존 유지)
└── Webview (브라우저 컨텍스트)
    ├── xterm.js — 터미널 렌더링
    ├── FitAddon — 리사이즈 처리
    └── 입력창 — 프롬프트 작성 및 전송

데이터 흐름:
Go Bridge ↔ ShellPty ↔ Extension ↔ postMessage ↔ Webview(xterm.js)
```

## Webview 내부 레이아웃

```
┌─────────────────────────────┐
│  xterm.js (flex: 1)         │
│                             │
│                             │
├─────────────────────────────┤
│  textarea + [▶] 버튼        │
│  Shift+Enter = 전송          │
│  Enter = 줄바꿈              │
└─────────────────────────────┘
```

## 메시지 프로토콜 (Extension ↔ Webview)

### Extension → Webview
- `{ type: 'output', data: string }` — 터미널 출력
- `{ type: 'set-theme', theme: { background, foreground, cursor } }` — 테마 설정

### Webview → Extension
- `{ type: 'input', data: string }` — xterm.js 키 입력
- `{ type: 'resize', cols: number, rows: number }` — 터미널 리사이즈
- `{ type: 'prompt', text: string }` — 입력창에서 전송

## 변경 사항

### 1. `package.json`

- xterm.js 의존성 추가: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`
- 프롬프트 에디터 관련 커맨드/키바인딩 제거 (`openPromptEditor`, `sendPrompt`)

### 2. `esbuild.js`

Webview용 번들을 별도로 빌드. xterm.js와 Webview 스크립트를 하나의 JS 파일로 번들링하여 `dist/webview.js`로 출력.

### 3. `src/webview/terminal.html` (신규)

xterm.js 컨테이너, 하단 입력창(textarea + 전송 버튼), VSCode API 스크립트 로드. CSS는 인라인 또는 별도 파일.

### 4. `src/webview/terminal.ts` (신규)

Webview 내부에서 실행되는 스크립트:
- xterm.js 초기화 및 FitAddon 로드
- `acquireVsCodeApi()`로 Extension과 통신
- `terminal.onData()` → `postMessage({ type: 'input', data })`
- `message` 이벤트 수신 → `terminal.write(data)`
- ResizeObserver → `postMessage({ type: 'resize', cols, rows })`
- 입력창 Shift+Enter → `postMessage({ type: 'prompt', text })`
- 입력창 Enter → 줄바꿈

### 5. `src/terminal-manager.ts`

- `createWebviewPanel()`로 Webview 탭 생성
- `webview.onDidReceiveMessage()`로 Webview 메시지 수신
- `input` 메시지 → `ShellPty.write(data)`
- `resize` 메시지 → `ShellPty.resize(cols, rows)`
- `prompt` 메시지 → `ShellPty.write(text + '\n')`
- `ShellPty.onData()` → `webview.postMessage({ type: 'output', data })`
- 기존 Pseudoterminal 관련 코드 제거 (`createTerminal`, `MARKER` 등)
- 그룹 관리: WebviewPanel의 `viewColumn` 활용

### 6. `src/shell-pty.ts`

- 배칭 로직 제거 (`pendingData`, `batchTimer`, `enqueueWrite`)
- `Pseudoterminal` 인터페이스 제거
- Go 브릿지 통신만 담당하는 순수 클래스로 변경 (obsidian 프로젝트의 ShellPty와 유사)
- 콜백 기반 인터페이스: `onData(callback)`, `onExit(callback)`

### 7. `src/extension.ts`

- 프롬프트 에디터 관련 코드 전체 제거 (`openPromptEditor`, `sendPrompt`, `promptEditorUri`, context 추적 등)
- `onDidChangeActiveTerminal` 리스너 제거 (Webview는 터미널이 아님)
- `commandsToSkipShell` 등록 제거 (터미널 패널을 사용하지 않으므로 불필요)

## 제거 대상

- `writeEmitter`, `closeEmitter`, `onDidWrite`, `onDidClose` (Pseudoterminal API)
- `pendingData`, `batchTimer`, `enqueueWrite`, `drainQueue` (배칭)
- `openPromptEditor`, `sendPrompt`, `promptEditorUri` (프롬프트 에디터)
- `trackActiveTerminal`, `lastActiveTerminal`, `showLastActiveTerminal`, `sendKeyToLastActiveTerminal` (터미널 추적)
- `MARKER`, 탭 라벨 마커 기반 그룹 탐색 (Webview 패널로 대체)

## 그룹 관리

기존 MARKER 기반 그룹 탐색 대신, `WebviewPanel`의 `viewColumn`을 직접 추적한다. `createWebviewPanel()`의 `viewColumn` 파라미터로 위치를 지정하고, 첫 번째 패널 생성 시 `newGroupRight` + 그룹 잠금을 유지한다.

## 검증

- Webview 터미널에서 쉘 프롬프트/motd가 정상 출력되는지 확인
- xterm.js 키 입력이 쉘에 정상 전달되는지 확인
- 하단 입력창에서 Shift+Enter로 텍스트가 터미널에 전달되는지 확인
- 리사이즈 시 xterm.js + PTY 크기가 동기화되는지 확인
- 여러 터미널 탭이 같은 그룹에 생성되는지 확인
- 터미널 닫기/확장 비활성화 시 Go 브릿지 프로세스가 종료되는지 확인
