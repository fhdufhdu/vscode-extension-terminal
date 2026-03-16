#!/bin/bash
source ~/.nvm/nvm.sh
nvm use 20

npm run build
npx @vscode/vsce package --no-dependencies
code --install-extension terminal-tabs-0.0.1.vsix --force
