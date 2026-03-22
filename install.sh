#!/bin/bash
set -e

# Node 20 확인 (필요한 경우)
# source ~/.nvm/nvm.sh && nvm use 20 || true

echo "--- Installing JS Dependencies ---"
npm install

echo "--- Building Go PTY Bridge ---"
mkdir -p bin
cd pty-bridge

# 현재 플랫폼 빌드
GOOS=$(go env GOOS)
GOARCH=$(go env GOARCH)
BINARY_NAME="../bin/pty-bridge-$GOOS-$GOARCH"
if [ "$GOOS" = "windows" ]; then BINARY_NAME="$BINARY_NAME.exe"; fi

echo "Building for $GOOS/$GOARCH..."
go build -o "$BINARY_NAME" .

# 전체 플랫폼 빌드 (개발/배포용)
if [ "$1" = "--all" ]; then
    echo "Building for all platforms..."
    GOOS=darwin GOARCH=arm64 go build -o ../bin/pty-bridge-darwin-arm64 .
    GOOS=darwin GOARCH=amd64 go build -o ../bin/pty-bridge-darwin-x64 .
    GOOS=linux GOARCH=amd64 go build -o ../bin/pty-bridge-linux-x64 .
    GOOS=windows GOARCH=amd64 go build -o ../bin/pty-bridge-win32-x64.exe .
fi

cd ..

echo "--- Building Extension ---"
npm run build

echo "--- Packaging Extension ---"
npx @vscode/vsce package --allow-missing-repository

echo "--- Installing Extension ---"
VERSION=$(node -p "require('./package.json').version")
code --install-extension "terminal-tabs-$VERSION.vsix" --force

echo "Success! Please reload VS Code window."
