# Terminal Tabs 코드 정리 리팩토링 설계

## 배경

이전 리팩토링(버퍼링 제거, 타이밍 상수화, 플랫폼 분기 등)이 적용된 상태에서, 남아있는 중복 로직, 하드코딩 값, 에러 처리 누락을 정리한다.

## 변경 사항

### 1. `cleanupDeadTerminals()` 제거

**파일:** `terminal-manager.ts`

`onTerminalClosed()` 이벤트 핸들러가 이미 터미널 종료 시 `managedTerminals`에서 제거하고 있으므로, `runCommand()`와 `focusTerminalByName()`에서 매번 전체 터미널을 순회하며 정리하는 `cleanupDeadTerminals()`는 중복이다.

- `cleanupDeadTerminals()` 메서드 삭제
- `runCommand()`, `focusTerminalByName()`에서 호출부 삭제

### 2. onExit 딜레이 상수 추출

**파일:** `shell-pty.ts`

`onExit` 콜백의 `setTimeout` 딜레이가 `100`으로 하드코딩되어 있다. 파일 상단에 상수로 추출한다.

```typescript
const PTY_EXIT_DELAY_MS = 100;
```

### 3. 에러 경로 개선

**파일:** `shell-pty.ts`

`open()`의 catch 블록에서 에러 메시지를 터미널에만 출력하고 있어, 쉘 시작 실패 시 죽은 탭이 남고 원인 파악이 어렵다. 탭을 닫고 `showErrorMessage()`로 알림을 띄운다.

```typescript
} catch (e) {
  this.closeEmitter.fire();
  vscode.window.showErrorMessage(`Terminal Tabs: 쉘 시작 실패 - ${e}`);
}
```

## 영향 범위

| 파일 | 변경 내용 |
|------|-----------|
| `terminal-manager.ts` | `cleanupDeadTerminals()` 제거 |
| `shell-pty.ts` | onExit 딜레이 상수화, 에러 경로 개선(탭 닫기 + 알림) |
| `extension.ts` | 변경 없음 |
| `icon-resolver.ts` | 변경 없음 |

## 검증

- 터미널 닫기 후 새 터미널 생성 시 정상 동작하는지 확인 (cleanupDeadTerminals 제거 검증)
- 쉘 시작 실패 시 탭이 닫히고 에러 알림이 표시되는지 확인
- 기존 기능(QuickPick, 단축키 포커스 이동, 아이콘 표시)이 정상 동작하는지 확인
