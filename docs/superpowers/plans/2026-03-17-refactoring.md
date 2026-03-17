# Terminal Tabs 리팩토링 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 타입 중복 제거, 타이밍 개선, 플랫폼 호환성, 리소스 정리 등 코드 품질을 개선한다.

**Architecture:** 기존 4개 파일 구조를 유지하면서 내부만 점진적으로 개선한다. 테스트 프레임워크가 없는 VSCode 확장이므로 빌드 검증 + 수동 테스트로 확인한다.

**Tech Stack:** TypeScript, VSCode Extension API, node-pty

**Spec:** `docs/superpowers/specs/2026-03-17-refactoring-design.md`

---

## Chunk 1: shell-pty.ts 개선

### Task 1: 버퍼링 제거 및 타이밍 상수 추출

**Files:**
- Modify: `src/shell-pty.ts`

- [ ] **Step 1: 타이밍 상수 추가**

파일 상단(import 아래)에 상수를 추가한다:

```typescript
const PTY_COMMAND_DELAY_MS = 500;
const PTY_EXIT_DELAY_MS = 500;
```

- [ ] **Step 2: `dataBuffer`, `ready` 필드 제거**

클래스 프로퍼티에서 아래 두 줄을 제거한다:

```typescript
// 삭제
private dataBuffer: string[] = [];
private ready = false;
```

- [ ] **Step 3: `pty.onData` 콜백을 직접 출력으로 변경**

기존:
```typescript
this.ptyProcess.onData((data) => {
  if (this.disposed) { return; }
  if (this.ready) {
    this.writeEmitter.fire(data);
  } else {
    this.dataBuffer.push(data);
  }
});
```

변경:
```typescript
this.ptyProcess.onData((data) => {
  if (this.disposed) { return; }
  this.writeEmitter.fire(data);
});
```

- [ ] **Step 4: `setTimeout` 블록에서 버퍼 플러시 제거, 명령어 전달만 유지**

기존:
```typescript
setTimeout(() => {
  this.ready = true;
  for (const data of this.dataBuffer) {
    this.writeEmitter.fire(data);
  }
  this.dataBuffer = [];

  if (this.command.trim() && this.ptyProcess) {
    this.ptyProcess.write(this.command + '\n');
  }
}, 500);
```

변경:
```typescript
setTimeout(() => {
  if (this.command.trim() && this.ptyProcess) {
    this.ptyProcess.write(this.command + this.getEOL());
  }
}, PTY_COMMAND_DELAY_MS);
```

- [ ] **Step 5: `onExit` 딜레이를 상수로 변경**

기존:
```typescript
this.ptyProcess.onExit(() => {
  setTimeout(() => {
    if (!this.disposed) {
      this.closeEmitter.fire();
    }
  }, 100);
});
```

변경:
```typescript
this.ptyProcess.onExit(() => {
  setTimeout(() => {
    if (!this.disposed) {
      this.closeEmitter.fire();
    }
  }, PTY_EXIT_DELAY_MS);
});
```

- [ ] **Step 6: 에러 경로의 `setTimeout`도 상수 사용**

기존:
```typescript
} catch (e) {
  setTimeout(() => {
    this.writeEmitter.fire(`Failed to start shell: ${e}\r\n`);
  }, 500);
}
```

변경:
```typescript
} catch (e) {
  setTimeout(() => {
    this.writeEmitter.fire(`Failed to start shell: ${e}\r\n`);
  }, PTY_COMMAND_DELAY_MS);
}
```

### Task 2: 플랫폼 분기 및 env 타입 안전 처리

**Files:**
- Modify: `src/shell-pty.ts`

- [ ] **Step 1: `getShellArgs()` 및 `getEOL()` 메서드 추가**

`getDefaultShell()` 메서드와 클래스 닫는 괄호 사이에 두 메서드를 삽입한다:

기존:
```typescript
  private getDefaultShell(): string {
    if (os.platform() === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }
}
```

변경:
```typescript
  private getDefaultShell(): string {
    if (os.platform() === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  private getShellArgs(): string[] {
    if (os.platform() === 'win32') return [];
    return ['--login'];
  }

  private getEOL(): string {
    return os.platform() === 'win32' ? '\r\n' : '\n';
  }
}
```

- [ ] **Step 2: `pty.spawn()` 호출에서 하드코딩 인자를 메서드 호출로 변경**

