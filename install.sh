#!/bin/bash
source ~/.nvm/nvm.sh
nvm use 20

npm install
ELECTRON_VERSION=$(cat /Applications/Visual\ Studio\ Code.app/Contents/Resources/app/package.json | python3 -c "import sys,json; print(json.load(sys.stdin)['devDependencies']['electron'])")
npx electron-rebuild --version "$ELECTRON_VERSION" --module-dir . --which-module node-pty
npm run build
npx @vscode/vsce package
code --install-extension terminal-tabs-0.0.1.vsix --force
