# Webview 터미널 전환 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pseudoterminal API 기반 터미널을 WebviewPanel + xterm.js 직접 렌더링으로 전환하고, 하단 입력창을 통합한다.

**Architecture:** Extension이 WebviewPanel을 생성하고 내부에 xterm.js를 로드. Go 브릿지와의 통신은 기존 ShellPty를 콜백 기반으로 변경하여 유지. Extension ↔ Webview 간 postMessage로 데이터 전달.

**Tech Stack:** VSCode WebviewPanel API, xterm.js (@xterm/xterm, @xterm/addon-fit), Go PTY Bridge, esbuild

**Spec:** `docs/superpowers/specs/2026-03-26-webview-terminal-design.md`

---

## 파일 구조

| 파일 | 역할 | 변경 |
|------|------|------|
| `package.json` | 의존성, 커맨드, 키바인딩 | 수정 |
| `esbuild.js` | Extension + Webview 이중 빌드 | 수정 |
| `src/shell-pty.ts` | Go 브릿지 통신 (콜백 기반) | 수정 (재작성) |
| `src/terminal-manager.ts` | WebviewPanel 생성/관리, ShellPty 연결 | 수정 (재작성) |
| `src/extension.ts` | 커맨드 등록, 이벤트 리스너 | 수정 (간소화) |
| `src/webview/terminal.ts` | Webview 내부 스크립트 (xterm.js + 입력창) | 신규 |
| `src/webview/terminal.html` | Webview HTML 템플릿 | 신규 |

---

## Chunk 1: 빌드 인프라 및 의존성

### Task 1: xterm.js 의존성 추가 및 esbuild 이중 빌드 설정

**Files:**
- Modify: `package.json`
- Modify: `esbuild.js`

- [ ] **Step 1: xterm.js 의존성 추가**

`package.json`의 `dependencies`에 추가:

```json
"dependencies": {
  "@xterm/xterm": "^5.5.0",
  "@xterm/addon-fit": "^0.10.0",
  "@xterm/addon-webgl": "^0.19.0"
}
```

`node-pty`를 `external`에서 사용하지 않으므로 esbuild external에서도 제거.

프롬프트 에디터 관련 커맨드/키바인딩 제거:
- `terminalTabs.openPromptEditor` 커맨드 제거
- `terminalTabs.sendPrompt` 커맨드 제거
- `ctrl+shift+i` 키바인딩 제거
- `ctrl+enter` 키바인딩 제거
- `editor/title`의 `sendPrompt` 메뉴 제거

- [ ] **Step 2: esbuild.js에 Webview 번들 추가**

Extension 빌드와 Webview 빌드를 분리. Webview는 `platform: 'browser'`, CSS를 `text`로 로드:

```javascript
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  // Extension 빌드 (Node.js)
  const extCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
  });

  // Webview 빌드 (브라우저)
  const webviewCtx = await esbuild.context({
    entryPoints: ['src/webview/terminal.ts'],
    bundle: true,
    format: 'iife',
    minify: production,
    sourcemap: !production,
    platform: 'browser',
    outfile: 'dist/webview.js',
    loader: { '.css': 'text' },
    logLevel: 'silent',
  });

  if (watch) {
    await extCtx.watch();
    await webviewCtx.watch();
    console.log('watching...');
  } else {
    await extCtx.rebuild();
    await webviewCtx.rebuild();
    await extCtx.dispose();
    await webviewCtx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: npm install 및 빌드 확인**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && npm install`
Run: `npm run build`
Expected: dist/extension.js 생성 (webview.js는 아직 entry point가 없으므로 실패 가능 — 다음 Task에서 생성)

---

## Chunk 2: Webview UI (xterm.js + 입력창)

### Task 2: Webview HTML 템플릿 작성

**Files:**
- Create: `src/webview/terminal.html`

- [ ] **Step 1: HTML 파일 작성**

