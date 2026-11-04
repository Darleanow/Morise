// Copies what the webview and the packaged extension need from outside the extension folder:
// the VS Code icon font (@vscode/codicons) and the license and readme files vsce looks for next to package.json.
const fs = require('node:fs');
const path = require('node:path');
const ext = path.join(__dirname, '..');
const root = path.join(ext, '..');

const fonts = path.join(ext, 'node_modules', '@vscode', 'codicons', 'dist');
const dst = path.join(ext, 'media', 'codicons');
fs.mkdirSync(dst, { recursive: true });
for (const f of ['codicon.css', 'codicon.ttf']) {
    fs.copyFileSync(path.join(fonts, f), path.join(dst, f));
}

for (const f of ['README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) {
    fs.copyFileSync(path.join(root, f), path.join(ext, f));
}
fs.cpSync(path.join(root, 'LICENSES'), path.join(ext, 'LICENSES'), { recursive: true });
