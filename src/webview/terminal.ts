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

function isAtFirstLine(): boolean {
  const firstNewline = promptInput.value.indexOf('\n');
  return promptInput.selectionStart <= (firstNewline === -1 ? promptInput.value.length : firstNewline);
}

function isAtLastLine(): boolean {
  const lastNewline = promptInput.value.lastIndexOf('\n');
  return promptInput.selectionEnd > lastNewline;
}

function syncHistory() {
  vscode.postMessage({
    type: 'historySync',
    history: promptHistory,
    currentInput: currentInput,
  });
}

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

promptInput.addEventListener('input', () => {
  if (historyIndex === -1) {
    currentInput = promptInput.value;
  } else {
    promptHistory[historyIndex].text = promptInput.value;
  }
  syncHistory();
});

sendBtn.addEventListener('click', sendPrompt);

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'historyLoad') {
    promptHistory = Array.isArray(msg.history) ? msg.history : [];
    currentInput = typeof msg.currentInput === 'string' ? msg.currentInput : '';
    promptInput.value = currentInput;
    historyIndex = -1;
  }
});

vscode.postMessage({ type: 'ready' });
