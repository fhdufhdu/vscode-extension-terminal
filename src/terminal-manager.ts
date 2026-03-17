import * as vscode from 'vscode';
import { resolveIcon } from './icon-resolver';
import { ShellPseudoterminal } from './shell-pty';

export interface CommandConfig {
  name: string;
  icon?: string;
  command: string;
}

// 관리 중인 터미널 이름에 붙이는 보이지 않는 마커 (Zero-Width Space)
const MARKER = '\u200B\u200B\u200B';
const GROUP_LOCK_TIMEOUT_MS = 1000;

export class TerminalManager {
  private managedTerminals: Set<vscode.Terminal> = new Set();

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * 재시작 시 탭이 없는 빈 그룹을 찾아 제거한다.
   */
  async cleanupEmptyGroups(): Promise<void> {
    for (const group of vscode.window.tabGroups.all) {
      if (group.tabs.length === 0) {
        try {
          await vscode.window.tabGroups.close(group);
        } catch {
          // 이미 정리된 경우 무시
        }
      }
    }
  }

  async runCommand(config: CommandConfig): Promise<void> {
    const iconPath = resolveIcon(config.icon, this.context);

    const existingGroup = this.findManagedGroup();

    if (existingGroup) {
      this.createManagedTerminal(config, iconPath, existingGroup.viewColumn);
    } else {
      await vscode.commands.executeCommand('workbench.action.newGroupRight');
      const newViewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;

      this.createManagedTerminal(config, iconPath, newViewColumn);

      await this.waitForGroupChange();
      await vscode.commands.executeCommand(
        'workbench.action.lockEditorGroup'
      );
    }
  }

  private createManagedTerminal(
    config: CommandConfig,
    iconPath: vscode.ThemeIcon | vscode.Uri | undefined,
    viewColumn: vscode.ViewColumn
  ): vscode.Terminal {
    const ptyInstance = new ShellPseudoterminal(config.command);
    const terminal = vscode.window.createTerminal({
      name: config.name + MARKER,
      iconPath,
      location: { viewColumn, preserveFocus: false },
      pty: ptyInstance,
    });
    terminal.show();
    this.managedTerminals.add(terminal);
    return terminal;
  }

  private waitForGroupChange(): Promise<void> {
    return new Promise<void>((resolve) => {
      const disposable = vscode.window.tabGroups.onDidChangeTabGroups(() => {
        clearTimeout(timer);
        disposable.dispose();
        resolve();
      });
      const timer = setTimeout(() => {
        disposable.dispose();
        resolve();
      }, GROUP_LOCK_TIMEOUT_MS);
    });
  }

  /**
   * 마커가 포함된 탭 이름을 가진 탭이 있는 에디터 그룹을 찾는다.
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
    const markedName = name + MARKER;
    for (const terminal of this.managedTerminals) {
      if (terminal.name === markedName) {
        terminal.show();
        return true;
      }
    }
    return false;
  }

  onTerminalClosed(terminal: vscode.Terminal): void {
    this.managedTerminals.delete(terminal);
  }

  dispose(): void {
    for (const terminal of this.managedTerminals) {
      terminal.dispose();
    }
    this.managedTerminals.clear();
  }
}
