# Zero-Config Go Bridge Design

## Background & Motivation
현재 `node-pty`를 사용하여 VS Code 터미널 탭을 구현하고 있으나, `node-pty`는 C++ 네이티브 모듈이므로 사용자의 환경(Python, 컴파일러 등)과 VS Code의 Electron 버전에 맞춰 매번 다시 빌드(`electron-rebuild`)되어야 합니다. 이로 인해 특히 새로운 환경(예: 맥북 에어)이나 사용자 기기에서 `posix_spawnp failed`와 같은 심각한 설치/실행 오류가 지속적으로 발생하고 있습니다.
이를 해결하기 위해 `node-pty` 의존성을 완전히 제거하고, 외부 의존성 없이 독립적으로 실행 가능한 Go 기반의 정적 바이너리를 PTY 브릿지로 사용하는 "Zero-Config" 아키텍처로 전환합니다.

## Scope & Impact
*   **영향 범위:** `src/shell-pty.ts`, `package.json`, `install.sh`, 그리고 새로 추가될 Go 브릿지 소스 코드(`pty-bridge/`).
*   **사용자 영향:** 사용자는 Python이나 빌드 도구 없이 확장 프로그램 설치 즉시 터미널을 사용할 수 있게 됩니다.
*   **제거 대상:** `node-pty`, `electron-rebuild` 관련 로직.

## Proposed Solution
"Native Messaging / Bridge 방식"을 채택합니다.
1.  **PTY Bridge (Go):** `creack/pty` 라이브러리를 사용하여 쉘을 실행하고 PTY를 제어하는 독립된 Go 바이너리를 작성합니다.
2.  **IPC (JSON over stdin/stdout):** VS Code 확장 프로그램(TypeScript)은 `child_process.spawn`으로 Go 바이너리를 실행하며, 표준 입출력(stdin/stdout)을 통해 JSON 메시지로 입력(키보드), 출력(화면), 크기 조절(resize) 데이터를 주고받습니다.
3.  **Cross-Compilation:** 주요 OS(Mac M1/Intel, Windows, Linux)용 바이너리를 미리 빌드하여 `.vsix` 파일에 포함 배포합니다.

## Implementation Steps

### Step 1: Go Bridge 바이너리 개발
1.  프로젝트 루트에 `pty-bridge/` 디렉토리를 생성합니다.
2.  `go mod init pty-bridge` 및 `go get github.com/creack/pty` 실행.
3.  `main.go` 작성:
    *   `stdin`에서 JSON 명령(`input`, `resize`)을 읽어 쉘로 전달.
    *   PTY 출력을 읽어 JSON 형태(`{"type":"output", "data":"..."}`)로 `stdout`으로 전송.

### Step 2: VS Code Extension 연동 (TypeScript)
1.  `src/shell-pty.ts` 파일에서 `node-pty` 의존성 제거.
2.  `child_process.spawn`을 사용하여 현재 OS 및 아키텍처에 맞는 `pty-bridge` 바이너리를 실행하도록 로직 수정.
3.  Bridge와의 JSON 메시지 파싱 및 처리 로직 구현.

### Step 3: 빌드 스크립트 및 의존성 정리
1.  `package.json`에서 `node-pty`, `electron-rebuild` 제거.
2.  `install.sh` 및 배포 스크립트(`esbuild.js` 또는 별도 스크립트) 수정:
    *   `pty-bridge` 디렉토리에서 각 플랫폼(darwin-arm64, darwin-amd64, windows-amd64, linux-amd64)에 맞게 `go build`를 수행하여 결과물을 `bin/` 디렉토리로 복사하는 로직 추가.

## Verification & Testing
1.  **로컬 테스트:** Mac 환경(Intel 및 Apple Silicon)에서 VS Code 확장 프로그램을 실행하여 터미널 입출력, 크기 조절, 한글 입력 등이 정상적으로 동작하는지 확인합니다.
2.  **Zero-Config 검증:** `node_modules` 삭제 및 Python 환경 제거 후 설치 시 정상 동작 여부 확인.
3.  **프로세스 종료 확인:** VS Code 터미널 탭이 닫힐 때 Go 프로세스와 하위 쉘(zsh 등)이 고아(Zombie) 프로세스로 남지 않고 깔끔하게 종료되는지 확인.

## Migration & Rollback
*   **Migration:** 기존 `node-pty` 방식은 새 버전(v0.0.2) 릴리즈 시 덮어써집니다.
*   **Rollback:** 문제 발생 시 직전 릴리즈된 `v0.0.1` Git 태그로 되돌리고 `npm install` 방식을 복원할 수 있습니다. 기존 브랜치를 분리(예: `feature/go-pty-bridge`)하여 작업 후 안정성이 확보되면 병합합니다.