# Pseudoterminal 전환 Design Spec

## Overview

기존 `createTerminal` + `sendText` 방식을 `ExtensionTerminalOptions` + `Pseudoterminal` + `node-pty` 방식으로 전환한다.
이를 통해 터미널 닫을 때 확인 대화상자 없이 즉시 종료되며, 쉘 프로세스를 확장이 직접 관리한다.

## 요구사항

1. `node-pty`로 실제 PTY를 할당하여 쉘(bash/zsh) spawn
2. 명령어를 쉘 stdin으로 전달 (사용자 추가 입력 가능)
3. 탭 닫을 때 SIGTERM으로 즉시 종료 (확인 대화상자 없음)
4. 색상, 커서, 전체화면 프로그램 정상 지원
5. 터미널 리사이즈 지원

## 변경 파일

### 새 파일: `src/shell-pty.ts`

`vscode.Pseudoterminal`을 구현하는 클래스.

```typescript
class ShellPseudoterminal implements vscode.Pseudoterminal {
  private ptyProcess: pty.IPty | undefined;
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<void>();

  onDidWrite = this.writeEmitter.event;
  onDidClose = this.closeEmitter.event;

  constructor(private command: string) {}

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    // 사용자 기본 쉘 감지 (SHELL 환경변수 또는 fallback)
    // node-pty로 쉘 spawn (cols, rows 전달)
    // pty.onData → writeEmitter.fire()
    // pty.onExit → closeEmitter.fire()
    // 명령어를 pty.write()로 전달
  }

  handleInput(data: string): void {
    // pty.write(data)로 stdin 전달
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    // pty.resize(cols, rows)
  }

  close(): void {
    // pty.kill('SIGTERM')으로 즉시 종료
    // 리소스 정리
  }
}
```

### 수정: `src/terminal-manager.ts`

`createTerminal` 호출을 `ExtensionTerminalOptions`으로 변경.

```typescript
// 기존
const terminal = vscode.window.createTerminal({
  name, iconPath, location,
});
terminal.sendText(command);

// 변경
const pty = new ShellPseudoterminal(config.command);
const terminal = vscode.window.createTerminal({
  name: config.name + MARKER,
  iconPath,
  location,
  pty,
});
```

### 수정: `package.json`

- `dependencies`에 `node-pty` 추가
- `node-pty`는 네이티브 모듈이므로 플랫폼별 빌드 필요

### 수정: `esbuild.js`

- `external`에 `node-pty` 추가 (번들에 포함하지 않음)

## 동작 흐름

1. 사용자가 명령어 선택
2. `ShellPseudoterminal` 생성 (명령어 저장)
3. `createTerminal({ pty })` 호출
4. VSCode가 `open()` 호출
5. `node-pty`로 쉘 spawn + 명령어를 stdin으로 전달
6. pty 출력 → `onDidWrite` → VSCode 터미널에 표시
7. 사용자 입력 → `handleInput()` → pty stdin
8. 탭 닫기 → `close()` → SIGTERM 즉시 전송

## 쉘 감지

```
process.env.SHELL || '/bin/bash'  (macOS/Linux)
process.env.COMSPEC || 'cmd.exe'  (Windows)
```

## 엣지 케이스

### PTY spawn 실패
- 쉘 경로를 찾을 수 없는 경우 → `writeEmitter`로 에러 메시지 출력 후 `closeEmitter.fire()`

### 명령어 전달 타이밍
- `open()`에서 쉘 spawn 직후 `pty.write(command + '\n')` 호출
- 쉘 초기화 대기 없이 바로 전달 (node-pty가 내부적으로 버퍼링)

### 빈 명령어
- `command`가 빈 문자열이면 쉘만 열고 명령어 전달 안 함

### initialDimensions가 undefined
- 기본값 80x24 사용

### 프로세스 종료 실패
- `close()`에서 SIGTERM 후 `pty.onExit` 콜백에서 `closeEmitter.fire()` 호출
- 프로세스가 이미 종료된 경우 `kill()` 에러 무시

## node-pty 관련 고려사항

- 네이티브 모듈이므로 `esbuild.js`에서 `external: ['vscode', 'node-pty']`로 설정
- `.vscodeignore`에서 `node_modules/**` 대신 `!node_modules/node-pty/**`로 node-pty만 포함
- install.sh에서 `npm install` 시 네이티브 빌드 수행
