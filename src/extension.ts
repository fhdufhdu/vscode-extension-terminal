import * as vscode from 'vscode';
import { TerminalManager, CommandConfig } from './terminal-manager';
import { PromptViewProvider } from './prompt-view';

let terminalManager: TerminalManager;

export function activate(context: vscode.ExtensionContext) {
  terminalManager = new TerminalManager(context);
  terminalManager.cleanupEmptyGroups().catch(() => {});

  const promptProvider = new PromptViewProvider(context);
  promptProvider.onPrompt((text) => {
    terminalManager.sendToLastActiveTerminal(text);
  });

  const disposable = vscode.commands.registerCommand(
    'terminalTabs.runCommand',
    async () => {
      const config = vscode.workspace.getConfiguration('terminalTabs');
      const commands: CommandConfig[] = config.get('commands', []);

      if (commands.length === 0) {
        const action = await vscode.window.showInformationMessage(
          'Terminal Tabs: 설정된 명령어가 없습니다.',
          '설정 열기'
        );
        if (action === '설정 열기') {
          await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'terminalTabs.commands'
          );
        }
        return;
      }

      const items: vscode.QuickPickItem[] = commands.map((cmd) => ({
        label: cmd.name,
        description: cmd.command,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '실행할 명령어를 선택하세요',
      });

      if (!selected) return;

      const selectedIndex = items.indexOf(selected);
      await terminalManager.runCommand(commands[selectedIndex]);
    }
  );

  const runByName = vscode.commands.registerCommand(
    'terminalTabs.runCommandByName',
    async (args?: { name?: string }) => {
      if (!args?.name) {
        vscode.window.showErrorMessage('Terminal Tabs: "name" 인자가 필요합니다.');
        return;
      }

      const config = vscode.workspace.getConfiguration('terminalTabs');
      const commands: CommandConfig[] = config.get('commands', []);
      const found = commands.find((cmd) => cmd.name === args.name);

      if (!found) {
        vscode.window.showErrorMessage(`Terminal Tabs: "${args.name}" 명령어를 찾을 수 없습니다.`);
        return;
      }

      if (!terminalManager.focusTerminalByName(found.name)) {
        await terminalManager.runCommand(found);
      }
    }
  );

  const terminalCloseListener = vscode.window.onDidCloseTerminal((terminal) => {
    terminalManager.onTerminalClosed(terminal);
  });

  const terminalActiveListener = vscode.window.onDidChangeActiveTerminal((terminal) => {
    if (terminal) {
      terminalManager.trackActiveTerminal(terminal);
    }
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('terminalTabs.promptView', promptProvider),
    disposable,
    runByName,
    terminalCloseListener,
    terminalActiveListener
  );
}

export function deactivate() {
  terminalManager?.dispose();
}
