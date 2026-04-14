# 프롬프트 히스토리 영속화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프롬프트 입력 내용을 매 키 입력마다 히스토리에 반영하고, workspaceState에 영속 저장하여 세션 간 히스토리 보존 및 편집 내용 유실 방지.

**Architecture:** Webview(`terminal.ts`)에서 히스토리 상태 관리 집중. 매 `input` 이벤트마다 `postMessage`로 Extension에 전송. Extension(`prompt-view.ts`)에서 debounce 500ms 후 `workspaceState`에 저장. Webview 로드 시 `ready` → `historyLoad` 핸드셰이크로 복원.

**Tech Stack:** TypeScript, VSCode Extension API (`workspaceState`), Webview `postMessage`

**Spec:** `docs/superpowers/specs/2026-04-14-history-persistence-design.md`

---

## 파일 구조

| 파일 | 역할 | 변경 유형 |
|------|------|----------|
| `src/prompt-view.ts` | `_view` 필드 추가, `ready`/`historySync` 메시지 처리, debounce 저장, `historyLoad` 전송 | 수정 |
| `src/webview/terminal.ts` | 히스토리 데이터 구조 변경, `input` 이벤트 추가, `syncHistory`, 메시지 수신 | 수정 |

---

### Task 1: Extension 측 히스토리 저장/로드 (`prompt-view.ts`)

**Files:**
- Modify: `src/prompt-view.ts`

**현재 코드 참조:** `prompt-view.ts`는 45줄. `PromptViewProvider` 클래스에 `_view` 필드 없음, `onDidReceiveMessage`에서 `prompt` 타입만 처리.

- [ ] **Step 1: `_view` 필드 및 debounce 타이머 추가**

`PromptViewProvider` 클래스에 필드 추가:

```typescript
export class PromptViewProvider implements vscode.WebviewViewProvider {
  private onPromptCallback: ((text: string) => void) | undefined;
  private htmlTemplate: string | undefined;
  private _view: vscode.WebviewView | undefined;
  private _saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private context: vscode.ExtensionContext) {}
```

- [ ] **Step 2: `resolveWebviewView`에서 `_view` 저장 및 메시지 핸들러 확장**

`resolveWebviewView` 메서드 수정. `_view` 저장, `ready`와 `historySync` 메시지 처리 추가:

```typescript
resolveWebviewView(webviewView: vscode.WebviewView): void {
  this._view = webviewView;

  webviewView.webview.options = {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
    ],
  };

  webviewView.webview.html = this.getHtml(webviewView.webview);

  webviewView.webview.onDidReceiveMessage((msg) => {
    switch (msg.type) {
      case 'prompt':
        if (this.onPromptCallback) {
          this.onPromptCallback(msg.text);
        }
        break;
      case 'ready':
        this.sendHistoryLoad();
        break;
      case 'historySync':
        this.debouncedSaveHistory(msg.history, msg.currentInput);
        break;
    }
  });
}
```

- [ ] **Step 3: `sendHistoryLoad` 메서드 추가**

`workspaceState`에서 히스토리와 currentInput 읽어서 Webview에 전송:

```typescript
private sendHistoryLoad(): void {
  if (!this._view) return;
  const history = this.context.workspaceState.get<Array<{ text: string; timestamp: number }>>(
    'terminalHistory',
    []
  );
  const currentInput = this.context.workspaceState.get<string>('terminalCurrentInput', '');
  this._view.webview.postMessage({ type: 'historyLoad', history, currentInput });
}
```

- [ ] **Step 4: `debouncedSaveHistory` 메서드 추가**

500ms debounce 후 `workspaceState` 저장. 100개 제한 적용:

```typescript
private debouncedSaveHistory(
  history: Array<{ text: string; timestamp: number }>,
  currentInput: string
): void {
  if (this._saveTimer) {
    clearTimeout(this._saveTimer);
  }
  this._saveTimer = setTimeout(() => {
    const trimmed = history.slice(-100);
    this.context.workspaceState.update('terminalHistory', trimmed);
    this.context.workspaceState.update('terminalCurrentInput', currentInput);
  }, 500);
}
```

- [ ] **Step 5: 빌드 확인**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && npx tsc --noEmit`
Expected: 에러 없음

---

### Task 2: Webview 히스토리 구조 변경 및 동기화 (`terminal.ts`)

**Files:**
- Modify: `src/webview/terminal.ts`

**현재 코드 참조:** `terminal.ts`는 62줄. `promptHistory: string[]`, `savedInput`, `keydown` 이벤트만 존재.

- [ ] **Step 1: 상태 변수 및 데이터 구조 변경**

기존 상태 변수를 새 구조로 교체. `savedInput` 제거, `currentInput` 추가:

```typescript
const vscode = acquireVsCodeApi();

const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn')!;

interface HistoryEntry {
  text: string;
  timestamp: number;
}

