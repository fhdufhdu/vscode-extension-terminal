# Terminal Tabs

에디터 탭 우측 상단 버튼으로 사용자 설정 터미널 명령어를 실행하는 VSCode 확장.

## 기능

- 에디터 탭 우측 상단 터미널 버튼 클릭 → 명령어 선택 → 터미널 실행
- 에디터 영역에 열린 터미널은 자동 핀 고정
- 같은 에디터 그룹에 터미널 탭이 모여서 열림
- codicon, 내장 아이콘(claude, gemini, codex), 커스텀 이미지 지원

## 설정

`settings.json` 또는 Settings UI에서 `terminalTabs.commands`를 설정합니다.

```jsonc
"terminalTabs.commands": [
  {
    "name": "Dev Server",
    "icon": "play",              // codicon
    "command": "npm run dev"
  },
  {
    "name": "Claude",
    "icon": "claude",            // 내장 아이콘
    "command": "claude"
  },
  {
    "name": "Custom Tool",
    "icon": "./icons/tool.svg",  // 커스텀 이미지 경로
    "command": "my-tool start"
  }
]
```

### 아이콘 옵션

| 값 | 설명 |
|---|---|
| codicon 이름 (예: `play`, `beaker`) | VSCode 내장 codicon |
| `claude`, `gemini`, `codex` | 확장 내장 아이콘 |
| 파일 경로 (예: `./icons/my.svg`) | 커스텀 SVG/PNG 이미지 |
