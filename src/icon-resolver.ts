import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const BUILTIN_ICONS = ['claude', 'gemini', 'codex'];

export function resolveIcon(
  icon: string | undefined,
  context: vscode.ExtensionContext
): vscode.ThemeIcon | vscode.Uri | undefined {
  if (!icon) {
    return new vscode.ThemeIcon('terminal');
  }

  // 내장 아이콘
  if (BUILTIN_ICONS.includes(icon)) {
    return vscode.Uri.file(context.asAbsolutePath(`icons/${icon}.svg`));
  }

  // 파일 경로 (상대 또는 절대)
  if (icon.startsWith('./') || icon.startsWith('/') || icon.startsWith('\\')) {
    const resolvedPath = icon.startsWith('/')
      ? icon
      : path.resolve(
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
          icon
        );
    if (fs.existsSync(resolvedPath)) {
      return vscode.Uri.file(resolvedPath);
    }
    return new vscode.ThemeIcon('terminal');
  }

  // codicon 이름
  return new vscode.ThemeIcon(icon);
}
