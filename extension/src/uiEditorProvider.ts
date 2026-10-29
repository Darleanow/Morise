import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { BackendClient } from './backendClient';
import { parseWebviewMessage } from './messages';
import { pageBody } from './pageBody';
import type { LocaleChoices, ConnectionInfo, ContainerInfo, DescribeResult, FormInfo, HostToWebview, PaletteCategory, PropertiesResult, Snapshot, WebviewToHost } from './protocol';

export const VIEW_TYPE = 'qtDesignerRevamped.uiEditor';

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

class UiDocument implements vscode.CustomDocument {
    readonly docId = randomUUID();
    snapshot: Snapshot | undefined;
    /** Text last read from or written to disk; used to tell our own saves from external edits. */
    diskText = '';
    selectedName: string | undefined;
    /** Connections only change with the undo stack, so they are cached per stack index. */
    connectionCache: { index: number; generation: number; value: ConnectionInfo[] } | undefined;
    generation = 0;
    /** Optional data the page asked for in every state message. */
    wants = { tabOrder: false, formInfo: false };
    /** A drag in progress: VS Code is told about it only when it ends, so a cancelled drag leaves no trace. */
    gesture: { baseIndex: number } | undefined;
    /** A layout the page asked to inspect; cleared whenever the selection changes. */
    inspectName: string | undefined;
    readonly panels = new Set<vscode.WebviewPanel>();
    /** Serialises backend work for this document so webview events cannot interleave. */
    queue: Promise<unknown> = Promise.resolve();
    readonly disposables: vscode.Disposable[] = [];

    constructor(readonly uri: vscode.Uri) {}

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

export class UiEditorProvider implements vscode.CustomEditorProvider<UiDocument> {
    private readonly changeEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<UiDocument> | vscode.CustomDocumentContentChangeEvent<UiDocument>>();
    readonly onDidChangeCustomDocument = this.changeEmitter.event;

    private client: BackendClient | undefined;
    private clientStarting: Promise<BackendClient> | undefined;
    private readonly documents = new Set<UiDocument>();

    constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.LogOutputChannel) {}

    // ---- backend lifecycle -------------------------------------------------------------

    private backendPath(): string {
        const configured = vscode.workspace.getConfiguration('qtDesignerRevamped').get<string>('backendPath', '').trim();
        return configured || path.join(this.context.extensionPath, '..', 'backend', 'build', 'designer_backend');
    }

    private ensureClient(): Promise<BackendClient> {
        if (this.client?.running) {
            return Promise.resolve(this.client);
        }
        if (!this.clientStarting) {
            const exe = this.backendPath();
            if (!fs.existsSync(exe)) {
                return Promise.reject(new Error(`Backend executable not found: ${exe}. Build it (see README) or set qtDesignerRevamped.backendPath.`));
            }
            const pluginPaths = vscode.workspace.getConfiguration('qtDesignerRevamped').get<string[]>('pluginPaths', []).map((p) => p.trim()).filter(Boolean);
            const client = new BackendClient({ executable: exe, pluginPaths });
            client.on('stderr', (text: string) => this.log.trace(String(text).trimEnd()));
            client.on('exit', (code: number | null, signal: string | null) => {
                this.log.warn(`backend exited (code ${code}, signal ${signal})`);
                if (this.client === client) {
                    this.client = undefined;
                }
                this.broadcastAll({ type: 'backendStatus', text: 'The Qt backend stopped. Run "Qt Designer: Restart Backend". Unsaved changes in open editors are lost on restart.' });
            });
            this.clientStarting = client.start().then(({ qt }) => {
                this.log.info(`backend ready, Qt ${qt}`);
                this.client = client;
                this.paletteCache = undefined;
                return client;
            }).finally(() => {
                this.clientStarting = undefined;
            });
        }
        return this.clientStarting;
    }

    /** Restarts the backend and reloads every open document from disk (unsaved edits are discarded). */
    async restartBackend(): Promise<void> {
        const dirty = [...this.documents].filter((d) => d.snapshot?.dirty);
        if (dirty.length > 0) {
            const choice = await vscode.window.showWarningMessage(
                `${dirty.length} document(s) have unsaved changes that a backend restart will discard.`, { modal: true }, 'Restart anyway');
            if (choice !== 'Restart anyway') {
                return;
            }
        }
        this.client?.dispose();
        this.client = undefined;
        for (const doc of this.documents) {
            await this.enqueue(doc, async () => {
                const text = await this.readFile(doc.uri);
                await this.openInBackend(doc, text);
                await this.pushState(doc);
            }).catch((e) => this.reportError(doc, e));
        }
    }

