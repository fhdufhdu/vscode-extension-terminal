import * as vscode from 'vscode';
import * as fs from 'fs';

export class PromptViewProvider implements vscode.WebviewViewProvider {
  private onPromptCallback: ((text: string) => void) | undefined;
  private htmlTemplate: string | undefined;

  constructor(private context: vscode.ExtensionContext) {}

  onPrompt(callback: (text: string) => void): void {
    this.onPromptCallback = callback;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'prompt' && this.onPromptCallback) {
        this.onPromptCallback(msg.text);
      }
    });
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
