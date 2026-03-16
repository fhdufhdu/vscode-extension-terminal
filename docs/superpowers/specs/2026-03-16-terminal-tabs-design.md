# Terminal Tabs - VSCode Extension Design Spec

## Overview

에디터 탭 우측 상단 버튼을 통해 사용자가 설정한 터미널 명령어를 실행하는 VSCode 확장.
터미널은 에디터 영역에 탭으로 열리며, 핀 고정되고, 같은 에디터 그룹에 모여서 열린다.

## 요구사항

1. 에디터 탭 우측 상단에 버튼 하나 배치
2. 클릭 시 설정된 명령어 목록을 드롭다운(QuickPick)으로 표시
3. 선택한 명령어로 터미널 생성 및 실행
4. 터미널 위치는 VSCode `terminal.integrated.defaultLocation` 설정에 따름
5. 에디터 영역에 열린 경우 자동 핀 고정
6. 이 확장으로 열린 고정된 터미널이 있는 에디터 그룹을 추적하여, 추가 터미널도 같은 그룹에 열림
7. 같은 명령어 중복 실행 허용
8. 탭 이름, 아이콘, 명령어를 settings.json 및 Settings UI에서 설정 가능
9. 아이콘: codicon, 내장 아이콘(claude, gemini, codex), 커스텀 이미지(SVG/PNG) 지원

## 설정 구조

```jsonc
// settings.json
"terminalTabs.commands": [
  {
    "name": "Dev Server",
    "icon": "play",              // codicon 이름
    "command": "npm run dev"
  },
  {
    "name": "Claude",
    "icon": "claude",            // 내장 아이콘 (claude, gemini, codex)
    "command": "claude"
  },
  {
    "name": "Custom Tool",
    "icon": "./icons/tool.svg",  // 워크스페이스 상대경로 또는 절대경로
    "command": "my-tool start"
  }
]
```

### 아이콘 분기 로직

| icon 값 | 처리 |
|---------|------|
| codicon 이름 (`play`, `beaker` 등) | `new vscode.ThemeIcon(icon)` |
| 내장 이름 (`claude`, `gemini`, `codex`) | `vscode.Uri.file(context.asAbsolutePath('icons/<name>.svg'))` |
| 파일 경로 (`./path` 또는 절대경로) | `vscode.Uri.file(resolvedPath)` |

## 동작 흐름

1. 사용자가 에디터 탭 우측 상단 버튼 클릭
2. `terminalTabs.commands` 설정에서 등록된 명령어 목록을 QuickPick으로 표시
3. 명령어 선택 시:
   a. 이 확장이 만든 고정된 터미널이 있는 에디터 그룹이 존재하는지 확인
   b. 존재하면 → 해당 에디터 그룹에 터미널 생성
   c. 존재하지 않으면 → 기본 위치에 터미널 생성
   d. `terminal.sendText(command)`로 명령어 실행
   e. 에디터 영역에 열렸으면 → `workbench.action.pinEditor` 실행

## 프로젝트 구조

```
vscode-extension-terminal/
├── package.json            # 확장 매니페스트, 설정 스키마, 커맨드, 메뉴
├── tsconfig.json
├── src/
│   ├── extension.ts        # activate/deactivate, 커맨드 등록
│   ├── terminal-manager.ts # 터미널 생성, 그룹 추적, 핀 고정 로직
│   └── icon-resolver.ts    # icon 문자열 → ThemeIcon / Uri 분기
├── icons/
│   ├── claude.svg
│   ├── gemini.svg
│   └── codex.svg
└── README.md
```

### 파일 역할

- **extension.ts**: 진입점. 커맨드 등록, QuickPick UI 생성, 설정 읽기
- **terminal-manager.ts**: 핵심 로직. 고정된 에디터 그룹 추적, 터미널 생성 시 해당 그룹에 열기, 핀 고정
- **icon-resolver.ts**: icon 문자열을 `ThemeIcon` 또는 `Uri`로 변환하는 유틸리티

## package.json 주요 설정

### contributes.commands

```json
{
  "command": "terminalTabs.runCommand",
  "title": "Terminal Tabs: Run Command",
  "icon": "$(terminal)"
}
```

### contributes.menus

```json
{
  "editor/title": [
    {
      "command": "terminalTabs.runCommand",
      "group": "navigation"
    }
  ]
}
```

### contributes.configuration

```json
{
  "title": "Terminal Tabs",
  "properties": {
    "terminalTabs.commands": {
      "type": "array",
      "description": "터미널 탭에서 실행할 명령어 목록",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "터미널 탭에 표시될 이름"
          },
          "icon": {
            "type": "string",
            "description": "아이콘 (codicon 이름, 내장 아이콘명, 또는 이미지 파일 경로)"
          },
          "command": {
            "type": "string",
            "description": "실행할 터미널 명령어"
          }
        },
        "required": ["name", "command"]
      },
      "default": []
    }
  }
}
```

## 에디터 그룹 추적 로직

```
trackedGroupId: number | null

터미널 생성 시:
  1. trackedGroupId가 있고 해당 그룹이 아직 존재하면:
     - 해당 그룹의 viewColumn을 사용하여 터미널 생성
  2. trackedGroupId가 없거나 그룹이 사라졌으면:
     - 기본 위치에 터미널 생성
     - 에디터 영역에 열렸으면 해당 그룹을 trackedGroupId로 저장

핀 고정:
  - 에디터 영역에 열린 경우에만 workbench.action.pinEditor 실행
  - 터미널 패널에 열린 경우 핀 고정 안 함
```

## 엣지 케이스 처리

### 설정이 비어있을 때
- `terminalTabs.commands`가 빈 배열이면 QuickPick 대신 안내 메시지 표시: "설정에서 명령어를 추가하세요"

### 아이콘 파일을 찾을 수 없을 때
- 커스텀 아이콘 경로가 존재하지 않으면 기본 `terminal` codicon으로 폴백

### icon 미지정 시
- `icon` 필드가 없으면 기본 `terminal` codicon 사용

### 추적 중인 에디터 그룹이 닫혔을 때
- `trackedGroupId`의 그룹이 더 이상 존재하지 않으면 `null`로 초기화
- 다음 터미널 생성 시 기본 동작으로 진행

### 터미널 위치 우선순위
- 추적 중인 에디터 그룹이 존재하면 → 해당 그룹에 열기 (VSCode 기본 설정보다 우선)
- 추적 중인 그룹이 없으면 → VSCode `terminal.integrated.defaultLocation` 설정에 따름

## 기술적 고려사항

- VSCode Terminal API의 `createTerminal()` 사용
- `terminal.integrated.defaultLocation` 설정을 존중하되, 이미 고정된 그룹이 있으면 그곳에 열기
- `vscode.window.tabGroups` API로 에디터 그룹 및 탭 상태 추적
- 확장 비활성화 시 추적 상태 정리 (메모리 내 상태만 사용, 영속 저장 불필요)
