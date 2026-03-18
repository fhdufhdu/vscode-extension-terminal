#!/bin/bash
source ~/.nvm/nvm.sh
nvm use 20

npm install
# code 심볼릭 링크를 따라가서 VSCode의 package.json 위치를 찾는다
CODE_REAL=$(readlink "$(which code)" 2>/dev/null || readlink -f "$(which code)")
CODE_BIN_DIR=$(dirname "$CODE_REAL")
# macOS: .../app/bin/code → ../package.json
# Linux: .../code/bin/code → ../resources/app/package.json
if [ -f "$CODE_BIN_DIR/../package.json" ]; then
  VSCODE_PKG="$CODE_BIN_DIR/../package.json"
elif [ -f "$CODE_BIN_DIR/../resources/app/package.json" ]; then
  VSCODE_PKG="$CODE_BIN_DIR/../resources/app/package.json"
else
  echo "Error: VSCode package.json을 찾을 수 없습니다." && exit 1
fi
ELECTRON_VERSION=$(python3 -c "import json; print(json.load(open('$VSCODE_PKG'))['devDependencies']['electron'])")
npx electron-rebuild --version "$ELECTRON_VERSION" --module-dir . --which-module node-pty
npm run build
npx @vscode/vsce package
code --install-extension terminal-tabs-0.0.1.vsix --force
