// Bundles src/webview/main.ts and its modules into media/webview/main.js (single classic script, no imports at runtime).
const esbuild = require('esbuild');
const path = require('node:path');

const watch = process.argv.includes('--watch');
const options = {
    entryPoints: [path.join(__dirname, '..', 'src', 'webview', 'main.ts')],
    outfile: path.join(__dirname, '..', 'media', 'webview', 'main.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'info',
};

if (watch) {
    esbuild.context(options).then((ctx) => ctx.watch());
} else {
    esbuild.build(options).catch(() => process.exit(1));
}
