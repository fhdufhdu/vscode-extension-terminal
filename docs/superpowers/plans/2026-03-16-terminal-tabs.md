# Terminal Tabs Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에디터 탭 우측 상단 버튼으로 사용자 설정 터미널 명령어를 실행하는 VSCode 확장 구현

**Architecture:** VSCode Terminal API + `editor/title` 메뉴 버튼 + QuickPick UI. 터미널 생성 시 에디터 그룹 추적하여 핀 고정된 그룹에 모아서 열기. 아이콘은 codicon/내장SVG/커스텀파일 3가지 분기.

**Tech Stack:** TypeScript, VSCode Extension API, esbuild (번들러)

**Spec:** `docs/superpowers/specs/2026-03-16-terminal-tabs-design.md`

---

## File Structure

```
vscode-extension-terminal/
├── package.json              # 확장 매니페스트, 설정 스키마, 커맨드, 메뉴
├── tsconfig.json             # TypeScript 설정
├── esbuild.js                # 빌드 스크립트
├── .vscodeignore              # 패키징 제외 파일
├── src/
│   ├── extension.ts          # activate/deactivate, 커맨드 등록, QuickPick UI
│   ├── terminal-manager.ts   # 터미널 생성, 에디터 그룹 추적, 핀 고정
│   └── icon-resolver.ts      # icon 문자열 → ThemeIcon / Uri 변환
├── icons/
│   ├── claude.svg            # Claude 내장 아이콘
│   ├── gemini.svg            # Gemini 내장 아이콘
│   └── codex.svg             # Codex 내장 아이콘
└── README.md
```

---

## Chunk 1: 프로젝트 초기화 및 아이콘 리졸버

