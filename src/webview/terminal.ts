const vscode = acquireVsCodeApi();

const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn')!;

function sendPrompt() {
  const text = promptInput.value.trim();
  if (!text) return;
  vscode.postMessage({ type: 'prompt', text: text + '\r' });
  promptInput.value = '';
}

promptInput.addEventListener('keydown', (e) => {
  if (e.isComposing) return; // 한글 IME 조합 중이면 무시
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});

sendBtn.addEventListener('click', sendPrompt);
