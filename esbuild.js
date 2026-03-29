const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

function copyHtml() {
  fs.copyFileSync(
    path.join(__dirname, 'src', 'webview', 'terminal.html'),
    path.join(__dirname, 'dist', 'terminal.html')
  );
}

async function main() {
  const [extCtx, webviewCtx] = await Promise.all([
    esbuild.context({
      entryPoints: ['src/extension.ts'],
      bundle: true,
      format: 'cjs',
      minify: production,
      sourcemap: !production,
      sourcesContent: false,
      platform: 'node',
      outfile: 'dist/extension.js',
      external: ['vscode'],
      logLevel: 'silent',
    }),
    esbuild.context({
      entryPoints: ['src/webview/terminal.ts'],
      bundle: true,
      format: 'iife',
      minify: production,
      sourcemap: !production,
      platform: 'browser',
      outfile: 'dist/webview.js',
      loader: { '.css': 'text' },
      logLevel: 'silent',
    }),
  ]);

  if (watch) {
    copyHtml();
    await Promise.all([extCtx.watch(), webviewCtx.watch()]);
    console.log('watching...');
  } else {
    await Promise.all([extCtx.rebuild(), webviewCtx.rebuild()]);
    copyHtml();
    await Promise.all([extCtx.dispose(), webviewCtx.dispose()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