let promptHistory: HistoryEntry[] = [];
let historyIndex = -1;
let currentInput = '';
```

- [ ] **Step 2: `syncHistory` 함수 및 `ready` 메시지 추가**

`syncHistory` 함수 정의. 스크립트 끝에 `ready` 메시지 전송:

```typescript
function syncHistory() {
  vscode.postMessage({
    type: 'historySync',
    history: promptHistory,
    currentInput: currentInput,
  });
}
```

파일 맨 끝(이벤트 리스너 등록 후)에 `ready` 전송:

```typescript
vscode.postMessage({ type: 'ready' });
```

- [ ] **Step 3: `sendPrompt` 함수 수정**

`HistoryEntry` 구조 사용, 히스토리 수정 시 timestamp 갱신:

```typescript
function sendPrompt() {
  const text = promptInput.value.trim();
  if (!text) return;

  vscode.postMessage({ type: 'prompt', text: text + '\r' });

  if (historyIndex === -1) {
    promptHistory.push({ text, timestamp: Date.now() });
  } else {
    promptHistory[historyIndex].timestamp = Date.now();
  }

  historyIndex = -1;
  currentInput = '';
  promptInput.value = '';

  syncHistory();
}
```

- [ ] **Step 4: `keydown` 이벤트 핸들러 수정**

ArrowUp/Down 로직에서 `savedInput` 대신 `currentInput` 사용, `.text` 프로퍼티 접근:

```typescript
promptInput.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
    return;
  }
  if (e.key === 'ArrowUp' && isAtFirstLine()) {
    if (promptHistory.length === 0) return;
    e.preventDefault();
    if (historyIndex === -1) {
      historyIndex = promptHistory.length - 1;
    } else if (historyIndex > 0) {
      historyIndex--;
    }
    promptInput.value = promptHistory[historyIndex].text;
  }
  if (e.key === 'ArrowDown' && isAtLastLine()) {
    if (historyIndex === -1) return;
    e.preventDefault();
    if (historyIndex < promptHistory.length - 1) {
      historyIndex++;
      promptInput.value = promptHistory[historyIndex].text;
    } else {
      historyIndex = -1;
      promptInput.value = currentInput;
    }
  }
});
```

- [ ] **Step 5: `input` 이벤트 핸들러 추가**

매 입력마다 현재 편집 내용 히스토리에 반영 + `syncHistory` 호출:

```typescript
promptInput.addEventListener('input', () => {
  if (historyIndex === -1) {
    currentInput = promptInput.value;
  } else {
    promptHistory[historyIndex].text = promptInput.value;
  }
  syncHistory();
});
```

- [ ] **Step 6: `historyLoad` 메시지 수신 핸들러 추가**

Extension에서 전송하는 히스토리 데이터 수신 및 복원:

```typescript
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'historyLoad') {
    promptHistory = Array.isArray(msg.history) ? msg.history : [];
    currentInput = typeof msg.currentInput === 'string' ? msg.currentInput : '';
    promptInput.value = currentInput;
    historyIndex = -1;
  }
});
```

- [ ] **Step 7: 빌드 확인**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && npx tsc --noEmit`
Expected: 에러 없음

---

### Task 3: 빌드 및 수동 검증

**Files:**
- 없음 (검증만)

- [ ] **Step 1: 전체 빌드**

Run: `cd /Users/estsoft/project/other/vscode-extension-terminal && bash install.sh`
Expected: 빌드 성공, VSCode Reload Window

- [ ] **Step 2: 기본 동작 검증**

수동 테스트 항목:
1. 프롬프트 입력창에 텍스트 입력 → Enter 전송
2. ArrowUp → 이전 히스토리 표시 확인
3. ArrowDown → 다음 히스토리/currentInput 복원 확인

- [ ] **Step 3: 편집 보존 검증**

수동 테스트 항목:
1. 새 텍스트 입력 중 ArrowUp → ArrowDown → 입력 중이던 내용 복원 확인
2. 히스토리 항목 불러온 후 수정 → ArrowUp → ArrowDown → 수정 내용 보존 확인

- [ ] **Step 4: 영속성 검증**

수동 테스트 항목:
1. 명령어 여러 개 입력 후 VSCode Reload Window
2. 프롬프트 입력창에 이전 히스토리 ArrowUp으로 확인
3. 입력 중이던 내용 복원 확인 (Reload 전 입력 중이던 텍스트)

- [ ] **Step 5: 100개 제한 검증**

수동 테스트: 의미 있는 수준에서 다수 명령어 입력 후 히스토리 탐색 정상 동작 확인

- [ ] **Step 6: 커밋**

```bash
gh auth switch --user fhdufhdu
git add src/prompt-view.ts src/webview/terminal.ts
git commit --author="fhdufhdu <fhdufhdu@gmail.com>" -m "feat: 프롬프트 히스토리 영속화 및 편집 보존 구현"
gh auth switch --user chowooseong
```