    dispose(): void {
        this.client?.dispose();
    }

    // ---- test hooks (used by test-integration/, not by the UI) ----------------------------

    /** Injects a message as if it came from the editor page and returns the resulting snapshot. */
    async injectMessage(uri: vscode.Uri, msg: WebviewToHost): Promise<Snapshot | undefined> {
        const doc = this.findDocument(uri);
        if (!doc) {
            throw new Error(`no open document for ${uri.toString()}`);
        }
        await this.enqueue(doc, () => this.onWebviewMessage(doc, undefined, msg));
        return doc.snapshot;
    }

    /** Returns the latest snapshot and the properties of an object, as the page would see them. */
    async inspect(uri: vscode.Uri, objectName?: string): Promise<{ snapshot: Snapshot | undefined; properties: PropertiesResult | null }> {
        const doc = this.findDocument(uri);
        const properties = doc && objectName ? await (await this.ensureClient()).request('properties', { docId: doc.docId, name: objectName }) : null;
        return { snapshot: doc?.snapshot, properties };
    }

    /** Palette as the page receives it (test hook). */
    paletteForTest(): Promise<PaletteCategory[]> {
        return this.paletteCategories();
    }

    private findDocument(uri: vscode.Uri): UiDocument | undefined {
        return [...this.documents].find((d) => d.uri.toString() === uri.toString());
    }

    // ---- CustomEditorProvider ----------------------------------------------------------

    async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<UiDocument> {
        const doc = new UiDocument(uri);
        const diskText = await this.readFile(uri);
        doc.diskText = diskText;
        const restoredFromBackup = openContext.backupId !== undefined;
        const text = restoredFromBackup ? await this.readFile(vscode.Uri.parse(openContext.backupId as string)) : diskText;
        try {
            await this.openInBackend(doc, text);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            void vscode.window.showErrorMessage(`Cannot open ${path.basename(uri.fsPath)} in Qt Designer: ${message}`, 'Open as XML Text').then((c) => {
                if (c) {
                    void vscode.commands.executeCommand('vscode.openWith', uri, 'default');
                }
            });
            throw e;
        }
        this.documents.add(doc);
        doc.disposables.push({ dispose: () => this.documents.delete(doc) });
        this.watchExternalChanges(doc);
        if (restoredFromBackup) {
            // Content differs from disk; make VS Code show it as modified (no undo entry).
            queueMicrotask(() => this.changeEmitter.fire({ document: doc }));
        }
        doc.disposables.push({ dispose: () => { void this.closeInBackend(doc); } });
        return doc;
    }

    async resolveCustomEditor(doc: UiDocument, panel: vscode.WebviewPanel): Promise<void> {
        const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
        panel.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
        panel.webview.html = this.html(panel.webview, mediaRoot);
        doc.panels.add(panel);
        panel.onDidDispose(() => doc.panels.delete(panel));
        panel.webview.onDidReceiveMessage((raw: unknown) => {
            const msg = parseWebviewMessage(raw);
            if (!msg) {
                this.log.warn('ignored malformed webview message');
                return;
            }
            void this.enqueue(doc, () => this.onWebviewMessage(doc, panel, msg)).catch(async (e) => {
                this.reportError(doc, e);
                // The page waits for the engine's answer before sending the next live frame: always answer.
                await this.pushState(doc).catch(() => undefined);
            });
        });
    }

    async saveCustomDocument(doc: UiDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        await this.enqueue(doc, async () => {
            await this.writeTo(doc, doc.uri);
            const client = await this.ensureClient();
            doc.snapshot = await client.request('markSaved', { docId: doc.docId });
            await this.pushState(doc);
        });
    }

    async saveCustomDocumentAs(doc: UiDocument, destination: vscode.Uri, _cancellation: vscode.CancellationToken): Promise<void> {
        await this.enqueue(doc, () => this.writeTo(doc, destination, false));
    }

