# 터미널 모드 선택 및 세션 유지 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** standard(sendText) / pseudoterminal(node-pty) 모드를 설정으로 선택하고, 그룹 추적을 cachedViewColumn 기반으로 전환한다.

**Architecture:** `findManagedGroup()` 탭 스캔을 제거하고 `cachedViewColumn`으로 그룹 위치를 캐싱한다. `runCommand()`에서 모드별 분기하여 터미널을 생성하고, `onTerminalClosed()`에서 모든 터미널이 닫히면 그룹을 정리한다. standard 모드에서는 `onDidOpenTerminal`로 재시작 후 마커 터미널을 복원한다.

**Tech Stack:** TypeScript, VSCode Extension API, node-pty

**Spec:** `docs/superpowers/specs/2026-03-17-terminal-mode-design.md`

---

## Chunk 1: 그룹 추적 방식 전환 및 그룹 정리

### Task 1: findManagedGroup() → cachedViewColumn 전환

**Files:**
- Modify: `src/terminal-manager.ts`

- [ ] **Step 1: cachedViewColumn 필드 추가**

`managedTerminals` 아래에 추가:

```typescript
private cachedViewColumn: number | null = null;
```

- [ ] **Step 2: runCommand()에서 findManagedGroup() 대신 cachedViewColumn 사용**

기존:
```typescript
    // 죽은 터미널 정리
    this.cleanupDeadTerminals();

    const existingGroup = this.findManagedGroup();

    if (existingGroup) {
      // 이미 관리 중인 그룹이 있으면 해당 그룹에 터미널 추가
      const ptyInstance = new ShellPseudoterminal(config.command);
      const terminal = vscode.window.createTerminal({
        name: config.name + MARKER,
        iconPath,
        location: {
          viewColumn: existingGroup.viewColumn,
          preserveFocus: false,
        },
        pty: ptyInstance,
      });
      terminal.show();
      this.managedTerminals.add(terminal);

    } else {
      // 첫 번째 터미널: 새 에디터 그룹 생성
      await vscode.commands.executeCommand('workbench.action.newGroupRight');

      const newViewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;

      const ptyInstance = new ShellPseudoterminal(config.command);
      const terminal = vscode.window.createTerminal({
        name: config.name + MARKER,
        iconPath,
        location: { viewColumn: newViewColumn, preserveFocus: false },
        pty: ptyInstance,
      });
      terminal.show();
      this.managedTerminals.add(terminal);


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
    }
```

변경:
```typescript
    // 죽은 터미널 정리
    this.cleanupDeadTerminals();

    if (this.cachedViewColumn === null) {
      // 첫 번째 터미널: 새 에디터 그룹 생성
      await vscode.commands.executeCommand('workbench.action.newGroupRight');
      this.cachedViewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
    }

    const ptyInstance = new ShellPseudoterminal(config.command);
    const terminal = vscode.window.createTerminal({
      name: config.name + MARKER,
      iconPath,
      location: {
        viewColumn: this.cachedViewColumn,
        preserveFocus: false,
      },
      pty: ptyInstance,
    });
    terminal.show();
    this.managedTerminals.add(terminal);

    if (this.managedTerminals.size === 1) {
      // 첫 터미널 생성 시 그룹 잠금
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
    }
```

- [ ] **Step 3: findManagedGroup() 메서드 제거**

아래 메서드 전체를 삭제한다:

```typescript
  /**
   * 마커가 포함된 탭 이름을 가진 탭이 있는 에디터 그룹을 찾는다.
   * 탭 내용 기반 탐색이므로 그룹 이동/재배치에 영향받지 않음.
   */
  private findManagedGroup(): vscode.TabGroup | null {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.label.includes(MARKER)) {
          return group;
        }
      }
    }
    return null;
  }
```

### Task 2: 그룹 정리 로직 추가

**Files:**
- Modify: `src/terminal-manager.ts`

- [ ] **Step 1: onTerminalClosed()에 그룹 정리 로직 추가**

기존:
```typescript
  onTerminalClosed(terminal: vscode.Terminal): void {
    this.managedTerminals.delete(terminal);
  }
```

변경:
```typescript
  async onTerminalClosed(terminal: vscode.Terminal): Promise<void> {
    this.managedTerminals.delete(terminal);

    if (this.managedTerminals.size === 0 && this.cachedViewColumn !== null) {
      await this.cleanupGroup();
    }
  }

  private async cleanupGroup(): Promise<void> {
    if (this.cachedViewColumn === null) return;

    try {
      // 해당 그룹으로 포커스 이동
      for (const group of vscode.window.tabGroups.all) {
        if (group.viewColumn === this.cachedViewColumn) {
          // 그룹의 탭을 활성화하여 포커스 이동
          if (group.activeTab) {
            await vscode.window.tabGroups.close(group.tabs);
          }
          break;
        }
      }
      await vscode.commands.executeCommand('workbench.action.unlockEditorGroup');
      await vscode.commands.executeCommand('workbench.action.closeEditorsInGroup');
    } catch {
      // 그룹이 이미 정리된 경우 무시
    }

    this.cachedViewColumn = null;
  }
```

- [ ] **Step 2: dispose()에서 cachedViewColumn 초기화**

