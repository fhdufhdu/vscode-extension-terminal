import * as vscode from 'vscode';
import * as pty from 'node-pty';
import * as os from 'os';

export class ShellPseudoterminal implements vscode.Pseudoterminal {
  private ptyProcess: pty.IPty | undefined;
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<void>();
  private dataBuffer: string[] = [];
  private ready = false;
  private disposed = false;

  onDidWrite = this.writeEmitter.event;
  onDidClose = this.closeEmitter.event;

  constructor(private command: string) {}

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    const shell = this.getDefaultShell();
    const cols = initialDimensions?.columns ?? 80;
    const rows = initialDimensions?.rows ?? 24;

    try {
      const env = {
        ...process.env,
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'vscode',
      } as { [key: string]: string };

      this.ptyProcess = pty.spawn(shell, ['--login'], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
        env,
      });

      this.ptyProcess.onData((data) => {
        if (this.disposed) { return; }
        if (this.ready) {
          this.writeEmitter.fire(data);
        } else {
          this.dataBuffer.push(data);
        }
      });

      this.ptyProcess.onExit(() => {
        // xterm.js dispose 타이밍과 충돌하지 않도록 지연
        setTimeout(() => {
          if (!this.disposed) {
            this.closeEmitter.fire();
          }
        }, 100);
      });

      // xterm.js 초기화 대기 후 버퍼 플러시 및 명령어 전달
      setTimeout(() => {
        this.ready = true;
        for (const data of this.dataBuffer) {
          this.writeEmitter.fire(data);
        }
        this.dataBuffer = [];

        if (this.command.trim() && this.ptyProcess) {
          this.ptyProcess.write(this.command + '\n');
        }
      }, 500);
    } catch (e) {
      setTimeout(() => {
        this.writeEmitter.fire(`Failed to start shell: ${e}\r\n`);
      }, 500);
    }
  }

  handleInput(data: string): void {
    this.ptyProcess?.write(data);
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    if (this.disposed) { return; }
    this.ptyProcess?.resize(dimensions.columns, dimensions.rows);
  }

  close(): void {
    this.disposed = true;
    try {
      this.ptyProcess?.kill();
    } catch {
      // 이미 종료된 프로세스 무시
    }
    this.ptyProcess = undefined;
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }

  private getDefaultShell(): string {
    if (os.platform() === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }
}