`{{webviewJs}}`와 `{{cspSource}}`는 Extension에서 치환할 플레이스홀더:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src {{cspSource}}; style-src 'unsafe-inline'; font-src {{cspSource}};">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background, #1e1e1e); }
    #container { display: flex; flex-direction: column; width: 100%; height: 100%; }
    #terminal { flex: 1; overflow: hidden; }
    #prompt-bar {
      display: flex;
      gap: 4px;
      padding: 4px;
      border-top: 1px solid var(--vscode-panel-border, #333);
      background: var(--vscode-editor-background, #1e1e1e);
    }
    #prompt-input {
      flex: 1;
      min-height: 28px;
      max-height: 120px;
      padding: 4px 8px;
      border: 1px solid var(--vscode-input-border, #444);
      background: var(--vscode-input-background, #2a2a2a);
      color: var(--vscode-input-foreground, #ccc);
      font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      resize: none;
      outline: none;
    }
    #prompt-input:focus { border-color: var(--vscode-focusBorder, #007acc); }
    #send-btn {
      padding: 4px 12px;
      background: var(--vscode-button-background, #007acc);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      cursor: pointer;
      font-size: 13px;
    }
    #send-btn:hover { background: var(--vscode-button-hoverBackground, #005a9e); }
  </style>
</head>
<body>
  <div id="container">
    <div id="terminal"></div>
    <div id="prompt-bar">
      <textarea id="prompt-input" placeholder="프롬프트 입력 (Shift+Enter로 전송)" rows="1"></textarea>
      <button id="send-btn">▶</button>
    </div>
  </div>
  <script src="{{webviewJs}}"></script>
</body>
</html>
```

### Task 3: Webview 내부 스크립트 작성

**Files:**
- Create: `src/webview/terminal.ts`

- [ ] **Step 1: xterm.js 초기화 및 메시지 통신 구현**

```typescript
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import xtermCss from '@xterm/xterm/css/xterm.css';

// VSCode API
const vscode = acquireVsCodeApi();

// xterm.css 주입
const styleEl = document.createElement('style');
styleEl.textContent = xtermCss;
document.head.appendChild(styleEl);

// xterm.js 초기화
const terminalEl = document.getElementById('terminal')!;
const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 13,
  fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
});

const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(terminalEl);

try {
  terminal.loadAddon(new WebglAddon());
} catch {
  // WebGL 미지원 시 Canvas 폴백
}

// 초기 fit
setTimeout(() => fitAddon.fit(), 50);

// 리사이즈 감지
let resizeTimeout: ReturnType<typeof setTimeout>;
const resizeObserver = new ResizeObserver(() => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    fitAddon.fit();
    vscode.postMessage({
      type: 'resize',
      cols: terminal.cols,
      rows: terminal.rows,
    });
  }, 100);
});
resizeObserver.observe(terminalEl);

// xterm.js 키 입력 → Extension
terminal.onData((data) => {
  vscode.postMessage({ type: 'input', data });
});

// Extension → xterm.js 출력
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'output':
      terminal.write(msg.data);
      break;
    case 'set-theme':
      terminal.options.theme = msg.theme;
      break;
  }
});

// 입력창 처리
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn')!;

function sendPrompt() {
  const text = promptInput.value.trim();
  if (!text) return;
  vscode.postMessage({ type: 'prompt', text });
  promptInput.value = '';
  promptInput.style.height = '28px';
  terminal.focus();
}

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});

// textarea 자동 높이 조절
promptInput.addEventListener('input', () => {
  promptInput.style.height = '28px';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
});

sendBtn.addEventListener('click', sendPrompt);
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: `dist/webview.js` 생성

---

## Chunk 3: ShellPty 리팩토링

### Task 4: ShellPty를 콜백 기반으로 재작성

**Files:**
- Modify: `src/shell-pty.ts`

- [ ] **Step 1: ShellPty 재작성**

Pseudoterminal 인터페이스와 배칭 로직을 제거하고, obsidian 프로젝트와 유사한 콜백 기반으로 변경:

