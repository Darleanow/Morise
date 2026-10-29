// Copies the official VS Code icon font into media/ so the webview can load it (MIT, @vscode/codicons).
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '..', 'node_modules', '@vscode', 'codicons', 'dist');
const dst = path.join(__dirname, '..', 'media', 'codicons');
fs.mkdirSync(dst, { recursive: true });
for (const f of ['codicon.css', 'codicon.ttf']) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
