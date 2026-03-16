import * as vscode from 'vscode';
import { resolveIcon } from './icon-resolver';
import { ShellPseudoterminal } from './shell-pty';

interface CommandConfig {
  name: string;
  icon?: string;
  command: string;
}

// 관리 중인 터미널 이름에 붙이는 보이지 않는 마커 (Zero-Width Space)
const MARKER = '\u200B\u200B\u200B';

export class TerminalManager {
  private managedTerminals: Set<vscode.Terminal> = new Set();

  constructor(private context: vscode.ExtensionContext) {}

  async runCommand(config: CommandConfig): Promise<void> {
    const iconPath = resolveIcon(config.icon, this.context);

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

      // 그룹 잠금
      await new Promise((resolve) => setTimeout(resolve, 300));
      await vscode.commands.executeCommand(
        'workbench.action.lockEditorGroup'
      );
    }
  }

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

  /**
   * 이름이 일치하는 관리 중인 터미널이 있으면 포커스 이동.
   * 없으면 false 반환.
   */
  focusTerminalByName(name: string): boolean {
    this.cleanupDeadTerminals();

    const markedName = name + MARKER;
    for (const terminal of this.managedTerminals) {
      if (terminal.name === markedName) {
        terminal.show();
        return true;
      }
    }
    return false;
  }

  private cleanupDeadTerminals(): void {
    const allTerminals = vscode.window.terminals;
    for (const managed of this.managedTerminals) {
      if (!allTerminals.includes(managed)) {
        this.managedTerminals.delete(managed);
      }
    }
  }

  onTerminalClosed(terminal: vscode.Terminal): void {
    this.managedTerminals.delete(terminal);
  }

  dispose(): void {
    this.managedTerminals.clear();
  }
}
