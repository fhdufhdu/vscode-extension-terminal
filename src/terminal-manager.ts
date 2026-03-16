import * as vscode from 'vscode';
import { resolveIcon } from './icon-resolver';

interface CommandConfig {
  name: string;
  icon?: string;
  command: string;
}

export class TerminalManager {
  private trackedGroupViewColumn: vscode.ViewColumn | null = null;
  private managedTerminals: Set<vscode.Terminal> = new Set();

  constructor(private context: vscode.ExtensionContext) {}

  async runCommand(config: CommandConfig): Promise<void> {
    const iconPath = resolveIcon(config.icon, this.context);
    const existingViewColumn = this.getTrackedViewColumn();

    if (existingViewColumn !== null) {
      // 이미 추적 중인 그룹이 있으면 해당 그룹에 터미널 추가
      const terminal = vscode.window.createTerminal({
        name: config.name,
        iconPath,
        location: {
          viewColumn: existingViewColumn,
          preserveFocus: false,
        },
      });
      terminal.show();
      terminal.sendText(config.command);
      this.managedTerminals.add(terminal);
    } else {
      // 첫 번째 터미널: 새 에디터 그룹을 생성하고 거기에 열기
      await vscode.commands.executeCommand('workbench.action.newGroupRight');

      const newViewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;

      const terminal = vscode.window.createTerminal({
        name: config.name,
        iconPath,
        location: {
          viewColumn: newViewColumn,
          preserveFocus: false,
        },
      });
      terminal.show();
      terminal.sendText(config.command);
      this.managedTerminals.add(terminal);

      // 그룹 잠금 및 추적
      await this.lockGroupAndTrack(terminal);
    }
  }

  private getTrackedViewColumn(): vscode.ViewColumn | null {
    if (this.trackedGroupViewColumn === null) {
      return null;
    }

    // 추적 중인 그룹이 아직 존재하는지 확인
    const groups = vscode.window.tabGroups.all;
    const exists = groups.some(
      (g) => g.viewColumn === this.trackedGroupViewColumn
    );

    if (!exists) {
      this.trackedGroupViewColumn = null;
      return null;
    }

    return this.trackedGroupViewColumn;
  }

  private async lockGroupAndTrack(_terminal: vscode.Terminal): Promise<void> {
    // 터미널이 에디터 영역에 열렸는지 확인하기 위해 약간의 지연
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 새 그룹을 직접 생성했으므로, 현재 활성 그룹을 잠금 및 추적
    const activeGroup = vscode.window.tabGroups.activeTabGroup;
    await vscode.commands.executeCommand(
      'workbench.action.lockEditorGroup'
    );
    this.trackedGroupViewColumn = activeGroup.viewColumn;
  }

  onTerminalClosed(terminal: vscode.Terminal): void {
    this.managedTerminals.delete(terminal);
  }

  dispose(): void {
    this.managedTerminals.clear();
    this.trackedGroupViewColumn = null;
  }
}