```typescript
import * as os from 'os';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

interface BridgeMessage {
  type: 'output' | 'exit';
  data?: string;
  code?: number;
}

export class ShellPty {
  private bridgeProcess: ChildProcess | undefined;
  private disposed = false;
  private dataCallbacks: ((data: string) => void)[] = [];
  private exitCallbacks: (() => void)[] = [];

  constructor(
    private extensionPath: string,
    private cwd: string,
    private cols: number,
    private rows: number
  ) {}

  start(): void {
    try {
      const bridgeBinary = this.getBridgeBinaryName();
      const bridgePath = path.join(this.extensionPath, 'bin', bridgeBinary);

      this.bridgeProcess = spawn(bridgePath, [], {
        cwd: this.cwd,
        env: { ...process.env, COLORTERM: 'truecolor', TERM_PROGRAM: 'vscode' },
      });

      if (this.bridgeProcess.stdout) {
        const rl = readline.createInterface({
          input: this.bridgeProcess.stdout,
          terminal: false,
        });

        rl.on('line', (line) => {
          if (this.disposed) return;
          try {
            const msg: BridgeMessage = JSON.parse(line);
            if (msg.type === 'output' && msg.data) {
              this.dataCallbacks.forEach((cb) => cb(msg.data!));
            } else if (msg.type === 'exit') {
              this.exitCallbacks.forEach((cb) => cb());
            }
          } catch {
            // JSON 파싱 실패 시 무시
          }
        });
      }

      this.bridgeProcess.on('error', (err) => {
        this.dataCallbacks.forEach((cb) => cb(`\r\n[Bridge Error]: ${err.message}\r\n`));
        this.exitCallbacks.forEach((cb) => cb());
      });

      this.resize(this.cols, this.rows);
    } catch (e) {
      this.dataCallbacks.forEach((cb) => cb(`\r\n[Fatal Error]: ${e}\r\n`));
      this.exitCallbacks.forEach((cb) => cb());
    }
  }

  write(data: string): void {
    if (this.bridgeProcess?.stdin && !this.disposed) {
      const msg = JSON.stringify({ type: 'input', data });
      this.bridgeProcess.stdin.write(msg + '\n');
    }
  }

  resize(cols: number, rows: number): void {
    if (this.bridgeProcess?.stdin && !this.disposed) {
      const msg = JSON.stringify({ type: 'resize', cols, rows });
      this.bridgeProcess.stdin.write(msg + '\n');
    }
  }

  onData(callback: (data: string) => void): void {
    this.dataCallbacks.push(callback);
  }

  onExit(callback: () => void): void {
    this.exitCallbacks.push(callback);
  }

  kill(): void {
    this.disposed = true;
    this.bridgeProcess?.kill();
    this.bridgeProcess = undefined;
    this.dataCallbacks = [];
    this.exitCallbacks = [];
  }

  private getBridgeBinaryName(): string {
    const platform = os.platform();
    const arch = os.arch();
    let name = `pty-bridge-${platform}-${arch}`;
    if (platform === 'win32') name += '.exe';
    return name;
  }
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 빌드 성공 (terminal-manager에서 import 에러는 다음 Task에서 해결)

---

## Chunk 4: TerminalManager 재작성

### Task 5: WebviewPanel 기반 TerminalManager

**Files:**
- Modify: `src/terminal-manager.ts`

- [ ] **Step 1: TerminalManager 재작성**

Pseudoterminal/MARKER 기반에서 WebviewPanel 기반으로 전환. HTML 템플릿은 파일에서 읽어서 플레이스홀더 치환:

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { resolveIcon } from './icon-resolver';
import { ShellPty } from './shell-pty';

export interface CommandConfig {
  name: string;
  icon?: string;
  command: string;
}

const GROUP_LOCK_TIMEOUT_MS = 1000;

interface ManagedPanel {
  panel: vscode.WebviewPanel;
  shellPty: ShellPty;
}

export class TerminalManager {
  private managedPanels: Set<ManagedPanel> = new Set();
  private targetViewColumn: vscode.ViewColumn | undefined;

  constructor(private context: vscode.ExtensionContext) {}

  async cleanupEmptyGroups(): Promise<void> {
    for (const group of vscode.window.tabGroups.all) {
      if (group.tabs.length === 0) {
        try {
          await vscode.window.tabGroups.close(group);
        } catch {
          // 이미 정리된 경우 무시
        }
      }
    }
  }

  async runCommand(config: CommandConfig): Promise<void> {
    if (this.targetViewColumn && this.managedPanels.size > 0) {
      this.createManagedPanel(config, this.targetViewColumn);
    } else {
      await vscode.commands.executeCommand('workbench.action.newGroupRight');
      const newViewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
      this.targetViewColumn = newViewColumn;

      this.createManagedPanel(config, newViewColumn);

      await this.waitForGroupChange();
      await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
    }
  }

  private createManagedPanel(config: CommandConfig, viewColumn: vscode.ViewColumn): void {
    const panel = vscode.window.createWebviewPanel(
      'terminalTab',
      config.name,
      { viewColumn, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        ],
      }
    );

    // 아이콘 설정
    const iconPath = resolveIcon(config.icon, this.context);
    if (iconPath) {
      panel.iconPath = iconPath instanceof vscode.ThemeIcon ? undefined : iconPath;
    }

    // HTML 설정
    panel.webview.html = this.getWebviewHtml(panel.webview);

    // ShellPty 생성
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? require('os').homedir();
    const shellPty = new ShellPty(this.context.extensionPath, cwd, 80, 24);

    const managed: ManagedPanel = { panel, shellPty };
    this.managedPanels.add(managed);

    // ShellPty → Webview
    shellPty.onData((data) => {
      panel.webview.postMessage({ type: 'output', data });
    });

    shellPty.onExit(() => {
      panel.webview.postMessage({ type: 'output', data: '\r\n[Process exited]\r\n' });
    });

    // Webview → ShellPty
    panel.webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case 'input':
          shellPty.write(msg.data);
          break;
        case 'resize':
          shellPty.resize(msg.cols, msg.rows);
          break;
        case 'prompt':
          shellPty.write(msg.text + '\n');
          break;
      }
    });

    // 패널 닫힐 때 정리
    panel.onDidDispose(() => {
      shellPty.kill();
      this.managedPanels.delete(managed);
      if (this.managedPanels.size === 0) {
        this.targetViewColumn = undefined;
      }
    });

    // 초기 명령어 실행
    shellPty.start();
    if (config.command.trim()) {
      const delayMs = vscode.workspace.getConfiguration('terminalTabs').get<number>('commandDelayMs', 0);
      setTimeout(() => {
        shellPty.write(config.command + '\n');
      }, delayMs);
    }
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(this.context.extensionPath, 'src', 'webview', 'terminal.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');

    const webviewJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );

    html = html.replace(/\{\{webviewJs\}\}/g, webviewJsUri.toString());
    html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);

    return html;
  }

  private waitForGroupChange(): Promise<void> {
    return new Promise<void>((resolve) => {
      const disposable = vscode.window.tabGroups.onDidChangeTabGroups(() => {
        clearTimeout(timer);
        disposable.dispose();
        resolve();
      });
      const timer = setTimeout(() => {
        disposable.dispose();
        resolve();
      }, GROUP_LOCK_TIMEOUT_MS);
    });
  }

  focusTerminalByName(name: string): boolean {
    for (const managed of this.managedPanels) {
      if (managed.panel.title === name) {
        managed.panel.reveal();
        return true;
      }
    }
    return false;
  }

  dispose(): void {
    for (const managed of this.managedPanels) {
      managed.shellPty.kill();
      managed.panel.dispose();
    }
    this.managedPanels.clear();
  }
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 빌드 성공

---

## Chunk 5: Extension 간소화

### Task 6: extension.ts 정리

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 프롬프트 에디터 및 불필요한 코드 제거**

```typescript
import * as vscode from 'vscode';
import { TerminalManager, CommandConfig } from './terminal-manager';

