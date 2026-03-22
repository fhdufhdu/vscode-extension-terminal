import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

const PTY_EXIT_DELAY_MS = 100;

interface BridgeMessage {
  type: 'output' | 'exit';
  data?: string;
  code?: number;
}

export class ShellPseudoterminal implements vscode.Pseudoterminal {
  private bridgeProcess: ChildProcess | undefined;
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<void>();
  private disposed = false;

  onDidWrite = this.writeEmitter.event;
  onDidClose = this.closeEmitter.event;

  private commandDelayMs: number;

  constructor(private command: string, private extensionPath: string) {
    const config = vscode.workspace.getConfiguration('terminalTabs');
    this.commandDelayMs = config.get<number>('commandDelayMs', 0);
  }

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    const cols = initialDimensions?.columns ?? 80;
    const rows = initialDimensions?.rows ?? 24;

    try {
      const bridgeBinary = this.getBridgeBinaryName();
      const bridgePath = path.join(this.extensionPath, 'bin', bridgeBinary);

      // Go 브릿지 실행
      this.bridgeProcess = spawn(bridgePath, [], {
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
        env: { ...process.env, COLORTERM: 'truecolor', TERM_PROGRAM: 'vscode' }
      });

      // 브릿지로부터의 출력을 처리 (JSON 한 줄 단위)
      if (this.bridgeProcess.stdout) {
        const rl = readline.createInterface({
          input: this.bridgeProcess.stdout,
          terminal: false
        });

        rl.on('line', (line) => {
          if (this.disposed) return;
          try {
            const msg: BridgeMessage = JSON.parse(line);
            if (msg.type === 'output' && msg.data) {
              this.writeEmitter.fire(msg.data);
            } else if (msg.type === 'exit') {
              this.handleExit();
            }
          } catch (e) {
            // JSON 파싱 실패 시 일반 텍스트로 처리하거나 무시
          }
        });
      }

      this.bridgeProcess.on('error', (err) => {
        vscode.window.showErrorMessage(`Terminal Tabs: 브릿지 실행 실패 - ${err.message}`);
        this.handleExit();
      });

      // 초기 크기 설정
      this.setDimensions({ columns: cols, rows: rows });

      // 초기 명령어 실행
      setTimeout(() => {
        if (this.command.trim() && this.bridgeProcess) {
          this.handleInput(this.command + '\n');
        }
      }, this.commandDelayMs);

    } catch (e) {
      this.closeEmitter.fire();
      vscode.window.showErrorMessage(`Terminal Tabs: 쉘 시작 실패 - ${e}`);
    }
  }

  private getBridgeBinaryName(): string {
    const platform = os.platform();
    const arch = os.arch();
    
    let name = `pty-bridge-${platform}-${arch}`;
    if (platform === 'win32') {
      name += '.exe';
    }
    return name;
  }

  handleInput(data: string): void {
    if (this.bridgeProcess && this.bridgeProcess.stdin) {
      const msg = JSON.stringify({ type: 'input', data: data });
      this.bridgeProcess.stdin.write(cmdWithNewline(msg));
    }
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    if (this.bridgeProcess && this.bridgeProcess.stdin) {
      const msg = JSON.stringify({ 
        type: 'resize', 
        cols: dimensions.columns, 
        rows: dimensions.rows 
      });
      this.bridgeProcess.stdin.write(cmdWithNewline(msg));
    }
  }

  private handleExit(): void {
    if (this.disposed) return;
    setTimeout(() => {
      if (!this.disposed) {
        this.closeEmitter.fire();
      }
    }, PTY_EXIT_DELAY_MS);
  }

  close(): void {
    this.disposed = true;
    if (this.bridgeProcess) {
      this.bridgeProcess.kill();
    }
    this.bridgeProcess = undefined;
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }
}

function cmdWithNewline(cmd: string): string {
  return cmd + '\n';
}
