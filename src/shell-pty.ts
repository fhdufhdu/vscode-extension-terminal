import * as vscode from 'vscode';
import * as pty from 'node-pty';
import * as os from 'os';

const IS_WINDOWS = os.platform() === 'win32';
const PTY_EXIT_DELAY_MS = 100;
const HIGH_WATER_MARK = 10 * 1024; // 10KB — 이 이상 쌓이면 pty 일시정지
const LOW_WATER_MARK = 1024;       // 1KB — 이 이하로 내려가면 pty 재개

export class ShellPseudoterminal implements vscode.Pseudoterminal {
  private ptyProcess: pty.IPty | undefined;
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<void>();
  private disposed = false;
  private writeQueue: string[] = [];
  private queueSize = 0;
  private draining = false;
  private paused = false;

  onDidWrite = this.writeEmitter.event;
  onDidClose = this.closeEmitter.event;

  private commandDelayMs: number;

  constructor(private command: string) {
    const config = vscode.workspace.getConfiguration('terminalTabs');
    this.commandDelayMs = config.get<number>('commandDelayMs', 0);
  }

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    const shell = this.getDefaultShell();
    const cols = initialDimensions?.columns ?? 80;
    const rows = initialDimensions?.rows ?? 24;

    try {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value;
      }
      env.COLORTERM = 'truecolor';
      env.TERM_PROGRAM = 'vscode';

      this.ptyProcess = pty.spawn(shell, this.getShellArgs(), {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
        env,
      });

      this.ptyProcess.onData((data) => {
        if (this.disposed) { return; }
        this.enqueueWrite(data);
      });

      this.ptyProcess.onExit(() => {
        // xterm.js가 비동기로 dimensions를 접근하므로 즉시 닫으면 에러 발생
        setTimeout(() => {
          if (!this.disposed) {
            this.closeEmitter.fire();
          }
        }, PTY_EXIT_DELAY_MS);
      });

      setTimeout(() => {
        if (this.command.trim() && this.ptyProcess) {
          this.ptyProcess.write(this.command + this.getEOL());
        }
      }, this.commandDelayMs);
    } catch (e) {
      this.closeEmitter.fire();
      vscode.window.showErrorMessage(`Terminal Tabs: 쉘 시작 실패 - ${e}`);
    }
  }

  private enqueueWrite(data: string): void {
    this.writeQueue.push(data);
    this.queueSize += data.length;

    if (!this.paused && this.queueSize > HIGH_WATER_MARK) {
      this.paused = true;
      this.ptyProcess?.pause();
    }

    this.drainQueue();
  }

  private drainQueue(): void {
    if (this.draining) { return; }
    this.draining = true;

    const step = () => {
      if (this.disposed || this.writeQueue.length === 0) {
        this.draining = false;
        return;
      }

      const chunk = this.writeQueue.shift()!;
      this.queueSize -= chunk.length;
      this.writeEmitter.fire(chunk);

      if (this.paused && this.queueSize <= LOW_WATER_MARK) {
        this.paused = false;
        this.ptyProcess?.resume();
      }

      if (this.writeQueue.length > 0) {
        setTimeout(step, 0);
      } else {
        this.draining = false;
      }
    };

    step();
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
    if (IS_WINDOWS) {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  private getShellArgs(): string[] {
    if (IS_WINDOWS) return [];
    return ['--login'];
  }

  private getEOL(): string {
    return IS_WINDOWS ? '\r\n' : '\n';
  }
}
