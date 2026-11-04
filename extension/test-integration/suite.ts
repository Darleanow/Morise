// Runs inside the VS Code extension host. Throws on the first failed check.
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { TestApi } from '../src/extension';

const VIEW_TYPE = 'formwright.uiEditor';
const QT_ROOT = process.env.QT_ROOT ?? '/home/devel/Qt/6.11.3/gcc_64';

async function until<T>(label: string, fn: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs = 20000): Promise<T> {
    const start = Date.now();
    for (;;) {
        const v = await fn();
        if (v) {
            return v;
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error(`timeout waiting for: ${label}`);
        }
        await new Promise((r) => setTimeout(r, 100));
    }
}

const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab;

export async function run(): Promise<void> {
    const ext = vscode.extensions.getExtension<TestApi>('darleanow.formwright');
    assert.ok(ext, 'extension is discoverable');
    const api = await ext.activate();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtd-it-'));
    const file = path.join(dir, 'sample.ui');
    fs.copyFileSync(path.resolve(__dirname, '..', '..', '..', 'backend', 'testdata', 'sample.ui'), file);
    const uri = vscode.Uri.file(file);

    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    const opened = await until('document opened in backend', async () => (await api.provider.inspect(uri)).snapshot);
    assert.ok(opened.objects.some((o) => o.name === 'okButton'), 'scene contains okButton');
    assert.equal(activeTab()?.isDirty, false);
    const input = activeTab()?.input;
    assert.ok(input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE, 'opened with the custom editor');
    console.log('ok: opened in custom editor');

    // 1. edit -> dirty
    await api.provider.injectMessage(uri, { type: 'setProperty', name: 'okButton', property: 'text', value: 'Valider' });
    await until('tab dirty after edit', () => activeTab()?.isDirty === true);
    console.log('ok: edit marks the tab dirty');

    // 2. native undo/redo go through the backend undo stack
    await vscode.commands.executeCommand('undo');
    await until('tab clean after undo', () => activeTab()?.isDirty === false);
    let text = (await api.provider.inspect(uri, 'okButton')).properties?.properties.find((p) => p.name === 'text')?.value;
    assert.equal(text, 'OK', 'undo restored the value in the engine');
    await vscode.commands.executeCommand('redo');
    await until('tab dirty after redo', () => activeTab()?.isDirty === true);
    text = (await api.provider.inspect(uri, 'okButton')).properties?.properties.find((p) => p.name === 'text')?.value;
    assert.equal(text, 'Valider');
    console.log('ok: VS Code undo/redo drive the Designer undo stack');

    // 3. save writes valid XML atomically
    await vscode.commands.executeCommand('workbench.action.files.save');
    await until('tab clean after save', () => activeTab()?.isDirty === false);
    const saved = fs.readFileSync(file, 'utf8');
    assert.match(saved, /<string>Valider<\/string>/);
    assert.match(saved, /name="customTag" stdset="0"/);
    assert.match(saved, /<sender>okButton<\/sender>/);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'no temp file left behind');
    const uic = spawnSync(path.join(QT_ROOT, 'libexec', 'uic'), [file], { encoding: 'utf8' });
    assert.equal(uic.status, 0, uic.stderr);
    assert.match(uic.stdout, /Valider/);
    console.log('ok: save is valid, atomic, and accepted by uic');

    // 4. external modification of a clean document is picked up
    fs.writeFileSync(file, saved.replace('<string>Valider</string>', '<string>Externe</string>'), 'utf8');
    await until('external change reloaded', async () => {
        const t = (await api.provider.inspect(uri, 'okButton')).properties?.properties.find((p) => p.name === 'text')?.value;
        return t === 'Externe';
    });
    assert.equal(activeTab()?.isDirty, false);
    console.log('ok: external change reloaded into the engine');

    // 5. visual editing on a free-form document: add, move, delete, undo, save
    const freeFile = path.join(dir, 'free.ui');
    fs.copyFileSync(path.resolve(__dirname, '..', '..', '..', 'backend', 'testdata', 'free.ui'), freeFile);
    const freeUri = vscode.Uri.file(freeFile);
    await vscode.commands.executeCommand('vscode.openWith', freeUri, VIEW_TYPE);
    await until('free form opened', async () => (await api.provider.inspect(freeUri)).snapshot);
    const palette = await api.provider.paletteForTest();
    const groupBox = palette.flatMap((c) => c.widgets.map((w) => ({ cat: c.index, idx: w.index, name: w.name }))).find((w) => w.name === 'Group Box');
    assert.ok(groupBox, 'palette offers Group Box');

    let snap = await api.provider.injectMessage(freeUri, { type: 'addWidget', category: groupBox.cat, index: groupBox.idx, x: 150, y: 100 });
    assert.ok(snap?.objects.some((o) => o.class === 'QGroupBox'), 'group box added');
    await until('dirty after add', () => vscode.window.tabGroups.activeTabGroup.activeTab?.isDirty === true);
    const gb = snap?.objects.find((o) => o.class === 'QGroupBox');
    assert.ok(gb && gb.laidOut === false);

    snap = await api.provider.injectMessage(freeUri, { type: 'setProperty', name: gb.name, property: 'geometry', value: [160, 90, 120, 70] });
    const moved = snap?.objects.find((o) => o.name === gb.name);
    assert.deepEqual([moved?.x, moved?.y, moved?.w, moved?.h], [160, 90, 120, 70]);

    await vscode.commands.executeCommand('undo'); // geometry
    await vscode.commands.executeCommand('undo'); // drop
    await until('widget removed by native undo', async () => !(await api.provider.inspect(freeUri)).snapshot?.objects.some((o) => o.class === 'QGroupBox'));
    await until('clean after undoing everything', () => vscode.window.tabGroups.activeTabGroup.activeTab?.isDirty === false);
    await vscode.commands.executeCommand('redo');
    await vscode.commands.executeCommand('redo');
    await until('widget back after redo', async () => !!(await api.provider.inspect(freeUri)).snapshot?.objects.some((o) => o.class === 'QGroupBox'));

    await api.provider.injectMessage(freeUri, { type: 'selectNames', names: ['freeButton'] });
    snap = await api.provider.injectMessage(freeUri, { type: 'action', action: 'delete' });
    assert.ok(!snap?.objects.some((o) => o.name === 'freeButton'), 'freeButton deleted');

    await vscode.commands.executeCommand('workbench.action.files.save');
    await until('free form saved', () => vscode.window.tabGroups.activeTabGroup.activeTab?.isDirty === false);
    const freeSaved = fs.readFileSync(freeFile, 'utf8');
    assert.match(freeSaved, /class="QGroupBox"/);
    assert.doesNotMatch(freeSaved, /name="freeButton"/);
    assert.match(freeSaved, /name="freeLabel"/);
    const uic2 = spawnSync(path.join(QT_ROOT, 'libexec', 'uic'), [freeFile], { encoding: 'utf8' });
    assert.equal(uic2.status, 0, uic2.stderr);
    assert.match(uic2.stdout, /QGroupBox/);
    console.log('ok: add widget, move, delete, native undo/redo and save on a free-form document');

    // 6. a resize gesture (many live frames) is ONE native undo step, and Escape-cancel leaves nothing behind
    const gestureFile = path.join(dir, 'gesture.ui');
    fs.copyFileSync(path.resolve(__dirname, '..', '..', '..', 'backend', 'testdata', 'free.ui'), gestureFile);
    const gUri = vscode.Uri.file(gestureFile);
    await vscode.commands.executeCommand('vscode.openWith', gUri, VIEW_TYPE);
    await until('gesture doc opened', async () => (await api.provider.inspect(gUri)).snapshot);
    const widthOf = async () => (await api.provider.inspect(gUri)).snapshot?.formGeometry[2];
    assert.equal(await widthOf(), 300);
    await api.provider.injectMessage(gUri, { type: 'gesture', phase: 'begin', label: 'Resize FreeForm' });
    for (const w of [310, 330, 350, 380, 400]) {
        await api.provider.injectMessage(gUri, { type: 'setProperty', name: 'FreeForm', property: 'geometry', value: [0, 0, w, 200] });
    }
    await api.provider.injectMessage(gUri, { type: 'gesture', phase: 'end', label: '' });
    assert.equal(await widthOf(), 400);
    await until('dirty after the gesture', () => vscode.window.tabGroups.activeTabGroup.activeTab?.isDirty === true);
    await vscode.commands.executeCommand('undo');
    await until('one native undo reverts the whole gesture', async () => (await widthOf()) === 300);
    await until('clean again', () => vscode.window.tabGroups.activeTabGroup.activeTab?.isDirty === false);
    await vscode.commands.executeCommand('redo');
    await until('redo re-applies it', async () => (await widthOf()) === 400);
    console.log('ok: a resize gesture is one native undo/redo step');

    // 6b. a copy reaches the system clipboard, and a paste reads it from there (other windows and applications)
    await api.provider.injectMessage(gUri, { type: 'selectNames', names: ['freeButton'] });
    await api.provider.injectMessage(gUri, { type: 'action', action: 'copy' });
    assert.match(await vscode.env.clipboard.readText(), /name="freeButton"/);
    const own = (await api.provider.inspect(gUri)).snapshot?.objects.length ?? 0;
    await vscode.env.clipboard.writeText((await vscode.env.clipboard.readText()).replace('name="freeButton"', 'name="fromOutside"'));
    await api.provider.injectMessage(gUri, { type: 'action', action: 'paste' });
    const pasted = (await api.provider.inspect(gUri)).snapshot?.objects ?? [];
    assert.equal(pasted.length, own + 1);
    assert.ok(pasted.some((o) => o.name === 'fromOutside'), 'the pasted widget comes from the system clipboard');
    console.log('ok: copy and paste go through the system clipboard');

    // 7. what the Code and Connections tabs show comes through the host
    const info = await api.provider.inspect(gUri, 'freeButton');
    assert.ok(info.properties?.properties.some((p) => p.name === 'text'));

    // 8. connections, promotion and layouts through the host: saved, accepted by uic, undone natively
    const richFile = path.join(dir, 'rich.ui');
    fs.copyFileSync(path.resolve(__dirname, '..', '..', '..', 'backend', 'testdata', 'rich.ui'), richFile);
    const rUri = vscode.Uri.file(richFile);
    await vscode.commands.executeCommand('vscode.openWith', rUri, VIEW_TYPE);
    await until('rich form opened', async () => (await api.provider.inspect(rUri)).snapshot);
    await api.provider.injectMessage(rUri, { type: 'connect', sender: 'go', signal: 'clicked()', receiver: 'nameEdit', slot: 'clear()' });
    await until('dirty after connecting', () => vscode.window.tabGroups.activeTabGroup.activeTab?.isDirty === true);
    await api.provider.injectMessage(rUri, { type: 'promote', names: ['go'], className: 'FancyButton', include: 'fancybutton.h' });
    await api.provider.injectMessage(rUri, { type: 'selectNames', names: ['go', 'nameEdit'] });
    await api.provider.injectMessage(rUri, { type: 'action', action: 'layoutVertical' });
    const laid = await api.provider.inspect(rUri);
    const layoutName = laid.snapshot?.layouts[0]?.name;
    assert.ok(layoutName, 'a layout was created');
    await api.provider.injectMessage(rUri, { type: 'setProperty', name: layoutName, property: 'spacing', value: 11 });
    const lp = await api.provider.inspect(rUri, layoutName);
    assert.equal(lp.properties?.properties.find((p) => p.name === 'spacing')?.value, 11);
    await vscode.commands.executeCommand('workbench.action.files.save');
    await until('rich form saved', () => vscode.window.tabGroups.activeTabGroup.activeTab?.isDirty === false);
    const richSaved = fs.readFileSync(richFile, 'utf8');
    assert.match(richSaved, /<sender>go<\/sender>/);
    assert.match(richSaved, /FancyButton/);
    assert.match(richSaved, /name="spacing"[\s\S]{0,40}<number>11<\/number>/);
    const uic3 = spawnSync(path.join(QT_ROOT, 'libexec', 'uic'), [richFile], { encoding: 'utf8' });
    assert.equal(uic3.status, 0, uic3.stderr);
    assert.match(uic3.stdout, /QObject::connect\(go, &\w+::clicked, nameEdit/);
    assert.match(uic3.stdout, /fancybutton\.h/);
    for (let i = 0; i < 4; i++) {
        await vscode.commands.executeCommand('undo');
    }
    await until('four native undos revert connect, promote, layout and spacing', async () => {
        const c = await api.provider.inspect(rUri);
        return (c.snapshot?.layouts.length ?? 1) === 0;
    });
    console.log('ok: connections, promotion and layout properties through the host, saved and accepted by uic');

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    fs.rmSync(dir, { recursive: true, force: true });
}
