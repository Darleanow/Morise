import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { BackendClient, bundledPluginPath } from '../src/backendClient';
import { parseWebviewMessage } from '../src/messages';

const root = path.resolve(__dirname, '..', '..', '..');
const exe = path.join(root, 'backend', 'build', 'designer_backend');
const sample = fs.readFileSync(path.join(root, 'backend', 'testdata', 'sample.ui'), 'utf8');

describe('BackendClient against the real designer_backend', () => {
    const client = new BackendClient({ executable: exe, requestTimeoutMs: 20000 });
    before(async () => {
        process.env.QT_SCALE_FACTOR = '1.75'; // hostile on purpose: the client must strip it
        const { qt } = await client.start();
        assert.match(qt, /^6\./);
    });
    after(() => client.dispose());

    it('opens a form and reports 1:1 scene geometry', async () => {
        const s = await client.request('open', { docId: 'a', xml: sample });
        assert.equal(s.dpr, 1);
        assert.deepEqual(s.objects.find((o) => o.name === 'SampleForm') && { w: s.objects[0]?.w, h: s.objects[0]?.h }, { w: 320, h: 200 });
        assert.equal(s.dirty, false);
    });

    it('edits through one undo-stack command and tracks the index', async () => {
        const before = await client.request('snapshot', { docId: 'a' });
        const after1 = await client.request('setProperty', { docId: 'a', name: 'okButton', property: 'text', value: 'A' });
        assert.equal(after1.undoIndex, before.undoIndex + 1);
        assert.equal(after1.dirty, true);
        // Designer merges consecutive edits of the same property: the index must NOT advance again.
        const after2 = await client.request('setProperty', { docId: 'a', name: 'okButton', property: 'text', value: 'AB' });
        assert.equal(after2.undoIndex, after1.undoIndex);
        const undone = await client.request('undo', { docId: 'a' });
        assert.equal(undone.dirty, false);
        const props = await client.request('properties', { docId: 'a', name: 'okButton' });
        assert.equal(props.properties.find((p) => p.name === 'text')?.value, 'OK');
    });

    it('renders at the requested density while keeping logical coordinates', async () => {
        const one = await client.request('snapshot', { docId: 'a' });
        const two = await client.request('view', { docId: 'a', scale: 2 });
        assert.equal(two.dpr, 2);
        assert.equal(two.width, one.width);
        const png = Buffer.from(two.png, 'base64');
        assert.equal(png.readUInt32BE(16), two.width * 2);
        assert.equal(png.readUInt32BE(20), two.height * 2);
        await client.request('view', { docId: 'a', scale: 1 });
    });

    it('reports layouts with their owner, kind and rectangle', async () => {
        const s = await client.request('snapshot', { docId: 'a' });
        const l = s.layouts.find((x) => x.owner === 'SampleForm');
        assert.ok(l, 'form layout reported');
        assert.equal(l.kind, 'QVBoxLayout');
        assert.ok(l.w > 0 && l.h > 0);
    });

    it('rejects bad requests without dying', async () => {
        await assert.rejects(client.request('properties', { docId: 'nope', name: 'x' }), /unknown docId/);
        await assert.rejects(client.request('open', { docId: 'bad', xml: '<ui><broken' }));
        const s = await client.request('snapshot', { docId: 'a' });
        assert.ok(s.png.length > 100);
    });

    it('serialises to XML that keeps unknown-to-UI data', async () => {
        await client.request('setProperty', { docId: 'a', name: 'okButton', property: 'text', value: 'Valider' });
        const { xml } = await client.request('contents', { docId: 'a' });
        assert.match(xml, /<string>Valider<\/string>/);
        assert.match(xml, /name="customTag" stdset="0"/);
        assert.match(xml, /<sender>okButton<\/sender>/);
    });
});

describe('BackendClient failure handling', () => {
    it('rejects start() for a missing executable', async () => {
        const c = new BackendClient({ executable: '/nonexistent/designer_backend' });
        await assert.rejects(c.start());
    });

    it('rejects pending requests when the process dies', async () => {
        const c = new BackendClient({ executable: exe, requestTimeoutMs: 20000 });
        await c.start();
        const exited = new Promise((r) => c.once('exit', r));
        const pending = c.request('open', { docId: 'x', xml: sample });
        process.kill((c as unknown as { proc: { pid: number } }).proc.pid, 'SIGKILL');
        await assert.rejects(pending, /exited/);
        await exited;
        await assert.rejects(c.request('snapshot', { docId: 'x' }), /not running/);
    });
});