기존:
```typescript
this.ptyProcess = pty.spawn(shell, ['--login'], {
```

변경:
```typescript
this.ptyProcess = pty.spawn(shell, this.getShellArgs(), {
```

- [ ] **Step 3: env 타입 안전 처리**

기존:
```typescript
const env = {
  ...process.env,
  COLORTERM: 'truecolor',
  TERM_PROGRAM: 'vscode',
} as { [key: string]: string };
```

변경:
```typescript
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) env[key] = value;
}
env.COLORTERM = 'truecolor';
env.TERM_PROGRAM = 'vscode';
```

- [ ] **Step 4: 빌드 확인**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && npm run build`
Expected: 에러 없이 빌드 성공

---

## Chunk 2: terminal-manager.ts 및 extension.ts 개선

### Task 3: CommandConfig export 및 import 통합

**Files:**
- Modify: `src/terminal-manager.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: `terminal-manager.ts`의 `CommandConfig`에 export 추가**

기존:
```typescript
interface CommandConfig {
  name: string;
  icon?: string;
  command: string;
}
```

변경:
```typescript
export interface CommandConfig {
  name: string;
  icon?: string;
  command: string;
}
```

- [ ] **Step 2: `extension.ts`의 중복 `CommandConfig` 정의를 import로 교체**

기존:
```typescript
import { TerminalManager } from './terminal-manager';

interface CommandConfig {
  name: string;
  icon?: string;
  command: string;
}
```

변경:
```typescript
import { TerminalManager, CommandConfig } from './terminal-manager';
```

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && npm run build`
Expected: 에러 없이 빌드 성공

### Task 4: 이벤트 기반 그룹 잠금

**Files:**
- Modify: `src/terminal-manager.ts`

- [ ] **Step 1: 상수 추가**

파일 상단(MARKER 아래)에 추가:

```typescript
const GROUP_LOCK_TIMEOUT_MS = 1000;
```

- [ ] **Step 2: `runCommand()`의 그룹 잠금 로직 변경**

기존:
```typescript
// 그룹 잠금
await new Promise((resolve) => setTimeout(resolve, 300));
await vscode.commands.executeCommand(
  'workbench.action.lockEditorGroup'
);
```

변경:
```typescript
// 그룹 생성 이벤트 대기 (타임아웃 시에도 잠금 시도)
let groupChangeDisposable: vscode.Disposable;
await Promise.race([
  new Promise<void>((resolve) => {
    groupChangeDisposable = vscode.window.tabGroups.onDidChangeTabGroups(() => {
      groupChangeDisposable.dispose();
      resolve();
    });
  }),
  new Promise<void>((resolve) => setTimeout(resolve, GROUP_LOCK_TIMEOUT_MS)),
]);
groupChangeDisposable!.dispose();
await vscode.commands.executeCommand(
  'workbench.action.lockEditorGroup'
);
```

### Task 5: dispose()에서 관리 터미널 종료

**Files:**
- Modify: `src/terminal-manager.ts`

- [ ] **Step 1: `dispose()` 메서드에 터미널 종료 로직 추가**

기존:
```typescript
dispose(): void {
  this.managedTerminals.clear();
}
```

변경:
```typescript
dispose(): void {
  for (const terminal of this.managedTerminals) {
    terminal.dispose();
  }
  this.managedTerminals.clear();
}
```

- [ ] **Step 2: 빌드 확인**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && npm run build`
Expected: 에러 없이 빌드 성공

---

## Chunk 3: 최종 검증

### Task 6: 빌드 및 패키징

- [ ] **Step 1: 전체 빌드**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && npm run build`
Expected: 에러 없이 빌드 성공

- [ ] **Step 2: VSIX 패키징**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && npx @vscode/vsce package`
Expected: `terminal-tabs-0.0.1.vsix` 생성

### Task 7: 수동 검증 체크리스트

- [ ] VSCode에 확장 설치 후 Reload
- [ ] 터미널 열기 시 쉘 프롬프트/motd가 정상 출력되는지 확인 (버퍼링 제거 검증)
- [ ] 첫 터미널 생성 시 우측 그룹에 생성되고 잠금이 걸리는지 확인 (이벤트 기반 전환 검증)
- [ ] 두 번째 터미널 생성 시 같은 그룹에 추가되는지 확인
- [ ] 단축키로 기존 터미널 포커스 이동이 되는지 확인
- [ ] 아이콘이 정상 표시되는지 확인
