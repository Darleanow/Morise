// Launches a real VS Code (downloaded by @vscode/test-electron) and runs suite.ts in its extension host.
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
    const root = path.resolve(__dirname, '..', '..');
    const vscodeExecutablePath = process.env.VSCODE_EXE;
    await runTests({
        ...(vscodeExecutablePath ? { vscodeExecutablePath } : { version: '1.105.1' }),
        extensionDevelopmentPath: root,
        extensionTestsPath: path.join(__dirname, 'suite'),
        launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--no-sandbox', '--disable-gpu',
            '--user-data-dir', path.join(root, '.vscode-test', 'user-data')],
    });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