기존:
```typescript
  dispose(): void {
    for (const terminal of this.managedTerminals) {
      terminal.dispose();
    }
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
    this.cachedViewColumn = null;
  }
```

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && npm run build`
Expected: 에러 없이 빌드 성공

---

## Chunk 2: 터미널 모드 분기

### Task 3: package.json에 terminalMode 설정 추가

**Files:**
- Modify: `package.json`

- [ ] **Step 1: terminalTabs.terminalMode 설정 추가**

`terminalTabs.commandDelayMs` 아래에 추가:

```json
        "terminalTabs.terminalMode": {
          "type": "string",
          "enum": ["standard", "pseudoterminal"],
          "default": "standard",
          "markdownDescription": "터미널 생성 방식.\n- `standard`: 일반 터미널. VSCode 재시작 시 탭이 유지됩니다. 탭을 닫을 때 확인 대화상자가 표시됩니다.\n- `pseudoterminal`: Pseudoterminal(node-pty). 탭을 닫을 때 확인 없이 즉시 종료됩니다. VSCode 재시작 시 탭이 사라집니다."
        }
```

### Task 4: runCommand()에 모드 분기 적용

**Files:**
- Modify: `src/terminal-manager.ts`

- [ ] **Step 1: runCommand()의 터미널 생성 부분을 모드별 분기로 변경**

Task 1에서 변경한 runCommand()의 터미널 생성 부분을 분기 처리한다.

기존 (Task 1 결과):
```typescript
    const ptyInstance = new ShellPseudoterminal(config.command);
    const terminal = vscode.window.createTerminal({
      name: config.name + MARKER,
      iconPath,
      location: {
        viewColumn: this.cachedViewColumn,
        preserveFocus: false,
      },
      pty: ptyInstance,
    });
    terminal.show();
    this.managedTerminals.add(terminal);
```

변경:
```typescript
    const terminalMode = vscode.workspace.getConfiguration('terminalTabs')
      .get<string>('terminalMode', 'standard');
    const commandDelayMs = vscode.workspace.getConfiguration('terminalTabs')
      .get<number>('commandDelayMs', 0);

    let terminal: vscode.Terminal;

    if (terminalMode === 'pseudoterminal') {
      const ptyInstance = new ShellPseudoterminal(config.command);
      terminal = vscode.window.createTerminal({
        name: config.name + MARKER,
        iconPath,
        location: {
          viewColumn: this.cachedViewColumn,
          preserveFocus: false,
        },
        pty: ptyInstance,
      });
    } else {
      terminal = vscode.window.createTerminal({
        name: config.name + MARKER,
        iconPath,
        location: {
          viewColumn: this.cachedViewColumn,
          preserveFocus: false,
        },
      });
    }

    terminal.show();
    this.managedTerminals.add(terminal);

    // standard 모드: sendText로 명령어 전달
    if (terminalMode !== 'pseudoterminal') {
      setTimeout(() => {
        if (config.command.trim()) {
          terminal.sendText(config.command);
        }
      }, commandDelayMs);
    }
```

- [ ] **Step 2: 빌드 확인**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && npm run build`
Expected: 에러 없이 빌드 성공

---

## Chunk 3: standard 모드 세션 복원

### Task 5: onDidOpenTerminal로 마커 터미널 복원

**Files:**
- Modify: `src/terminal-manager.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: terminal-manager.ts에 recoverTerminal 메서드 추가**

`onTerminalClosed()` 위에 추가:

```typescript
  recoverTerminal(terminal: vscode.Terminal): void {
    if (!terminal.name.includes(MARKER)) return;
    if (this.managedTerminals.has(terminal)) return;

    this.managedTerminals.add(terminal);

    // cachedViewColumn 복원: 마커 터미널이 속한 그룹의 viewColumn을 찾아 설정
    if (this.cachedViewColumn === null) {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.label.includes(MARKER)) {
            this.cachedViewColumn = group.viewColumn;
            return;
          }
        }
      }
    }
  }
```

- [ ] **Step 2: extension.ts에 onDidOpenTerminal 리스너 추가**

기존:
```typescript
  context.subscriptions.push(disposable, runByName, terminalCloseListener);
```

변경:
```typescript
  const terminalOpenListener = vscode.window.onDidOpenTerminal(
    (terminal) => {
      terminalManager.recoverTerminal(terminal);
    }
  );

  context.subscriptions.push(disposable, runByName, terminalCloseListener, terminalOpenListener);
```

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && npm run build`
Expected: 에러 없이 빌드 성공

---

## Chunk 4: 최종 검증

### Task 6: 빌드 및 패키징

- [ ] **Step 1: 전체 빌드**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && npm run build`
Expected: 에러 없이 빌드 성공

- [ ] **Step 2: 설치**

Run: `bash install.sh`
Expected: 확장 설치 성공

### Task 7: 수동 검증 체크리스트

- [ ] standard 모드: 터미널 생성 → 에디터 탭에 표시, 명령어 실행 확인
- [ ] standard 모드: VSCode 재시작 → 탭 유지 확인
- [ ] standard 모드: 재시작 후 단축키(ctrl+shift+1~4) 포커스 이동 확인
- [ ] standard 모드: 모든 터미널 닫기 → 빈 그룹 자동 정리 확인
- [ ] pseudoterminal 모드로 전환: 터미널 생성 → 확인 없이 즉시 닫기
- [ ] pseudoterminal 모드: 모든 탭 닫기 → 빈 그룹 자동 정리 확인
- [ ] 아이콘이 두 모드 모두 정상 표시되는지 확인
