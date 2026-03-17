# 터미널 모드 선택 및 세션 유지 설계

## 배경

현재 Pseudoterminal(node-pty) 방식은 탭 닫기가 깔끔하지만 VSCode 재시작 시 탭이 사라진다. 일반 터미널(sendText) 방식은 재시작 시 탭이 유지되지만 닫을 때 확인 대화상자가 뜬다. 사용자가 선호에 따라 선택할 수 있도록 한다.

## 설정

### terminalTabs.terminalMode

```json
"terminalTabs.terminalMode": {
  "type": "string",
  "enum": ["standard", "pseudoterminal"],
  "default": "standard",
  "markdownDescription": "터미널 생성 방식.\n- `standard`: 일반 터미널. VSCode 재시작 시 탭이 유지됩니다. 탭을 닫을 때 확인 대화상자가 표시됩니다.\n- `pseudoterminal`: Pseudoterminal(node-pty). 탭을 닫을 때 확인 없이 즉시 종료됩니다. VSCode 재시작 시 탭이 사라집니다."
}
```

## 변경 사항

### 1. 그룹 추적 방식 변경: findManagedGroup() → cachedViewColumn

`findManagedGroup()`(전체 탭 스캔)을 제거하고, `cachedViewColumn`으로 그룹 위치를 추적한다. 마지막 터미널이 닫힐 때 마커 탭이 이미 제거되어 스캔으로 그룹을 찾을 수 없는 문제를 해결한다.

```
cachedViewColumn: number | null = null

터미널 생성:
  cachedViewColumn === null → 새 그룹 생성 → cachedViewColumn에 viewColumn 저장
  cachedViewColumn !== null → 해당 viewColumn에 터미널 추가

터미널 닫힘:
  managedTerminals에서 제거
  Set 비었으면 → cachedViewColumn으로 그룹 정리 → cachedViewColumn = null
```

### 2. runCommand() 모드 분기

설정값에 따라 터미널 생성 방식을 분기한다. 그룹 생성/추적 로직은 모드에 관계없이 동일하게 `cachedViewColumn`을 사용한다. `commandDelayMs`는 `TerminalManager`에서 설정을 읽어 적용한다.

**standard 모드:**
```typescript
const terminal = vscode.window.createTerminal({
  name: config.name + MARKER,
  iconPath,
  location: { viewColumn: this.cachedViewColumn, preserveFocus: false },
});
terminal.show();

setTimeout(() => {
  if (config.command.trim()) {
    terminal.sendText(config.command);
  }
}, commandDelayMs);
```

**pseudoterminal 모드:**
기존 방식 유지. `ShellPseudoterminal`을 사용한다.

### 3. 그룹 정리 (모드 무관)

`onTerminalClosed()`에서 `managedTerminals`가 비었을 때, 모드에 관계없이 관리 그룹을 정리한다.

```
터미널 닫힘 → onTerminalClosed()
  → managedTerminals에서 제거
  → Set이 비었으면:
    → cachedViewColumn으로 해당 그룹 포커스 이동
    → 그룹 잠금 해제 (unlockEditorGroup)
    → 빈 그룹 닫기 (closeEditorsInGroup)
    → cachedViewColumn = null
```

### 4. standard 모드 세션 복원 (onDidOpenTerminal)

VSCode 재시작 후 standard 모드의 터미널 탭은 유지되지만, `managedTerminals` Set과 `cachedViewColumn`은 초기 상태이다. `onDidOpenTerminal` 이벤트로 기존 마커 터미널을 다시 등록한다.

```typescript
// activate()에서 리스너 등록
vscode.window.onDidOpenTerminal((terminal) => {
  if (terminal.name.includes(MARKER) && !this.managedTerminals.has(terminal)) {
    this.managedTerminals.add(terminal);
    // cachedViewColumn 복원은 터미널이 속한 그룹의 viewColumn을 탭 스캔으로 1회 찾아 설정
  }
});
```

`onDidOpenTerminal`은 VSCode가 터미널을 비동기로 복원할 때도 발생하므로, `activate()` 시점에 `vscode.window.terminals`를 직접 순회할 필요가 없다.

cachedViewColumn 복원 시에만 1회 탭 스캔이 필요하다. 이후에는 캐시된 값을 사용한다.

## 영향 범위

| 파일 | 변경 내용 |
|------|-----------|
| `terminal-manager.ts` | findManagedGroup 제거, cachedViewColumn 추가, runCommand 모드 분기, 그룹 정리 로직, onDidOpenTerminal 복원 |
| `extension.ts` | activate에서 onDidOpenTerminal 리스너 등록 |
| `package.json` | terminalTabs.terminalMode 설정 추가 |
| `shell-pty.ts` | 변경 없음 (pseudoterminal 모드에서만 사용) |

## 검증

- standard 모드: 터미널 생성 → VSCode 재시작 → 탭 유지 확인 → 단축키 포커스 이동 확인
- standard 모드: 모든 터미널 닫기 → 빈 그룹이 자동 정리되는지 확인
- pseudoterminal 모드: 터미널 생성 → 모든 탭 닫기 → 빈 그룹이 자동 정리되는지 확인
- 모드 전환: 설정 변경 후 새 터미널이 변경된 모드로 생성되는지 확인
- 재시작 후 단축키 포커스 이동이 정상 동작하는지 확인
