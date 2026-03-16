# CLAUDE.md

## Git 작업 규칙

### 커밋 전 준비
1. `gh auth switch --user fhdufhdu`로 계정 전환
2. 모든 커밋에 `--author="fhdufhdu <fhdufhdu@gmail.com>"` 사용

### 커밋 단위
- 기능 단위로 커밋 (하나의 커밋에 여러 기능 혼합 금지)

### Push
- `main` 브랜치에 push

### 작업 완료 후
- `gh auth switch --user chowooseong`으로 계정 복원

## 빌드 및 설치

```bash
bash install.sh
```

- Node 20 필요 (`nvm use 20`)
- `node-pty`는 Electron 버전에 맞게 `electron-rebuild` 필요
- 설치 후 VSCode Reload Window