### Task 1: 프로젝트 스캐폴딩

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.js`
- Create: `.vscodeignore`

- [ ] **Step 1: package.json 생성**

```json
{
  "name": "terminal-tabs",
  "displayName": "Terminal Tabs",
  "description": "에디터 탭 우측 상단에서 터미널 명령어를 실행하는 확장",
  "version": "0.0.1",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": [],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "terminalTabs.runCommand",
        "title": "Terminal Tabs: Run Command",
        "icon": "$(terminal)"
      }
    ],
    "menus": {
      "editor/title": [
        {
          "command": "terminalTabs.runCommand",
          "group": "navigation"
        }
      ]
    },
    "configuration": {
      "title": "Terminal Tabs",
      "properties": {
        "terminalTabs.commands": {
          "type": "array",
          "markdownDescription": "터미널 탭에서 실행할 명령어 목록. 각 항목에 `name`, `command`, `icon`(선택)을 설정합니다.",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "description": "터미널 탭에 표시될 이름"
              },
              "icon": {
                "type": "string",
                "markdownDescription": "아이콘. codicon 이름(예: `play`), 내장 아이콘(`claude`, `gemini`, `codex`), 또는 이미지 파일 경로(예: `./icons/my.svg`)"
              },
              "command": {
                "type": "string",
                "description": "실행할 터미널 명령어"
              }
            },
            "required": ["name", "command"],
            "additionalProperties": false
          },
          "default": []
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run build",
    "build": "node esbuild.js --production",
    "watch": "node esbuild.js --watch",
    "lint": "eslint src"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^20.0.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.3.0"
  }
}
```

- [ ] **Step 2: tsconfig.json 생성**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2022"],
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: esbuild.js 생성**

```javascript
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
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
  if (watch) {
    await ctx.watch();
    console.log('watching...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: .vscodeignore 생성**

```
.vscode/**
src/**
node_modules/**
tsconfig.json
esbuild.js
```

- [ ] **Step 5: npm install**

Run: `npm install`
Expected: `node_modules` 생성, 에러 없음

- [ ] **Step 6: 빌드 확인용 빈 extension.ts 생성 및 빌드**

Create `src/extension.ts`:
```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {}

export function deactivate() {}
```

Run: `npm run build`
Expected: `dist/extension.js` 생성, 에러 없음

- [ ] **Step 7: 커밋**

```bash
git init
git add package.json tsconfig.json esbuild.js .vscodeignore src/extension.ts
git commit -m "chore: init project scaffolding"
```

---

### Task 2: 아이콘 파일 및 icon-resolver 구현

**Files:**
- Create: `icons/claude.svg`
- Create: `icons/gemini.svg`
- Create: `icons/codex.svg`
- Create: `src/icon-resolver.ts`

- [ ] **Step 1: 내장 아이콘 SVG 파일 생성**

`icons/claude.svg`, `icons/gemini.svg`, `icons/codex.svg` — 각 브랜드의 간단한 16x16 SVG 아이콘 생성. 웹에서 공식 로고를 참고하여 단순화된 SVG 작성.

- [ ] **Step 2: icon-resolver.ts 구현**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const BUILTIN_ICONS = ['claude', 'gemini', 'codex'];

export function resolveIcon(
  icon: string | undefined,
  context: vscode.ExtensionContext
): vscode.ThemeIcon | vscode.Uri | undefined {
  if (!icon) {
    return new vscode.ThemeIcon('terminal');
  }

  // 내장 아이콘
  if (BUILTIN_ICONS.includes(icon)) {
    return vscode.Uri.file(context.asAbsolutePath(`icons/${icon}.svg`));
  }

  // 파일 경로 (상대 또는 절대)
  if (icon.startsWith('./') || icon.startsWith('/') || icon.startsWith('\\')) {
    const resolvedPath = icon.startsWith('/')
      ? icon
      : path.resolve(
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
          icon
        );
    if (fs.existsSync(resolvedPath)) {
      return vscode.Uri.file(resolvedPath);
    }
    return new vscode.ThemeIcon('terminal');
  }

  // codicon 이름
  return new vscode.ThemeIcon(icon);
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add icons/ src/icon-resolver.ts
git commit -m "feat: add icon resolver with builtin/codicon/custom file support"
```

---

## Chunk 2: 터미널 매니저 및 확장 진입점

### Task 3: terminal-manager.ts 구현

**Files:**
- Create: `src/terminal-manager.ts`

- [ ] **Step 1: terminal-manager.ts 구현**

```typescript
import * as vscode from 'vscode';
import { resolveIcon } from './icon-resolver';

interface CommandConfig {
  name: string;
  icon?: string;
  command: string;
}

export class TerminalManager {
  private trackedGroupViewColumn: vscode.ViewColumn | null = null;
  private managedTerminals: Set<vscode.Terminal> = new Set();

  constructor(private context: vscode.ExtensionContext) {}

  async runCommand(config: CommandConfig): Promise<void> {
    const iconPath = resolveIcon(config.icon, this.context);

    // 추적 중인 에디터 그룹 확인
    const viewColumn = this.getTrackedViewColumn();

    const terminalOptions: vscode.TerminalOptions = {
      name: config.name,
      iconPath,
    };

    // 추적 중인 그룹이 있으면 해당 위치에 열기
    if (viewColumn !== null) {
      terminalOptions.location = {
        viewColumn,
        preserveFocus: false,
      };
    }

    const terminal = vscode.window.createTerminal(terminalOptions);
    terminal.show();
    terminal.sendText(config.command);

    this.managedTerminals.add(terminal);

    // 에디터 영역에 열렸으면 핀 고정 및 그룹 추적
    await this.pinAndTrack(terminal);
  }

  private getTrackedViewColumn(): vscode.ViewColumn | null {
    if (this.trackedGroupViewColumn === null) {
      return null;
    }

    // 추적 중인 그룹이 아직 존재하는지 확인
    const groups = vscode.window.tabGroups.all;
    const exists = groups.some(
      (g) => g.viewColumn === this.trackedGroupViewColumn
    );

    if (!exists) {
      this.trackedGroupViewColumn = null;
      return null;
    }

    return this.trackedGroupViewColumn;
  }

  private async pinAndTrack(terminal: vscode.Terminal): Promise<void> {
    // 터미널이 에디터 영역에 열렸는지 확인하기 위해 약간의 지연
    await new Promise((resolve) => setTimeout(resolve, 300));

    const tabGroups = vscode.window.tabGroups.all;
    for (const group of tabGroups) {
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputTerminal &&
          tab.input.terminal === terminal
        ) {
          // 에디터 영역에 열림 → 핀 고정
          await vscode.commands.executeCommand('workbench.action.pinEditor');
          this.trackedGroupViewColumn = group.viewColumn;
          return;
        }
      }
    }
  }

  onTerminalClosed(terminal: vscode.Terminal): void {
    this.managedTerminals.delete(terminal);
  }

  dispose(): void {
    this.managedTerminals.clear();
    this.trackedGroupViewColumn = null;
  }
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/terminal-manager.ts
git commit -m "feat: add terminal manager with group tracking and pin logic"
```

---

### Task 4: extension.ts 구현

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: extension.ts 구현**

```typescript
import * as vscode from 'vscode';
import { TerminalManager } from './terminal-manager';

interface CommandConfig {
  name: string;
  icon?: string;
  command: string;
}

let terminalManager: TerminalManager;

export function activate(context: vscode.ExtensionContext) {
  terminalManager = new TerminalManager(context);

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
        label: cmd.icon ? `$(${cmd.icon}) ${cmd.name}` : cmd.name,
        description: cmd.command,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '실행할 명령어를 선택하세요',
      });

      if (!selected) {
        return;
      }

      const selectedIndex = items.indexOf(selected);
      const selectedCommand = commands[selectedIndex];

      await terminalManager.runCommand(selectedCommand);
    }
  );

  const terminalCloseListener = vscode.window.onDidCloseTerminal(
    (terminal) => {
      terminalManager.onTerminalClosed(terminal);
    }
  );

  context.subscriptions.push(disposable, terminalCloseListener);
}

export function deactivate() {
  terminalManager?.dispose();
}
```

> **참고:** QuickPick의 label에 `$(icon)` 문법은 codicon만 지원됩니다. 커스텀/내장 아이콘은 터미널 탭 아이콘에만 반영되고, QuickPick 목록에서는 이름만 표시됩니다.

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: `dist/extension.js` 생성, 에러 없음

- [ ] **Step 3: 확장 테스트**

VSCode에서 `F5`로 Extension Development Host 실행:
1. settings.json에 테스트 명령어 추가
2. 에디터 탭 우측 상단 버튼 클릭
3. QuickPick에서 명령어 선택
4. 터미널 탭 생성 + 명령어 실행 확인
5. 핀 고정 확인
6. 추가 명령어 선택 시 같은 에디터 그룹에 열리는지 확인

- [ ] **Step 4: 커밋**

```bash
git add src/extension.ts
git commit -m "feat: add extension entry point with quickpick command selection"
```

---

## Chunk 3: 마무리

### Task 5: README 및 최종 점검

**Files:**
- Create: `README.md`

- [ ] **Step 1: README.md 작성**

확장 이름, 기능 설명, 설정 예시, 아이콘 설정 방법 포함.

- [ ] **Step 2: 전체 빌드 및 최종 확인**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add README.md
git commit -m "docs: add README with usage and configuration guide"
```
