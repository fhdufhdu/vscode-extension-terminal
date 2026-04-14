# 프롬프트 히스토리 영속화 및 편집 보존 설계

## 문제

1. 프롬프트 입력 중 실수로 ArrowUp/Down 히스토리 이동 시 작성 중이던 내용 소실
2. 히스토리 항목 수정 후 다른 항목으로 이동 시 수정 내용 소실
3. 세션 종료 시 히스토리 전체 소실 (메모리 기반)

## 해결 방향

- 매 키 입력마다 현재 편집 내용을 히스토리 배열에 즉시 반영
- Extension 측 debounce(500ms) 후 `workspaceState`에 영속 저장
- 히스토리 100개 제한, 오래된 항목 자동 제거

## 접근법

**Webview 단독 관리 방식** — 히스토리 상태 관리를 `terminal.ts`에 집중. Extension은 저장/로드만 담당.

---

## 데이터 구조

### HistoryEntry

```typescript
interface HistoryEntry {
  text: string;       // 명령어 내용
  timestamp: number;  // 저장 시점 (Unix ms)
}
```

### 상태 변수

```typescript
// 기존
const promptHistory: string[] = [];
let historyIndex = -1;
let savedInput = '';

// 변경
let promptHistory: HistoryEntry[] = [];
let historyIndex = -1;    // -1 = 신규 입력 모드
let currentInput = '';    // 신규 입력 중 내용 (index -1 영역)
```

- `savedInput` 제거 — 매 키 입력 저장으로 별도 백업 불필요
- `currentInput`이 `savedInput` 역할 대체

### 히스토리 수정 정책

- 히스토리 항목 수정 시 **원본 직접 변형** (in-place mutation)
- 수정 후 Enter → 수정된 내용으로 명령 실행, 원본 복원 안 함, 새 항목 추가 안 함
- 수정된 항목 timestamp 갱신: `promptHistory[historyIndex].timestamp = Date.now()`
- 의도: 히스토리는 "마지막 편집 상태" 유지가 목적, 동일 명령어 중복 방지

### 중복 제거

- 연속 동일 명령어 중복 허용 (제거하지 않음)
- 셸 히스토리와 달리 편집 컨텍스트 보존이 우선

### 저장소

- `workspaceState` 키: `"terminalHistory"` → `HistoryEntry[]` (최대 100개)
- `workspaceState` 키: `"terminalCurrentInput"` → `string`

---

## 동작 흐름

### 입력 감지 이벤트

- `input` 이벤트 사용 (`keydown` 대신) — paste, IME 입력, drag-and-drop 모두 감지
- `keydown`은 ArrowUp/Down/Enter 전용으로 유지

### 신규 입력 중 (historyIndex === -1)

1. `input` 이벤트 → `currentInput = promptInput.value`
2. `syncHistory()` 호출 → `postMessage({type: 'historySync', history, currentInput})`
3. Extension debounce 500ms 후 `workspaceState` 저장

### 히스토리 탐색 후 수정 중 (historyIndex >= 0)

1. 매 키 입력 → `promptHistory[historyIndex].text = promptInput.value`
2. `syncHistory()` 호출 → 동일 흐름

### ArrowUp/Down 이동

- 인덱스만 변경, 해당 항목 내용 표시
- 이전 편집 내용 이미 반영 완료 상태 → 유실 없음

### Enter 전송 (sendPrompt)

```typescript
function sendPrompt() {
  const text = promptInput.value.trim();
  if (!text) return;

  vscode.postMessage({ type: 'prompt', text: text + '\r' });

  if (historyIndex === -1) {
    promptHistory.push({ text, timestamp: Date.now() });
  } else {
    // 수정된 항목 timestamp 갱신 (새 항목 추가 안 함)
    promptHistory[historyIndex].timestamp = Date.now();
  }

  historyIndex = -1;
  currentInput = '';
  promptInput.value = '';

  syncHistory();
}
```

### syncHistory

```typescript
function syncHistory() {
  vscode.postMessage({
    type: 'historySync',
    history: promptHistory,
    currentInput: currentInput
  });
}
```

---

## Extension 측 처리

### 메시지 수신 (prompt-view.ts)

```typescript
case 'historySync':
  debouncedSaveHistory(msg.currentInput, msg.history);
  break;
```

### debounce 저장

- 간격: 500ms
- `workspaceState.update("terminalHistory", history.slice(-100))`
- `workspaceState.update("terminalCurrentInput", currentInput)`

### 히스토리 로드 (Webview ready 신호 기반)

Webview 스크립트 로드 완료 시 `ready` 메시지 전송 → Extension이 `historyLoad` 응답.
`postMessage` 유실 방지를 위해 Webview 먼저 준비 완료 신호.

```typescript
// Webview → Extension
vscode.postMessage({ type: 'ready' });

// Extension → Webview (ready 수신 후)
case 'ready':
  const history = context.workspaceState.get<HistoryEntry[]>("terminalHistory", []);
  const currentInput = context.workspaceState.get<string>("terminalCurrentInput", "");
  webviewView.webview.postMessage({ type: 'historyLoad', history, currentInput });
  break;
```

### PromptViewProvider 구조 변경

`_view: vscode.WebviewView | undefined` 필드 추가. `resolveWebviewView`에서 저장하여 메시지 전송 시 참조.

---

## Webview 히스토리 로드 수신

```typescript
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'historyLoad') {
    promptHistory = msg.history;
    currentInput = msg.currentInput;
    promptInput.value = currentInput;
    historyIndex = -1;
  }
});
```

---

## 에러 처리 및 엣지 케이스

| 케이스 | 처리 |
|--------|------|
| Webview 재로드 | Extension에서 `historyLoad` 재전송 |
| VSCode 재시작 | `workspaceState`에서 로드 |
| 빈 히스토리 ArrowUp | 무시 (기존 동작 유지) |
| 히스토리 수정 후 Enter | 수정 내용으로 명령 실행, 항목 이미 반영 상태 |
| 100개 초과 | Extension 저장 시 `slice(-100)` |
| `workspaceState` 저장 실패 | 무시, 메모리 히스토리 정상 동작 |
| `historyLoad` 데이터 손상 | 빈 배열 폴백 |

## 성능

- 매 키 입력 `postMessage` — 경량 JSON, 부담 없음
- Extension debounce 500ms — 빠른 타이핑 시 마지막 상태만 저장
- 100개 제한 → 최대 수 KB 전송

## 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/webview/terminal.ts` | 히스토리 데이터 구조 변경, 키 입력 이벤트 수정, syncHistory/메시지 수신 추가 |
| `src/prompt-view.ts` | `_view` 필드 추가, `ready`/`historySync` 메시지 처리, debounce 저장, `historyLoad` 전송 |
