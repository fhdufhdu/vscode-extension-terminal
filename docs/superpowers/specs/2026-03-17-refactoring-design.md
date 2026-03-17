# Terminal Tabs 리팩토링 설계

## 배경

현재 프로젝트는 4개의 소스 파일로 구성되어 있으며 기능적으로 잘 동작하지만, 타입 중복, 하드코딩된 타이밍 값, 플랫폼 호환성, 리소스 정리 등에서 개선이 필요하다.

## 접근법

기존 파일 구조(4개)를 유지하면서 각 파일 내부만 점진적으로 개선한다. `icon-resolver.ts`는 변경 불필요.

## 변경 사항

### 1. CommandConfig 중복 제거

- `terminal-manager.ts`의 `CommandConfig`를 export
- `extension.ts`에서 import하여 사용
- `terminal-manager.ts`가 실제 사용처이므로 소유권을 여기에 둠

### 2. shell-pty.ts 개선

#### 2-1. 버퍼링 제거

`dataBuffer`, `ready` 필드를 제거한다. `pty.onData()`에서 바로 `writeEmitter.fire()`를 호출한다. 명령어 전달만 500ms 지연을 유지한다.

VSCode Pseudoterminal API 스펙상, `open()`은 VSCode가 `onDidWrite` 구독을 완료한 후에 호출된다. 따라서 `open()` 내에서 `writeEmitter.fire()`를 호출하면 확실히 수신되므로 버퍼링이 불필요하다.

```
open() → pty.spawn()
       → onData: 바로 writeEmitter.fire()
       → 500ms 후: ptyProcess.write(command + EOL)
```

#### 2-2. 타이밍 상수 추출 및 onExit 딜레이 변경

하드코딩된 타이밍 값을 상수로 추출하고, onExit 딜레이를 100ms에서 500ms로 변경한다. 에러 경로의 `setTimeout`도 동일한 상수를 사용한다.

```typescript
const PTY_COMMAND_DELAY_MS = 500;
const PTY_EXIT_DELAY_MS = 500;
```

#### 2-3. 개행 문자 OS별 분기

Windows(`cmd.exe`/`PowerShell`)는 `\r\n`, Unix 쉘은 `\n`을 사용한다.

```typescript
private getEOL(): string {
  return os.platform() === 'win32' ? '\r\n' : '\n';
}
```

#### 2-4. --login 플랫폼별 분기

Windows에서는 `--login` 인자를 사용하지 않는다.

```typescript
private getShellArgs(): string[] {
  if (os.platform() === 'win32') return [];
  return ['--login'];
}
```

#### 2-5. env 타입 안전 처리

`as` 캐스팅 대신 `undefined` 값을 필터링한다.

```typescript
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) env[key] = value;
}
env.COLORTERM = 'truecolor';
env.TERM_PROGRAM = 'vscode';
```

### 3. terminal-manager.ts 개선

#### 3-1. 그룹 잠금 이벤트 기반 전환

300ms 하드코딩 대기를 `onDidChangeTabGroups` 이벤트 기반으로 변경한다. 예외 상황 대비 1초 타임아웃을 둔다. 타임아웃이 발생해도 잠금을 시도한다.

```typescript
const GROUP_LOCK_TIMEOUT_MS = 1000;

// 새 그룹 생성 후 이벤트 대기
await Promise.race([
  new Promise<void>((resolve) => {
    const disposable = vscode.window.tabGroups.onDidChangeTabGroups(() => {
      disposable.dispose();
      resolve();
    });
  }),
  new Promise<void>((resolve) => setTimeout(resolve, GROUP_LOCK_TIMEOUT_MS)),
]);
// 타임아웃 여부와 관계없이 잠금 시도
await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
```

#### 3-2. dispose()에서 관리 터미널 종료

확장 비활성화 시 관리 중인 터미널을 모두 종료하여 고아 프로세스를 방지한다.

```typescript
dispose(): void {
  for (const terminal of this.managedTerminals) {
    terminal.dispose();
  }
  this.managedTerminals.clear();
}
```

### 4. extension.ts 개선

#### 4-1. CommandConfig import

`CommandConfig` 인터페이스 정의를 제거하고 `terminal-manager.ts`에서 import한다.

#### 4-2. commandsToSkipShell 런타임 방식 유지

`configurationDefaults`는 사용자의 기존 설정을 덮어쓰므로, 현재의 런타임 append 방식을 유지한다. 코드 변경 없음.

## 영향 범위

| 파일 | 변경 내용 |
|------|-----------|
| `terminal-manager.ts` | CommandConfig export, 이벤트 기반 그룹 잠금, dispose 개선 |
| `shell-pty.ts` | 버퍼링 제거, 타이밍 상수화, 플랫폼 분기, env 안전 처리 |
| `extension.ts` | CommandConfig import (중복 정의 제거) |
| `icon-resolver.ts` | 변경 없음 |
| `package.json` | 변경 없음 |

## 검증

- 터미널 열기 시 쉘 프롬프트/motd가 정상 출력되는지 확인 (버퍼링 제거 검증)
- 첫 터미널 생성 시 그룹 잠금이 정상 동작하는지 확인 (이벤트 기반 전환 검증)
- 확장 비활성화 시 관리 터미널이 종료되는지 확인 (dispose 검증)
- 기존 기능(QuickPick, 단축키 포커스 이동, 아이콘 표시)이 정상 동작하는지 확인