    async revertCustomDocument(doc: UiDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        await this.enqueue(doc, async () => {
            const text = await this.readFile(doc.uri);
            doc.diskText = text;
            await this.openInBackend(doc, text);
            await this.pushState(doc);
        });
    }

    async backupCustomDocument(doc: UiDocument, context: vscode.CustomDocumentBackupContext, _cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        const xml = await this.enqueue(doc, async () => (await (await this.ensureClient()).request('contents', { docId: doc.docId })).xml);
        await vscode.workspace.fs.writeFile(context.destination, encoder.encode(xml));
        return {
            id: context.destination.toString(),
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(context.destination);
                } catch {
                    // already gone
                }
            },
        };
    }

    // ---- document operations -----------------------------------------------------------

    private enqueue<T>(doc: UiDocument, task: () => Promise<T>): Promise<T> {
        const run = doc.queue.then(task, task);
        doc.queue = run.catch(() => undefined);
        return run;
    }

    private async readFile(uri: vscode.Uri): Promise<string> {
        return decoder.decode(await vscode.workspace.fs.readFile(uri));
    }

    private async openInBackend(doc: UiDocument, xml: string): Promise<void> {
        const client = await this.ensureClient();
        if (doc.snapshot) {
            await client.request('close', { docId: doc.docId }).catch(() => undefined);
        }
        doc.snapshot = await client.request('open', { docId: doc.docId, xml, path: doc.uri.scheme === 'file' ? doc.uri.fsPath : undefined });
        doc.selectedName = undefined;
        doc.generation++;
    }

    private async closeInBackend(doc: UiDocument): Promise<void> {
        if (this.client?.running) {
            await this.client.request('close', { docId: doc.docId }).catch(() => undefined);
        }
    }

    /** Writes the engine's XML next to the target and renames it over, so a failure never leaves a half-written .ui. */
    private async writeTo(doc: UiDocument, target: vscode.Uri, updateDiskText = true): Promise<void> {
        const client = await this.ensureClient();
        const { xml, warnings } = await client.request('contents', { docId: doc.docId });
        if (!xml.trimStart().startsWith('<?xml') || !xml.includes('</ui>')) {
            throw new Error('The backend returned an incomplete document; refusing to overwrite the file.');
        }
        if (warnings.length > 0) {
            void vscode.window.showWarningMessage(`Qt Designer reported issues in ${path.basename(target.fsPath)}: ${warnings.join('; ')}`);
        }
        const tmp = target.with({ path: `${target.path}.${randomBytes(4).toString('hex')}.tmp` });
        await vscode.workspace.fs.writeFile(tmp, encoder.encode(xml));
        try {
            await vscode.workspace.fs.rename(tmp, target, { overwrite: true });
        } catch (e) {
            await vscode.workspace.fs.delete(tmp).then(undefined, () => undefined);
            throw e;
        }
        if (updateDiskText) {
            doc.diskText = xml;
        }
    }

    private watchExternalChanges(doc: UiDocument): void {
        if (doc.uri.scheme !== 'file') {
            return;
        }
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(doc.uri.fsPath), path.basename(doc.uri.fsPath)));
        const onChange = () => {
            void this.enqueue(doc, async () => {
                let text: string;
                try {
                    text = await this.readFile(doc.uri);
                } catch {
                    return; // deleted or mid-rename; the next event will tell
                }
                if (text === doc.diskText) {
                    return; // our own save, or a touch without content change
                }
                if (!doc.snapshot?.dirty) {
                    doc.diskText = text;
                    await this.openInBackend(doc, text);
                    await this.pushState(doc);
                    return;
                }
                const choice = await vscode.window.showWarningMessage(
                    `${path.basename(doc.uri.fsPath)} changed on disk and you have unsaved changes in the designer.`,
                    'Reload from Disk (discard my changes)', 'Keep My Version');
                if (choice === 'Reload from Disk (discard my changes)') {
                    doc.diskText = text;
                    await this.openInBackend(doc, text);
                    await this.pushState(doc);
                } else {
                    doc.diskText = text; // do not ask again for this same external version
                }
            }).catch((e) => this.reportError(doc, e));
        };
        doc.disposables.push(watcher, watcher.onDidChange(onChange), watcher.onDidCreate(onChange));
    }

    // ---- webview ----------------------------------------------------------------------

    /**
     * The engine refuses to select the menu bar, tool bars, status bar and central widget of a main window (Designer
     * edits them through its object inspector). They are inspected instead, like layouts.
     */
    private refusedSelection(snapshot: { selection: string[]; objects: { name: string }[] }, wanted: string[]): string | undefined {
        const only = wanted.length === 1 ? wanted[0] : undefined;
        return only !== undefined && !snapshot.selection.includes(only) && snapshot.objects.some((o) => o.name === only) ? only : undefined;
    }

    private async onWebviewMessage(doc: UiDocument, panel: vscode.WebviewPanel | undefined, msg: WebviewToHost): Promise<void> {
        const client = await this.ensureClient();
        const before = doc.snapshot;
        // A page that vanished mid-drag must not leave the document believing a gesture is still open.
        if (doc.gesture && !['setProperty', 'setGeometries', 'reparent', 'selectNames', 'hitSelect', 'view', 'gesture', 'cancelGesture', 'want', 'describe', 'inspect', 'ready'].includes(msg.type)) {
            this.finalizeGesture(doc);
        }
        switch (msg.type) {
            case 'ready':
                if (panel) {
                    await this.pushState(doc, panel);
                }
                return;
            case 'gesture': {
                if (msg.phase === 'begin') {
                    this.finalizeGesture(doc);
                    doc.gesture = { baseIndex: doc.snapshot?.undoIndex ?? 0 };
                    doc.snapshot = await client.request('gesture', { docId: doc.docId, phase: 'begin', label: msg.label });
                    return; // the page does not wait for an answer to the start of a gesture
                }
                doc.snapshot = await client.request('gesture', { docId: doc.docId, phase: 'end', label: msg.label });
                this.finalizeGesture(doc); // the only place a drag is reported to VS Code
                await this.pushState(doc);
                return;
            }
            case 'setGeometries':
                doc.snapshot = await client.request('setGeometries', { docId: doc.docId, items: msg.items });
                break;
            case 'makeSubmenu':
                doc.snapshot = await client.request('makeSubmenu', { docId: doc.docId, menu: msg.menu, index: msg.index });
                break;
            case 'addMenu':
                doc.snapshot = await client.request('addMenu', { docId: doc.docId, title: msg.title });
                break;
            case 'addMenuEntry':
                doc.snapshot = await client.request('addMenuEntry', { docId: doc.docId, menu: msg.menu, text: msg.text, separator: msg.separator });
                break;
            case 'addAction':
                doc.snapshot = await client.request('addAction', { docId: doc.docId, text: msg.text, checkable: msg.checkable, shortcut: msg.shortcut });
                break;
            case 'useAction':
                doc.snapshot = await client.request('useAction', { docId: doc.docId, target: msg.target, action: msg.action, separator: msg.separator, remove: msg.remove });
                break;
            case 'setCustomMethods':
                doc.snapshot = await client.request('setCustomMethods', { docId: doc.docId, slots: msg.slots, signals: msg.signals });
                break;
            case 'removeAction':
                doc.snapshot = await client.request('removeAction', { docId: doc.docId, name: msg.name });
                break;
            case 'removeMenuEntry':
                doc.snapshot = await client.request('removeMenuEntry', { docId: doc.docId, menu: msg.menu, index: msg.index });
                break;
            case 'taskAction':
                doc.snapshot = await client.request('taskAction', { docId: doc.docId, name: msg.name, text: msg.text, path: msg.path });
                break;
            case 'setContents':
                doc.snapshot = await client.request('setContents', { docId: doc.docId, name: msg.name, contents: msg.contents });
                break;
            case 'setItems':
                doc.snapshot = await client.request('setItems', { docId: doc.docId, name: msg.name, items: msg.items });
                break;
            case 'moveWidget':
                doc.snapshot = await client.request('moveWidget', { docId: doc.docId, name: msg.name, x: msg.x, y: msg.y, side: msg.side, grabX: msg.grabX, grabY: msg.grabY });
                break;
            case 'reparent':
                doc.snapshot = await client.request('reparent', { docId: doc.docId, parent: msg.parent, items: msg.items });
                break;
            case 'pageOp':
                doc.snapshot = await client.request('pageOp', { docId: doc.docId, name: msg.name, op: msg.op });
                break;
            case 'setCurrentPage':
                doc.snapshot = await client.request('setCurrentPage', { docId: doc.docId, name: msg.name, index: msg.index });
                break;
            case 'setTabOrder':
                doc.snapshot = await client.request('setTabOrder', { docId: doc.docId, order: msg.order });
                break;
            case 'promote':
                doc.snapshot = await client.request('promote', { docId: doc.docId, names: msg.names, className: msg.className, include: msg.include });
                break;
            case 'demote':
                doc.snapshot = await client.request('demote', { docId: doc.docId, name: msg.name });
                break;
            case 'setFormInfo':
                doc.snapshot = await client.request('setFormInfo', { docId: doc.docId, info: msg.info });
                break;
            case 'addDynamicProperty':
                doc.snapshot = await client.request('addDynamicProperty', { docId: doc.docId, name: msg.name, property: msg.property, kind: msg.kind, value: msg.value });
                break;
            case 'removeDynamicProperty':
                doc.snapshot = await client.request('removeDynamicProperty', { docId: doc.docId, name: msg.name, property: msg.property });
                break;
            case 'connect':
                doc.snapshot = await client.request('connect', { docId: doc.docId, sender: msg.sender, signal: msg.signal, receiver: msg.receiver, slot: msg.slot });
                break;
            case 'disconnect':
                doc.snapshot = await client.request('disconnect', { docId: doc.docId, sender: msg.sender, signal: msg.signal, receiver: msg.receiver, slot: msg.slot });
                break;
            case 'want':
                doc.wants = { tabOrder: msg.tabOrder, formInfo: msg.formInfo };
                break;
            case 'undo':
            case 'redo':
                for (let i = 0; i < (msg.steps ?? 1); i++) {
                    await vscode.commands.executeCommand(msg.type);
                }
                return;
            case 'history': {
                const h = await client.request('history', { docId: doc.docId });
                this.post(doc, panel, { type: 'history', items: h.items, index: h.index });
                return;
            }
            case 'restartBackend':
                await this.restartBackend();
                return;
            case 'describe': {
                const result = await client.request('describe', { docId: doc.docId, name: msg.name }).catch(() => null);
                this.post(doc, panel, { type: 'describeResult', name: msg.name, result });
                return;
            }
            case 'previewStop':
                await client.request('previewStop', { docId: doc.docId }).catch(() => undefined);
                return;
            case 'previewEvent': {
                const { type: _t, ...input } = msg;
                const result = await client.request('previewEvent', { docId: doc.docId, ...input });
                this.post(doc, panel, { type: 'previewFrame', result });
                return;
            }
            case 'preview': {
                const result = await client.request('preview', { docId: doc.docId, style: msg.style, dark: msg.dark, scale: msg.scale });
                this.post(doc, panel, { type: 'preview', result, style: msg.style, dark: msg.dark });
                return;
            }
            case 'pickFile': {
                const picked = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    defaultUri: vscode.Uri.joinPath(doc.uri, '..'),
                    filters: { Images: ['png', 'jpg', 'jpeg', 'svg', 'ico', 'gif', 'bmp', 'webp'] },
                    openLabel: 'Use image',
                });
                const file = picked?.[0];
                if (!file || file.scheme !== 'file') {
                    return;
                }
                doc.snapshot = await client.request('setProperty', { docId: doc.docId, name: msg.name, property: msg.property, value: file.fsPath });
                break;
            }
            case 'pickResource': {
                const picked = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    defaultUri: vscode.Uri.joinPath(doc.uri, '..'),
                    filters: { 'Qt resource files': ['qrc'] },
                    openLabel: 'Use resource file',
                });
                const file = picked?.[0];
                if (!file || file.scheme !== 'file') {
                    return;
                }
                doc.snapshot = await client.request('addResource', { docId: doc.docId, path: file.fsPath });
                break;
            }
            case 'removeResource':
                doc.snapshot = await client.request('removeResource', { docId: doc.docId, path: msg.path });
                break;
            case 'findInCode':
                await vscode.commands.executeCommand('workbench.action.findInFiles', { query: msg.query, triggerSearch: true, isRegex: false, matchWholeWord: false, isCaseSensitive: true });
                return;
            case 'saveImage': {
                // The runtime render (no grid, no handles) at twice the size, like Designer's "Save Form as Image".
                let png: Buffer;
                try {
                    const r = await client.request('preview', { docId: doc.docId, scale: 2 });
                    png = Buffer.from(r.png, 'base64');
                } finally {
                    await client.request('previewStop', { docId: doc.docId }).catch(() => undefined);
                }
                const base = doc.uri.path.replace(/^.*\//, '').replace(/\.ui$/i, '') || 'form';
                const target = await vscode.window.showSaveDialog({
                    defaultUri: doc.uri.scheme === 'file' ? vscode.Uri.file(doc.uri.fsPath.replace(/\.ui$/i, '') + '.png') : undefined,
                    saveLabel: 'Save form image',
                    filters: { 'PNG image': ['png'] },
                    title: `Save ${base} as an image`,
                });
                if (target) {
                    await vscode.workspace.fs.writeFile(target, png);
                    vscode.window.setStatusBarMessage(`Saved ${target.fsPath}`, 3000);
                }
                return;
            }
            case 'copyText':
                await vscode.env.clipboard.writeText(msg.text);
                vscode.window.setStatusBarMessage(`Copied: ${msg.text.length > 60 ? msg.text.slice(0, 57) + '...' : msg.text}`, 2500);
                return;
            case 'cancelGesture': {
                const g = doc.gesture;
                doc.gesture = undefined;
                doc.snapshot = await client.request('gesture', { docId: doc.docId, phase: 'end', label: '' });
                if (g && doc.snapshot.undoIndex > g.baseIndex) {
                    doc.snapshot = await client.request('undo', { docId: doc.docId }); // never shown to VS Code: nothing to redo
                }
                break;
            }
            case 'view':
                doc.snapshot = await client.request('view', { docId: doc.docId, scale: msg.scale });
                break;
            case 'inspect':
                doc.inspectName = msg.name ?? undefined;
                await this.pushState(doc);
                return;
            case 'hitSelect': {
                doc.inspectName = undefined;
                const { name } = await client.request('hitTest', { docId: doc.docId, x: msg.x, y: msg.y });
                doc.snapshot = await client.request('select', { docId: doc.docId, names: name ? [name] : [] });
                doc.selectedName = name ?? undefined;
                doc.inspectName = this.refusedSelection(doc.snapshot, name ? [name] : []);
                break;
            }
            case 'selectNames':
                doc.inspectName = undefined;
                doc.snapshot = await client.request('select', { docId: doc.docId, names: msg.names });
                doc.selectedName = msg.names[0];
                doc.inspectName = this.refusedSelection(doc.snapshot, msg.names);
                break;
            case 'setProperty':
                doc.snapshot = await client.request('setProperty', { docId: doc.docId, name: msg.name, property: msg.property, value: msg.value });
                break;
            case 'resetProperty':
                doc.snapshot = await client.request('resetProperty', { docId: doc.docId, name: msg.name, property: msg.property });
                break;
            case 'addWidget':
                doc.snapshot = await client.request('addWidget', { docId: doc.docId, category: msg.category, index: msg.index, x: msg.x, y: msg.y, side: msg.side });
                break;
            case 'action':
                doc.snapshot = await client.request('action', { docId: doc.docId, action: msg.action });
                break;
        }
        if (!doc.gesture) {
            this.recordEdit(doc, before, doc.snapshot);
        }
        await this.pushState(doc);
    }

    /** Ends the bookkeeping of a drag: one VS Code undo entry if it changed anything. */
    private finalizeGesture(doc: UiDocument): void {
        const g = doc.gesture;
        doc.gesture = undefined;
        if (g && doc.snapshot) {
            this.recordEdit(doc, { ...doc.snapshot, undoIndex: g.baseIndex }, doc.snapshot);
        }
    }

    /** Registers one VS Code undo entry per new backend undo-stack command (merged commands add none). */
    private recordEdit(doc: UiDocument, before: Snapshot | undefined, after: Snapshot | undefined): void {
        if (!before || !after || after.undoIndex <= before.undoIndex) {
            return;
        }
        this.changeEmitter.fire({
            document: doc,
            label: after.undoText || 'Edit',
            undo: () => this.stepHistory(doc, 'undo'),
            redo: () => this.stepHistory(doc, 'redo'),
        });
    }

    private stepHistory(doc: UiDocument, direction: 'undo' | 'redo'): Promise<void> {
        return this.enqueue(doc, async () => {
            const client = await this.ensureClient();
            doc.snapshot = await client.request(direction, { docId: doc.docId });
            await this.pushState(doc);
        });
    }

    private async pushState(doc: UiDocument, only?: vscode.WebviewPanel): Promise<void> {
        const snapshot = doc.snapshot;
        if (!snapshot) {
            return;
        }
        let name = doc.selectedName;
        if (snapshot.selection.length > 0) {
            name = snapshot.selection[0];
            doc.selectedName = name;
        } else {
            name = undefined;
        }
        if (doc.inspectName) {
            name = doc.inspectName;
        }
        let properties: PropertiesResult | null = null;
        if (name) {
            const client = await this.ensureClient();
            properties = await client.request('properties', { docId: doc.docId, name }).catch(() => null);
        }
        const client = await this.ensureClient();
        const code: DescribeResult | null = name ? await client.request('describe', { docId: doc.docId, name }).catch(() => null) : null;
        let connections: ConnectionInfo[] = doc.connectionCache && doc.connectionCache.index === snapshot.undoIndex && doc.connectionCache.generation === doc.generation ? doc.connectionCache.value : [];
        if (!doc.connectionCache || doc.connectionCache.index !== snapshot.undoIndex || doc.connectionCache.generation !== doc.generation) {
            connections = (await client.request('connections', { docId: doc.docId }).catch(() => ({ connections: [] as ConnectionInfo[] }))).connections;
            doc.connectionCache = { index: snapshot.undoIndex, generation: doc.generation, value: connections };
        }
        let container: ContainerInfo | null = null;
        if (name) {
            const info = await client.request('containerInfo', { docId: doc.docId, name }).catch(() => null);
            container = info && info.current >= 0 ? info : null;
        }
        const tabOrder = doc.wants.tabOrder ? (await client.request('tabOrder', { docId: doc.docId }).catch(() => ({ order: [] as string[] }))).order : undefined;
        const formInfo: FormInfo | undefined = doc.wants.formInfo ? await client.request('formInfo', { docId: doc.docId }).catch(() => undefined) : undefined;
        const notices = snapshot.messages ?? [];
        delete snapshot.messages; // one-shot: shown once, not replayed to panels opened later
        const { categories: palette, fonts, locales } = await this.paletteData();
        const message: HostToWebview = { type: 'state', snapshot, properties, propertiesFor: name ?? null, palette, fonts, locales, notices, code, connections, container, ...(tabOrder ? { tabOrder } : {}), ...(formInfo ? { formInfo } : {}) };
        for (const p of only ? [only] : doc.panels) {
            void p.webview.postMessage(message);
        }
    }

    private paletteCache: { categories: PaletteCategory[]; fonts: string[]; locales: LocaleChoices } | undefined;

    private async paletteData(): Promise<{ categories: PaletteCategory[]; fonts: string[]; locales: LocaleChoices }> {
        if (!this.paletteCache) {
            this.paletteCache = await (await this.ensureClient()).request('palette', {});
        }
        return this.paletteCache;
    }

    private async paletteCategories(): Promise<PaletteCategory[]> {
        return (await this.paletteData()).categories;
    }

    private post(doc: UiDocument, panel: vscode.WebviewPanel | undefined, message: HostToWebview): void {
        for (const p of panel ? [panel] : doc.panels) {
            void p.webview.postMessage(message);
        }
    }

    private broadcastAll(message: HostToWebview): void {
        for (const doc of this.documents) {
            for (const p of doc.panels) {
                void p.webview.postMessage(message);
            }
        }
    }

    private reportError(doc: UiDocument, e: unknown): void {
        const message = e instanceof Error ? e.message : String(e);
        this.log.error(message);
        for (const p of doc.panels) {
            void p.webview.postMessage({ type: 'error', message } satisfies HostToWebview);
        }
    }

    private html(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
        const nonce = randomBytes(16).toString('base64');
        const script = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'webview', 'main.js'));
        const style = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'editor.css'));
        const codicons = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'codicons', 'codicon.css'));
        const csp = [
            "default-src 'none'",
            `style-src ${webview.cspSource}`,
            `font-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`,
            'img-src data:',
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${codicons}" rel="stylesheet">
<link href="${style}" rel="stylesheet">
<title>Qt Designer</title>
</head>
<body>
${pageBody()}
<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
    }
}
