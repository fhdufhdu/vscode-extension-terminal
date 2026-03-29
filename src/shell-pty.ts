import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

interface BridgeMessage {
  type: 'output' | 'exit';
  data?: string;
  code?: number;
}

export class ShellPseudoterminal implements vscode.Pseudoterminal {
  private bridgeProcess: ChildProcess | undefined;
  private rl: readline.Interface | undefined;
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<void>();
  private disposed = false;

  onDidWrite = this.writeEmitter.event;
  onDidClose = this.closeEmitter.event;

  constructor(
    private command: string,
    private extensionPath: string,
    private commandDelayMs: number
  ) {}

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    const cols = initialDimensions?.columns ?? 80;
    const rows = initialDimensions?.rows ?? 24;

    try {
      const platform = os.platform();
      const arch = os.arch();
      let binaryName = `pty-bridge-${platform}-${arch}`;
      if (platform === 'win32') binaryName += '.exe';
      const bridgePath = path.join(this.extensionPath, 'bin', binaryName);

      this.bridgeProcess = spawn(bridgePath, [], {
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
        env: { ...process.env, COLORTERM: 'truecolor', TERM_PROGRAM: 'vscode' },
      });

      if (this.bridgeProcess.stdout) {
        this.rl = readline.createInterface({
          input: this.bridgeProcess.stdout,
          terminal: false,
        });

        this.rl.on('line', (line) => {
          if (this.disposed) return;
          try {
            const msg: BridgeMessage = JSON.parse(line);
            if (msg.type === 'output' && msg.data) {
              this.writeEmitter.fire(msg.data);
            } else if (msg.type === 'exit') {
              this.closeEmitter.fire();
            }
          } catch {
            // non-JSON 출력은 브릿지 디버그 로그일 수 있으므로 무시
          }
        });
      }

      this.bridgeProcess.on('error', (err) => {
        this.writeEmitter.fire(`\r\n[Bridge Error]: ${err.message}\r\n`);
        this.closeEmitter.fire();
      });

      this.sendBridgeMessage({ type: 'resize', cols, rows });

      if (this.command.trim()) {
        if (this.commandDelayMs > 0) {
          setTimeout(() => {
            this.handleInput(this.command + '\n');
          }, this.commandDelayMs);
        } else {
          this.handleInput(this.command + '\n');
        }
      }
    } catch (e) {
      this.closeEmitter.fire();
    }
  }

  handleInput(data: string): void {
    this.sendBridgeMessage({ type: 'input', data });
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    this.sendBridgeMessage({ type: 'resize', cols: dimensions.columns, rows: dimensions.rows });
  }

  close(): void {
    this.disposed = true;
    this.rl?.close();
    this.bridgeProcess?.kill();
    this.bridgeProcess = undefined;
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }

  private sendBridgeMessage(msg: object): void {
    if (this.bridgeProcess?.stdin && !this.disposed) {
      this.bridgeProcess.stdin.write(JSON.stringify(msg) + '\n');
    }
  }
}