describe('parseWebviewMessage', () => {
    it('accepts well-formed messages', () => {
        assert.deepEqual(parseWebviewMessage({ type: 'hitSelect', x: 1, y: 2 }), { type: 'hitSelect', x: 1, y: 2 });
        assert.deepEqual(parseWebviewMessage({ type: 'selectNames', names: ['a'] }), { type: 'selectNames', names: ['a'] });
        assert.deepEqual(parseWebviewMessage({ type: 'addWidget', category: 1, index: 2, x: 3, y: 4 }), { type: 'addWidget', category: 1, index: 2, x: 3, y: 4 });
        assert.deepEqual(parseWebviewMessage({ type: 'action', action: 'delete' }), { type: 'action', action: 'delete' });
        assert.deepEqual(parseWebviewMessage({ type: 'view', scale: 99 }), { type: 'view', scale: 4 });
        assert.deepEqual(parseWebviewMessage({ type: 'gesture', phase: 'begin', label: 'Resize x' }), { type: 'gesture', phase: 'begin', label: 'Resize x' });
        assert.deepEqual(parseWebviewMessage({ type: 'findInCode', query: 'ui->ok' }), { type: 'findInCode', query: 'ui->ok' });
        assert.deepEqual(parseWebviewMessage({ type: 'copyText', text: 'x' }), { type: 'copyText', text: 'x' });
        assert.deepEqual(parseWebviewMessage({ type: 'saveImage' }), { type: 'saveImage' });
        assert.deepEqual(parseWebviewMessage({ type: 'addAction', text: 'Save', checkable: true }), { type: 'addAction', text: 'Save', checkable: true });
        assert.equal(parseWebviewMessage({ type: 'addAction', text: '  ' }), undefined);
        assert.deepEqual(parseWebviewMessage({ type: 'useAction', target: 'menuFile', action: 'actionNew', remove: true }), { type: 'useAction', target: 'menuFile', action: 'actionNew', remove: true });
        assert.equal(parseWebviewMessage({ type: 'useAction', target: 'menuFile' }), undefined);
        assert.deepEqual(parseWebviewMessage({ type: 'actionGroup', name: 'g' }), { type: 'actionGroup', name: 'g' });
        assert.deepEqual(parseWebviewMessage({ type: 'actionGroup', name: 'g', remove: true }), { type: 'actionGroup', name: 'g', remove: true });
        assert.deepEqual(parseWebviewMessage({ type: 'actionGroup', action: 'a', group: '' }), { type: 'actionGroup', action: 'a', group: '' });
        assert.equal(parseWebviewMessage({ type: 'actionGroup', action: 'a' }), undefined);
        assert.equal(parseWebviewMessage({ type: 'actionGroup' }), undefined);
        assert.deepEqual(parseWebviewMessage({ type: 'cancelGesture' }), { type: 'cancelGesture' });
        const items = [{ name: 'a', rect: [1, 2, 3, 4] }];
        assert.deepEqual(parseWebviewMessage({ type: 'setGeometries', items }), { type: 'setGeometries', items });
        assert.deepEqual(parseWebviewMessage({ type: 'reparent', parent: 'box', items }), { type: 'reparent', parent: 'box', items });
        assert.deepEqual(parseWebviewMessage({ type: 'setProperty', name: 'a', names: ['a', 'b'], property: 'x', value: 1 }), { type: 'setProperty', name: 'a', names: ['a', 'b'], property: 'x', value: 1 });
        assert.deepEqual(parseWebviewMessage({ type: 'preview', style: 'Fusion', dark: true, scale: 9 }), { type: 'preview', style: 'Fusion', dark: true, scale: 4 });
        assert.deepEqual(parseWebviewMessage({ type: 'pageOp', name: 't', op: 'addAfter' }), { type: 'pageOp', name: 't', op: 'addAfter' });
        assert.deepEqual(parseWebviewMessage({ type: 'setTabOrder', order: ['a', 'b'] }), { type: 'setTabOrder', order: ['a', 'b'] });
        assert.deepEqual(parseWebviewMessage({ type: 'promote', names: ['a'], className: 'Fancy', include: 'fancy.h' }), { type: 'promote', names: ['a'], className: 'Fancy', include: 'fancy.h' });
        assert.deepEqual(parseWebviewMessage({ type: 'connect', sender: 'a', signal: 's()', receiver: 'b', slot: 't()' }), { type: 'connect', sender: 'a', signal: 's()', receiver: 'b', slot: 't()' });
        assert.deepEqual(parseWebviewMessage({ type: 'inspect', name: null }), { type: 'inspect', name: null });
        assert.deepEqual(parseWebviewMessage({ type: 'want', tabOrder: true, formInfo: false }), { type: 'want', tabOrder: true, formInfo: false });
        assert.deepEqual(parseWebviewMessage({ type: 'undo' }), { type: 'undo' });
        assert.deepEqual(parseWebviewMessage({ type: 'undo', steps: 3 }), { type: 'undo', steps: 3 });
        assert.deepEqual(parseWebviewMessage({ type: 'history' }), { type: 'history' });
        assert.deepEqual(parseWebviewMessage({ type: 'restartBackend' }), { type: 'restartBackend' });
    });
    it('rejects malformed messages', () => {
        for (const bad of [null, 'x', 5, {}, { type: 'hitSelect', x: 'a', y: 1 }, { type: 'selectNames', names: [1] },
            { type: 'setProperty', name: 1, property: 'x' }, { type: 'unknown' }, { type: 'action', action: 'rm -rf' },
            { type: 'setGeometries', items: [{ name: 'a', rect: [1, 2, 3] }] }, { type: 'setGeometries', items: [{ name: 'a', rect: [1, 2, 3, NaN] }] },
            { type: 'setGeometries', items: 'x' }, { type: 'reparent', parent: 3, items: [] }, { type: 'pageOp', name: 't', op: 'explode' },
            { type: 'setProperty', name: 'a', names: [1], property: 'x' }, { type: 'setTabOrder', order: [1] }, { type: 'promote', names: 'a', className: 'x', include: 'y' },
            { type: 'connect', sender: 'a' }, { type: 'preview', style: 5, dark: true, scale: 1 }, { type: 'want', tabOrder: 'yes', formInfo: false }, { type: 'inspect', name: 5 }, { type: 'undo', steps: 0 }, { type: 'redo', steps: 1000 }, { type: 'undo', steps: 1.5 }, { type: 'gesture', phase: 'sideways', label: '' }, { type: 'findInCode', query: '' }, { type: 'findInCode', query: 'x'.repeat(301) }, { type: 'copyText', text: 5 }, { type: 'addWidget', category: 1.5, index: 0, x: 0, y: 0 }, { type: 'hitSelect', x: NaN, y: 1 }]) {
            assert.equal(parseWebviewMessage(bad), undefined, JSON.stringify(bad));
        }
    });
});

