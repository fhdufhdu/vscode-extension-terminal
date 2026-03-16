import * as vscode from 'vscode';
import { TerminalManager } from './terminal-manager';

interface CommandConfig {
  name: string;
  icon?: string;
  command: string;
}

let terminalManager: TerminalManager;

export function activate(context: vscode.ExtensionContext) {
  terminalManager = new TerminalManager(context);

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

      if (!selected) {
        return;
      }

      const selectedIndex = items.indexOf(selected);
      const selectedCommand = commands[selectedIndex];

      await terminalManager.runCommand(selectedCommand);
    }
  );

  const runByName = vscode.commands.registerCommand(
    'terminalTabs.runCommandByName',
    async (args?: { name?: string }) => {
      if (!args?.name) {
        vscode.window.showErrorMessage(
          'Terminal Tabs: "name" 인자가 필요합니다.'
        );
        return;
      }

      const config = vscode.workspace.getConfiguration('terminalTabs');
      const commands: CommandConfig[] = config.get('commands', []);
      const found = commands.find((cmd) => cmd.name === args.name);

      if (!found) {
        vscode.window.showErrorMessage(
          `Terminal Tabs: "${args.name}" 명령어를 찾을 수 없습니다.`
        );
        return;
      }

      await terminalManager.runCommand(found);
    }
  );

  const terminalCloseListener = vscode.window.onDidCloseTerminal(
    (terminal) => {
      terminalManager.onTerminalClosed(terminal);
    }
  );

  context.subscriptions.push(disposable, runByName, terminalCloseListener);
}

export function deactivate() {
  terminalManager?.dispose();
}
