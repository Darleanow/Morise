import * as vscode from 'vscode';
import { UiEditorProvider, VIEW_TYPE } from './uiEditorProvider';

export interface TestApi {
    provider: UiEditorProvider;
}

export function activate(context: vscode.ExtensionContext): TestApi {
    const log = vscode.window.createOutputChannel('Qt Designer Revamped', { log: true });
    const provider = new UiEditorProvider(context, log);

    context.subscriptions.push(
        log,
        { dispose: () => provider.dispose() },
        vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
            webviewOptions: { retainContextWhenHidden: false },
            supportsMultipleEditorsPerDocument: true,
        }),
        vscode.commands.registerCommand('qtDesignerRevamped.restartBackend', () => provider.restartBackend()),
        vscode.commands.registerCommand('qtDesignerRevamped.openAsText', (uri?: vscode.Uri) => {
            const target = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (target) {
                return vscode.commands.executeCommand('vscode.openWith', target, 'default');
            }
            return undefined;
        }),
    );
    return { provider };
}

export function deactivate(): void {}
