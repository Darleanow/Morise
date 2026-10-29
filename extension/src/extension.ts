import * as vscode from 'vscode';
import { TEMPLATES, classNameFor, templateXml } from './templates';
import { UiEditorProvider, VIEW_TYPE } from './uiEditorProvider';

/** New Form: pick a template, choose where to save it, open it in the designer. */
async function newForm(folder?: vscode.Uri): Promise<void> {
    const pick = await vscode.window.showQuickPick(TEMPLATES.map((t) => ({ label: t.label, description: t.base, detail: t.detail, id: t.id })), { title: 'New Qt Designer form', placeHolder: 'Choose a template' });
    if (!pick) {
        return;
    }
    const dir = folder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    const target = await vscode.window.showSaveDialog({
        defaultUri: dir ? vscode.Uri.joinPath(dir, 'form.ui') : undefined,
        filters: { 'Qt Designer form': ['ui'] },
        saveLabel: 'Create form',
        title: 'Save the new form',
    });
    if (!target) {
        return;
    }
    const base = target.path.replace(/^.*\//, '');
    await vscode.workspace.fs.writeFile(target, Buffer.from(templateXml(pick.id, classNameFor(base)), 'utf8'));
    await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
}

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
        vscode.commands.registerCommand('qtDesignerRevamped.newForm', (uri?: vscode.Uri) => newForm(uri && uri.scheme === 'file' ? uri : undefined)),
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
