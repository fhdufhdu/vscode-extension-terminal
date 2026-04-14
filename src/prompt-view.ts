import * as vscode from 'vscode';
import * as fs from 'fs';

export class PromptViewProvider implements vscode.WebviewViewProvider {
  private onPromptCallback: ((text: string) => void) | undefined;
  private htmlTemplate: string | undefined;
  private _view: vscode.WebviewView | undefined;
  private _saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private context: vscode.ExtensionContext) {}

  onPrompt(callback: (text: string) => void): void {
    this.onPromptCallback = callback;
  }

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

  private sendHistoryLoad(): void {
    if (!this._view) return;
    const history = this.context.workspaceState.get<Array<{ text: string; timestamp: number }>>(
      'terminalHistory',
      []
    );
    const currentInput = this.context.workspaceState.get<string>('terminalCurrentInput', '');
    this._view.webview.postMessage({ type: 'historyLoad', history, currentInput });
  }

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

  private getHtml(webview: vscode.Webview): string {
    if (!this.htmlTemplate) {
      const htmlPath = this.context.asAbsolutePath('dist/terminal.html');
      this.htmlTemplate = fs.readFileSync(htmlPath, 'utf-8');
    }

    const webviewJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );

    return this.htmlTemplate
      .replace(/\{\{webviewJs\}\}/g, webviewJsUri.toString())
      .replace(/\{\{cspSource\}\}/g, webview.cspSource);
  }
}