let terminalManager: TerminalManager;

export function activate(context: vscode.ExtensionContext) {
  terminalManager = new TerminalManager(context);
  terminalManager.cleanupEmptyGroups().catch(() => {});

  const disposable = vscode.commands.registerCommand(
    'terminalTabs.runCommand',
    async () => {
      const config = vscode.workspace.getConfiguration('terminalTabs');
      const commands: CommandConfig[] = config.get('commands', []);

      if (commands.length === 0) {
        const action = await vscode.window.showInformationMessage(
          'Terminal Tabs: 설정된 명령어가 없습니다.',
          '설정 열기'
        );
        if (action === '설정 열기') {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'terminalTabs.commands'
          );
        }
        return;
      }

      const items: vscode.QuickPickItem[] = commands.map((cmd) => ({
        label: cmd.name,
        description: cmd.command,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '실행할 명령어를 선택하세요',
      });

      if (!selected) return;

      const selectedIndex = items.indexOf(selected);
      await terminalManager.runCommand(commands[selectedIndex]);
    }
  );

  const runByName = vscode.commands.registerCommand(
    'terminalTabs.runCommandByName',
    async (args?: { name?: string }) => {
      if (!args?.name) {
        vscode.window.showErrorMessage('Terminal Tabs: "name" 인자가 필요합니다.');
        return;
      }

      const config = vscode.workspace.getConfiguration('terminalTabs');
      const commands: CommandConfig[] = config.get('commands', []);
      const found = commands.find((cmd) => cmd.name === args.name);

      if (!found) {
        vscode.window.showErrorMessage(`Terminal Tabs: "${args.name}" 명령어를 찾을 수 없습니다.`);
        return;
      }

      if (!terminalManager.focusTerminalByName(found.name)) {
        await terminalManager.runCommand(found);
      }
    }
  );

  context.subscriptions.push(disposable, runByName);
}

export function deactivate() {
  terminalManager?.dispose();
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 없이 빌드 성공

---

## Chunk 6: 빌드 및 수동 검증

### Task 7: 전체 빌드 및 설치

- [ ] **Step 1: 전체 빌드**

Run: `npm run build`
Expected: `dist/extension.js`와 `dist/webview.js` 모두 생성

- [ ] **Step 2: 설치**

Run: `bash install.sh`
Expected: VSIX 패키징 및 설치 성공

### Task 8: 수동 검증

- [ ] VSCode Reload 후 터미널 탭 열기 (QuickPick 또는 단축키)
- [ ] Webview에 xterm.js가 렌더링되고 쉘 프롬프트가 표시되는지 확인
- [ ] 키보드 입력이 쉘에 전달되는지 확인
- [ ] 하단 입력창에 텍스트 입력 후 Shift+Enter로 터미널에 전달되는지 확인
- [ ] ▶ 버튼 클릭으로도 전달되는지 확인
- [ ] 창 리사이즈 시 터미널 크기가 동기화되는지 확인
- [ ] 여러 터미널 탭이 같은 그룹에 생성되는지 확인
- [ ] 터미널 탭 닫기 시 Go 브릿지 프로세스가 종료되는지 확인
- [ ] 단축키(Ctrl+Shift+1~4)로 기존 터미널 포커스 이동이 되는지 확인
