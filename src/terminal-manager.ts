import * as vscode from 'vscode';
import { resolveIcon } from './icon-resolver';
import { ShellPseudoterminal } from './shell-pty';

export interface CommandConfig {
  name: string;
  icon?: string;
  command: string;
}

const MARKER = '\u200B\u200B\u200B';
const GROUP_LOCK_TIMEOUT_MS = 1000;

interface ManagedTerminal {
  terminal: vscode.Terminal;
  pty: ShellPseudoterminal;
}

export class TerminalManager {
  private managedTerminals: Map<vscode.Terminal, ManagedTerminal> = new Map();
  private lastActiveTerminal: ManagedTerminal | undefined;

  constructor(private context: vscode.ExtensionContext) {}

  trackActiveTerminal(terminal: vscode.Terminal): void {
    const managed = this.managedTerminals.get(terminal);
    if (managed) {
      this.lastActiveTerminal = managed;
    }
  }

  sendToLastActiveTerminal(text: string): void {
    if (this.lastActiveTerminal) {
      this.lastActiveTerminal.pty.handleInput(text);
      this.lastActiveTerminal.terminal.show(true);
    }
  }

  async cleanupEmptyGroups(): Promise<void> {
    let found = true;
    while (found) {
      found = false;
      for (const group of vscode.window.tabGroups.all) {
        if (group.tabs.length === 0) {
          try {
            await vscode.window.tabGroups.close(group);
            found = true;
            break;
          } catch {
            // 이미 닫힌 그룹
          }
        }
      }
    }
  }

  async runCommand(config: CommandConfig): Promise<void> {
    const existingGroup = this.findManagedGroup();

    if (existingGroup) {
      this.createManagedTerminal(config, existingGroup.viewColumn);
    } else {
      await vscode.commands.executeCommand('workbench.action.newGroupRight');
      const newViewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;

      this.createManagedTerminal(config, newViewColumn);

      await this.waitForGroupChange();
      await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
    }
  }

  private createManagedTerminal(config: CommandConfig, viewColumn: vscode.ViewColumn): void {
    const delayMs = vscode.workspace.getConfiguration('terminalTabs').get<number>('commandDelayMs', 0);
    const pty = new ShellPseudoterminal(config.command, this.context.extensionPath, delayMs);
    const iconPath = resolveIcon(config.icon, this.context);

    const terminal = vscode.window.createTerminal({
      name: config.name + MARKER,
      iconPath,
      location: { viewColumn, preserveFocus: false },
      pty,
    });
    terminal.show();

    const managed: ManagedTerminal = { terminal, pty };
    this.managedTerminals.set(terminal, managed);
    this.lastActiveTerminal = managed;
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

  focusTerminalByName(name: string): boolean {
    const markedName = name + MARKER;
    for (const managed of this.managedTerminals.values()) {
      if (managed.terminal.name === markedName) {
        managed.terminal.show();
        return true;
      }
    }
    return false;
  }

  onTerminalClosed(terminal: vscode.Terminal): void {
    const managed = this.managedTerminals.get(terminal);
    if (managed) {
      this.managedTerminals.delete(terminal);
      if (this.lastActiveTerminal === managed) {
        this.lastActiveTerminal = this.managedTerminals.values().next().value;
      }
    }
  }

  dispose(): void {
    for (const managed of this.managedTerminals.values()) {
      managed.terminal.dispose();
    }
    this.managedTerminals.clear();
  }
}