describe('custom widget plugins', () => {
    const pluginDir = path.join(root, 'backend', 'build');
    const available = fs.existsSync(path.join(pluginDir, 'designer', 'libgaugeplugin.so'));

    it('are loaded from the configured folders and usable in a form', { skip: !available && 'the demo plugin is not built' }, async () => {
        const client = new BackendClient({ executable: exe, requestTimeoutMs: 20000, pluginPaths: [pluginDir] });
        try {
            await client.start();
            const { categories } = await client.request('palette', {});
            const entry = categories.flatMap((c) => c.widgets.map((w) => ({ category: c.index, index: w.index, name: w.name }))).find((w) => w.name === 'Gauge');
            assert.ok(entry, 'the plugin widget is in the widget box');
            await client.request('open', { docId: 'p', xml: sample });
            const s = await client.request('addWidget', { docId: 'p', category: entry.category, index: entry.index, x: 40, y: 40 });
            assert.ok(s.objects.some((o) => o.class === 'Gauge'));
            const saved = await client.request('contents', { docId: 'p' });
            assert.match(saved.xml, /<class>Gauge<\/class>/);
        } finally {
            client.dispose();
        }
    });
});

describe('bundled backend', () => {
    it('finds the Qt plugins folder beside the executable only when it holds a platform plugin', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qdr-bundle-'));
        try {
            assert.equal(bundledPluginPath(path.join(dir, 'designer_backend')), undefined);
            fs.mkdirSync(path.join(dir, 'plugins', 'platforms'), { recursive: true });
            assert.equal(bundledPluginPath(path.join(dir, 'designer_backend')), path.join(dir, 'plugins'));
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
