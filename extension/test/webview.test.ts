import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { pageBody } from '../src/pageBody';
import type { ConnectionInfo, DescribeResult, HostToWebview, PaletteCategory, PropertyInfo, SceneObject, Snapshot, WebviewToHost } from '../src/protocol';

type StateMsg = Extract<HostToWebview, { type: 'state' }>;
type StateIn = Partial<StateMsg> & Pick<StateMsg, 'snapshot'>;

const script = fs.readFileSync(path.resolve(__dirname, '..', '..', 'media', 'webview', 'main.js'), 'utf8');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function obj(o: Partial<SceneObject> & Pick<SceneObject, 'name' | 'class' | 'parent' | 'x' | 'y' | 'w' | 'h'>): SceneObject {
    return { gx: 0, gy: 0, laidOut: false, ...o };
}

function snap(over: Partial<Snapshot> = {}): Snapshot {
    return {
        png: PNG, width: 320, height: 200, dpr: 1,
        objects: [obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 })],
        layouts: [], actions: {}, grid: [10, 10], formGeometry: [0, 0, 320, 200],
        selection: [], dirty: false, undoIndex: 0, undoCount: 0, canUndo: false, canRedo: false, undoText: '', redoText: '', ...over,
    };
}

const prop = (name: string, over: Partial<PropertyInfo> = {}): PropertyInfo =>
    ({ name, group: 'QWidget', kind: 'string', value: '', changed: false, enabled: true, attribute: false, resettable: false, ...over });

const palette: PaletteCategory[] = [
    { name: 'Buttons', index: 2, widgets: [{ name: 'Push Button', index: 0, className: 'QPushButton', icon: '' }, { name: 'Check Box', index: 3, className: 'QCheckBox', icon: '' }] },
    { name: 'Containers', index: 5, widgets: [{ name: 'Group Box', index: 0, className: 'QGroupBox', icon: '' }] },
];

const describeOk: DescribeResult = {
    name: 'okButton', class: 'QPushButton', hierarchy: ['QPushButton', 'QAbstractButton', 'QWidget', 'QObject'],
    signals: [
        { name: 'clicked', signature: 'clicked(bool)', params: [{ type: 'bool', name: 'checked' }], owner: 'QAbstractButton' },
        { name: 'clicked', signature: 'clicked()', params: [], owner: 'QAbstractButton' },
        { name: 'toggled', signature: 'toggled(bool)', params: [{ type: 'bool', name: 'checked' }], owner: 'QAbstractButton' },
    ],
    slots: [{ name: 'click', signature: 'click()', params: [], owner: 'QAbstractButton' }],
};

describe('webview page', () => {
    let dom: JSDOM;
    let sent: WebviewToHost[];
    let stored: unknown;
    const $ = (sel: string) => dom.window.document.querySelector(sel) as HTMLElement | null;
    const $$ = (sel: string) => Array.from(dom.window.document.querySelectorAll(sel)) as HTMLElement[];
    const post = (m: StateIn | Exclude<HostToWebview, { type: 'state' }>) => {
        const data = 'snapshot' in m ? { type: 'state', properties: null, propertiesFor: null, palette: [], fonts: [], notices: [], code: null, connections: [], container: null, ...m } : m;
        dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data }));
    };
    const ptr = (target: Element, type: string, x = 0, y = 0, init: MouseEventInit = {}) =>
        target.dispatchEvent(new dom.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...init }));
    const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = dom.window.document) =>
        target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
    const types = () => sent.map((m) => m.type);

    function boot(prefs?: unknown): void {
        sent = [];
        stored = prefs;
        dom = new JSDOM(`<!DOCTYPE html><body>${pageBody()}</body>`, { runScripts: 'outside-only' });
        const w = dom.window as unknown as Record<string, unknown>;
        w.acquireVsCodeApi = () => ({
            postMessage: (m: WebviewToHost) => sent.push(JSON.parse(JSON.stringify(m)) as WebviewToHost),
            getState: () => stored,
            setState: (s: unknown) => { stored = JSON.parse(JSON.stringify(s)); },
        });
        dom.window.eval(script);
        // jsdom has no layout: give the image a 1:1 box so pointer maths works
        ($('#form') as HTMLElement).getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 200, right: 320, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
    }

    beforeEach(() => boot());

    // ------------------------------------------------------------------ start up
    it('announces readiness and the wanted render density', () => {
        assert.ok(sent.some((m) => m.type === 'ready'));
        assert.deepEqual(sent.find((m) => m.type === 'view'), { type: 'view', scale: 1 });
        assert.deepEqual(sent.find((m) => m.type === 'want'), { type: 'want', tabOrder: false, formInfo: true });
    });

    it('restores saved view preferences', () => {
        boot({ zoom: 2, leftW: 300, rightOpen: false, rightTab: 'code' });
        assert.equal(($('#app') as HTMLElement).style.getPropertyValue('--left-w'), '300px');
        assert.equal($('#app')?.classList.contains('no-right'), true);
        post({ snapshot: snap() });
        assert.equal(($('#form') as HTMLElement).style.width, '640px');
        assert.equal($('.tab.active')?.textContent?.includes('Code'), true);
    });

    // ------------------------------------------------------------------ security
    it('treats object names, classes and messages as text, never as markup', () => {
        const evil = '<img src=x onerror="window.pwned=1">';
        post({
            snapshot: snap({
                selection: [evil],
                objects: [obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }), obj({ name: evil, class: evil, parent: 'Form', x: 5, y: 5, w: 50, h: 20 })],
                layouts: [{ owner: 'Form', name: evil, kind: evil, x: 0, y: 0, w: 320, h: 200 }],
            }),
            properties: { class: evil, properties: [prop('text')] }, propertiesFor: evil, notices: [evil],
            code: { ...describeOk, name: evil, class: evil }, connections: [{ sender: evil, signal: evil, receiver: evil, slot: evil }],
        });
        for (const tab of ['Properties', 'Code', 'Connections']) {
            $$('.tab').find((t) => t.textContent?.includes(tab))?.click();
        }
        assert.equal($$('img[src="x"], #tree img[onerror], #overlay img, #inspector img[onerror], #banner img').length, 0);
        assert.equal((dom.window as unknown as { pwned?: number }).pwned, undefined);
        assert.ok($('.tree-name')?.textContent?.length);
    });

    // ------------------------------------------------------------------ outline, palette, status
    it('renders the outline with layouts and nests laid-out widgets under them', () => {
        post({
            snapshot: snap({
                objects: [
                    obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }),
                    obj({ name: 'okButton', class: 'QPushButton', parent: 'Form', x: 9, y: 9, w: 100, h: 20, laidOut: true }),
                ],
                layouts: [{ owner: 'Form', name: 'verticalLayout', kind: 'QVBoxLayout', x: 9, y: 9, w: 300, h: 180 }],
            }),
        });
        const rows = $$('.tree-row');
        assert.deepEqual(rows.map((r) => r.dataset.name), ['Form', 'verticalLayout', 'okButton']);
        assert.equal(rows[1]?.classList.contains('layout'), true);
        assert.ok(Number.parseInt(rows[2]?.style.paddingLeft ?? '0', 10) > Number.parseInt(rows[1]?.style.paddingLeft ?? '0', 10));
        rows[2]?.click();
        assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['okButton'] });
    });

    it('palette: searches, groups, adds on double click and remembers recents', () => {
        post({ snapshot: snap(), palette });
        assert.equal($$('.pal-item').length, 3);
        const f = $('#palette-filter') as HTMLInputElement;
        f.value = 'qgroup'; f.dispatchEvent(new dom.window.Event('input'));
        assert.deepEqual($$('.pal-item').map((e) => e.textContent), ['Group Box']);
        $('.pal-item')?.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
        const add = sent.at(-1);
        assert.equal(add?.type, 'addWidget');
        f.value = ''; f.dispatchEvent(new dom.window.Event('input'));
        assert.equal($$('.pal-cat')[0]?.textContent?.includes('Recent'), true);
        assert.equal((stored as { recent: unknown[] }).recent.length, 1);
    });

    it('breadcrumb and status bar describe the selection', () => {
        post({
            snapshot: snap({
                selection: ['okButton'],
                objects: [
                    obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }),
                    obj({ name: 'group', class: 'QGroupBox', parent: 'Form', x: 20, y: 40, w: 200, h: 120 }),
                    obj({ name: 'okButton', class: 'QPushButton', parent: 'group', x: 29, y: 60, w: 182, h: 22, laidOut: true, gx: 20, gy: 40 }),
                ],
            }),
        });
        assert.deepEqual($$('.crumb').map((c) => c.textContent), ['Form', 'group', 'okButton']);
        $$('.crumb')[1]?.click();
        assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['group'] });
        assert.match($('#geom')?.textContent ?? '', /9, 20 .* 182 × 22 .* in layout/);
    });

    // ------------------------------------------------------------------ toolbar and keyboard
    it('toolbar buttons mirror the engine action state and never allow deleting the form', () => {
        post({ snapshot: snap({ selection: ['Form'], actions: { delete: true, layoutGrid: true } }) });
        assert.equal(($('button[data-action=delete]') as HTMLButtonElement).disabled, true, 'form is not deletable');
        assert.equal(($('button[data-action=layoutGrid]') as HTMLButtonElement).disabled, false);
        assert.equal(($('button[data-action=copy]') as HTMLButtonElement).disabled, true);
        ($('button[data-action=layoutGrid]') as HTMLButtonElement).click();
        assert.deepEqual(sent.at(-1), { type: 'action', action: 'layoutGrid' });
    });

    it('keyboard: Delete, clipboard shortcuts, "/" and F2; typing in inputs is never hijacked', () => {
        post({ snapshot: snap({ selection: ['b'], actions: { delete: true, copy: true }, objects: [obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }), obj({ name: 'b', class: 'QPushButton', parent: 'Form', x: 10, y: 10, w: 50, h: 20 })] }) });
        sent.length = 0;
        key('Delete');
        assert.deepEqual(sent.at(-1), { type: 'action', action: 'delete' });
        key('c', { ctrlKey: true });
        assert.deepEqual(sent.at(-1), { type: 'action', action: 'copy' });
        sent.length = 0;
        key('Delete', {}, $('#filter') as HTMLElement);
        assert.deepEqual(sent, []);
        key('/');
        assert.ok($('.quickadd'));
        key('Escape', {}, $('.qa-input') as HTMLElement);
        assert.equal($('.quickadd'), null);
        key('F2');
        assert.ok($('.popup.rename'));
    });

    it('Delete never deletes when only the form is selected', () => {
        post({ snapshot: snap({ selection: ['Form'], actions: { delete: true } }) });
        sent.length = 0;
        key('Delete');
        assert.deepEqual(sent, []);
    });

    // ------------------------------------------------------------------ quick add and rename
    it('quick add ranks exact and prefix matches first and adds at the chosen position', () => {
        post({ snapshot: snap(), palette });
        ($('#viewport') as HTMLElement).dispatchEvent(new dom.window.MouseEvent('dblclick', { clientX: 120, clientY: 80, bubbles: true }));
        const input = $('.qa-input') as HTMLInputElement;
        assert.ok(input, 'double-click on empty canvas opens quick add');
        input.value = 'check'; input.dispatchEvent(new dom.window.Event('input'));
        assert.equal($('.qa-item.active .qa-name')?.textContent, 'Check Box');
        key('Enter', {}, input);
        assert.deepEqual(sent.at(-1), { type: 'addWidget', category: 2, index: 3, x: 120, y: 80 });
        assert.equal($('.quickadd'), null);
    });

    it('the search jumps to objects with @ and finds them without a prefix', () => {
        post({ snapshot: snap({ selection: ['Form'], objects: [obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }), obj({ name: 'okButton', class: 'QPushButton', parent: 'Form', x: 10, y: 10, w: 50, h: 20 })] }), palette });
        sent.length = 0;
        key('/');
        const input = $('.qa-input') as HTMLInputElement;
        input.value = '@ok'; input.dispatchEvent(new dom.window.Event('input'));
        assert.equal($('.qa-item.active .qa-name')?.textContent, 'okButton');
        key('Enter', {}, input);
        assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['okButton'] });
        key('/');
        const again = $('.qa-input') as HTMLInputElement;
        again.value = 'okbu'; again.dispatchEvent(new dom.window.Event('input'));
        assert.ok($('.qa-head'), 'mixed results are grouped under headings');
        assert.ok([...dom.window.document.querySelectorAll('.qa-name')].some((n) => n.textContent === 'okButton'));
    });

    it('rename validates C++ identifiers and duplicates before sending anything', () => {
        post({ snapshot: snap({ selection: ['b'], objects: [obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }), obj({ name: 'b', class: 'QPushButton', parent: 'Form', x: 10, y: 10, w: 50, h: 20 }), obj({ name: 'taken', class: 'QLabel', parent: 'Form', x: 70, y: 10, w: 50, h: 20 })] }) });
        sent.length = 0;
        key('F2');
        const input = $('.popup.rename input') as HTMLInputElement;
        for (const [v, msg] of [['9x', /letters/], ['a b', /letters/], ['taken', /already exists/]] as const) {
            input.value = v;
            key('Enter', {}, input);
            assert.match($('.rename-error')?.textContent ?? '', msg);
        }
        assert.deepEqual(sent, []);
        input.value = 'newName';
        key('Enter', {}, input);
        assert.deepEqual(sent.at(-1), { type: 'setProperty', name: 'b', property: 'objectName', value: 'newName' });
    });

    // ------------------------------------------------------------------ canvas: gestures
    describe('canvas gestures', () => {
        const free = (selection: string[] = []) => snap({
            selection,
            objects: [
                obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }),
                obj({ name: 'btn', class: 'QPushButton', parent: 'Form', x: 20, y: 20, w: 100, h: 30 }),
                obj({ name: 'laid', class: 'QLabel', parent: 'Form', x: 200, y: 100, w: 50, h: 20, laidOut: true }),
            ],
        });
        const viewport = () => $('#viewport') as HTMLElement;

        it('click selects through the engine; clicking outside the form selects the form', () => {
            post({ snapshot: free() });
            sent.length = 0;
            ptr(viewport(), 'pointerdown', 210, 105); ptr(viewport(), 'pointerup', 210, 105);
            assert.deepEqual(sent.at(-1), { type: 'hitSelect', x: 210, y: 105 });
            ptr(viewport(), 'pointerdown', 600, 400); ptr(viewport(), 'pointerup', 600, 400);
            assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['Form'] });
        });

        it('moving wraps the live geometry commands in one gesture and snaps to the grid', () => {
            post({ snapshot: free(['btn']) });
            sent.length = 0;
            ptr(viewport(), 'pointerdown', 50, 30); ptr(viewport(), 'pointermove', 83, 52); ptr(viewport(), 'pointerup', 83, 52);
            assert.deepEqual(types(), ['gesture', 'setProperty', 'gesture']);
            assert.deepEqual(sent[0], { type: 'gesture', phase: 'begin', label: 'Move btn' });
            assert.deepEqual(sent[1], { type: 'setProperty', name: 'btn', property: 'geometry', value: [50, 40, 100, 30] });
            assert.deepEqual(sent[2], { type: 'gesture', phase: 'end', label: '' });
        });

        it('a corner handle resizes; Alt disables snapping', () => {
            post({ snapshot: free(['btn']) });
            sent.length = 0;
            ptr(viewport(), 'pointerdown', 120, 50); ptr(viewport(), 'pointermove', 153, 73, { altKey: true }); ptr(viewport(), 'pointerup', 153, 73);
            assert.deepEqual(sent.find((m) => m.type === 'setProperty'), { type: 'setProperty', name: 'btn', property: 'geometry', value: [20, 20, 133, 53] });
        });

        it('dragging an unselected widget selects it first', () => {
            post({ snapshot: free() });
            sent.length = 0;
            ptr(viewport(), 'pointerdown', 50, 30); ptr(viewport(), 'pointermove', 90, 30);
            assert.deepEqual(sent[0], { type: 'selectNames', names: ['btn'] });
        });

        it('resizing the form sends the form geometry with its own x/y, and only grows from right and bottom', () => {
            post({ snapshot: free(['Form']) });
            assert.equal($$('.handle').length, 3);
            sent.length = 0;
            ptr(viewport(), 'pointerdown', 320, 200); ptr(viewport(), 'pointermove', 360, 230); ptr(viewport(), 'pointerup', 360, 230);
            assert.deepEqual(sent.find((m) => m.type === 'setProperty'), { type: 'setProperty', name: 'Form', property: 'geometry', value: [0, 0, 360, 230] });
        });

        it('laid-out widgets show a lock and no handles, and cannot be dragged', () => {
            post({ snapshot: free(['laid']) });
            assert.equal($$('.handle').length, 0);
            assert.ok($('.pill .codicon-lock'));
            sent.length = 0;
            ptr(viewport(), 'pointerdown', 210, 105); ptr(viewport(), 'pointermove', 260, 150); ptr(viewport(), 'pointerup', 260, 150);
            assert.equal(sent.some((m) => m.type === 'setProperty' || m.type === 'gesture'), false);
        });

        it('a click that never leaves the drag threshold is a click, not a move', () => {
            post({ snapshot: free(['btn']) });
            sent.length = 0;
            ptr(viewport(), 'pointerdown', 60, 35); ptr(viewport(), 'pointermove', 61, 36); ptr(viewport(), 'pointerup', 61, 36);
            assert.equal(sent.some((m) => m.type === 'setProperty'), false);
        });

        it('Escape aborts a running gesture and asks the host to undo what was previewed', () => {
            post({ snapshot: free(['btn']) });
            sent.length = 0;
            ptr(viewport(), 'pointerdown', 50, 30); ptr(viewport(), 'pointermove', 100, 60);
            key('Escape');
            assert.deepEqual(types(), ['gesture', 'setProperty', 'cancelGesture']);
            assert.equal(($('#ghost') as HTMLElement).hidden, true);
        });

        it('a live frame waits for the previous one: only the latest is sent next', () => {
            post({ snapshot: free(['btn']) });
            sent.length = 0;
            ptr(viewport(), 'pointerdown', 50, 30);
            ptr(viewport(), 'pointermove', 80, 30); ptr(viewport(), 'pointermove', 100, 30); ptr(viewport(), 'pointermove', 120, 30);
            assert.equal(sent.filter((m) => m.type === 'setProperty').length, 1, 'frames are coalesced while one is in flight');
            post({ snapshot: free(['btn']) }); // engine answered
            assert.equal(sent.filter((m) => m.type === 'setProperty').length, 2);
            assert.deepEqual(sent.filter((m) => m.type === 'setProperty').at(-1), { type: 'setProperty', name: 'btn', property: 'geometry', value: [90, 20, 100, 30] });
        });

        it('shows live numbers, a ghost and alignment guides while dragging', () => {
            const s = free(['btn']);
            s.objects.push(obj({ name: 'other', class: 'QLabel', parent: 'Form', x: 200, y: 20, w: 60, h: 30 }));
            post({ snapshot: s });
            ptr(viewport(), 'pointerdown', 50, 30); ptr(viewport(), 'pointermove', 150, 30);
            assert.equal($$('#ghost .ov.move').length, 1);
            assert.ok($$('#ghost .ov.guide').length >= 1, 'top edges align');
            // the right edge (220) is within 5px of the centre (225) of the layout-owned label: it snaps to it
            assert.match($('#ghost .tag.accent')?.textContent ?? '', /125, 20/);
        });

        it('Alt bypasses both the grid and the snapping to sibling edges', () => {
            const s = free(['btn']);
            post({ snapshot: s });
            sent.length = 0;
            ptr(viewport(), 'pointerdown', 50, 30); ptr(viewport(), 'pointermove', 153, 33, { altKey: true }); ptr(viewport(), 'pointerup', 153, 33);
            assert.deepEqual(sent.find((m) => m.type === 'setProperty'), { type: 'setProperty', name: 'btn', property: 'geometry', value: [123, 23, 100, 30] });
        });

        it('hover outlines the widget and tags it with name and class', () => {
            post({ snapshot: free() });
            ptr(viewport(), 'pointermove', 50, 30);
            assert.equal($$('.ov.hover').length, 1);
            assert.match($$('.tag').map((t) => t.textContent).join('|'), /btn.*QPushButton/);
            viewport().dispatchEvent(new dom.window.MouseEvent('pointerleave', { bubbles: true }));
            assert.equal($$('.ov.hover').length, 0);
        });

        it('right-click selects first, then opens the menu with the engine-enabled actions', () => {
            post({ snapshot: free() });
            sent.length = 0;
            viewport().dispatchEvent(new dom.window.MouseEvent('contextmenu', { clientX: 50, clientY: 30, bubbles: true, cancelable: true }));
            assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['btn'] });
            assert.equal($('.menu'), null, 'waits for the engine to confirm the selection');
            post({ snapshot: free(['btn']).selection.length ? { ...free(['btn']), actions: { delete: true, copy: true } } : free() });
            assert.ok($('.menu'));
            const labels = $$('.menu .menu-label').map((l) => l.textContent);
            assert.ok(labels.includes('Rename…') && labels.includes('Delete') && labels.includes('Lay Out'));
            const del = $$('.menu-item').find((i) => i.textContent?.includes('Delete')) as HTMLElement;
            assert.equal(del.getAttribute('aria-disabled'), 'false');
            const paste = $$('.menu-item').find((i) => i.textContent?.includes('Paste')) as HTMLElement;
            assert.equal(paste.getAttribute('aria-disabled'), 'true');
            del.click();
            assert.deepEqual(sent.at(-1), { type: 'action', action: 'delete' });
            assert.equal($('.menu'), null);
        });

        it('layouts are outlined, labelled for the selection, and can be hidden', () => {
            const s = free(['Form']);
            s.layouts = [{ owner: 'Form', name: 'verticalLayout', kind: 'QVBoxLayout', x: 9, y: 9, w: 300, h: 180 }];
            post({ snapshot: s });
            assert.equal($$('.ov.layout').length, 1);
            assert.match($('.tag.layout')?.textContent ?? '', /QVBoxLayout.*verticalLayout/);
            ($('button[data-toggle=layouts]') as HTMLButtonElement).click();
            assert.equal($$('.ov.layout').length, 0);
            assert.equal((stored as { showLayouts: boolean }).showLayouts, false);
        });

        it('palette drag highlights the receiving container and shows what will be added', () => {
            post({ snapshot: free(), palette });
            const dt = { setData: () => undefined, getData: () => '2,0', types: ['application/x-qt-designer-widget'], effectAllowed: '', dropEffect: '' };
            const start = new dom.window.Event('dragstart', { bubbles: true }); Object.assign(start, { dataTransfer: dt });
            $('.pal-item')?.dispatchEvent(start);
            const over = new dom.window.Event('dragover', { bubbles: true, cancelable: true }); Object.assign(over, { clientX: 60, clientY: 70, dataTransfer: dt });
            $('#stage')?.dispatchEvent(over);
            assert.equal($$('#ghost .ov.drop-target').length, 1);
            assert.match($('#ghost .tag.good')?.textContent ?? '', /Drop into Form/);
            assert.match($$('#ghost .tag.good').map((t) => t.textContent).join('|'), /Push Button/);
            const drop = new dom.window.Event('drop', { bubbles: true, cancelable: true }); Object.assign(drop, { clientX: 70, clientY: 80, dataTransfer: dt });
            $('#stage')?.dispatchEvent(drop);
            assert.deepEqual(sent.at(-1), { type: 'addWidget', category: 2, index: 0, x: 70, y: 80 });
        });

        it('zoom resizes the form, keeps coordinates logical and asks for a matching render', async () => {
            post({ snapshot: free() });
            ($('#zoom button[title="Zoom in"]') as HTMLButtonElement).click();
            assert.equal(($('#form') as HTMLElement).style.width, '400px');
            assert.match($('#zoom .level')?.textContent ?? '', /125%/);
            await new Promise((r) => setTimeout(r, 200));
            assert.deepEqual(sent.at(-1), { type: 'view', scale: 1.25 });
        });
    });

    // ------------------------------------------------------------------ inspector
    describe('inspector', () => {
        const withProps = (properties: PropertyInfo[], extra: Partial<StateIn> = {}) => post({
            snapshot: snap({ selection: ['okButton'], objects: [obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }), obj({ name: 'okButton', class: 'QPushButton', parent: 'Form', x: 9, y: 9, w: 100, h: 22 })] }),
            propertiesFor: 'okButton', properties: { class: 'QPushButton', properties }, code: describeOk, ...extra,
        });

        it('edits properties through typed controls and sends exactly what changed', () => {
            withProps([
                prop('text', { value: 'OK', group: 'QAbstractButton' }),
                prop('checkable', { kind: 'bool', value: false, changed: true, resettable: true, group: 'QAbstractButton' }),
                prop('layoutDirection', { kind: 'enum', value: 'Qt::LeftToRight', choices: ['Qt::LeftToRight', 'Qt::RightToLeft'] }),
                prop('minimumSize', { kind: 'size', value: [0, 0] }),
                prop('palette', { kind: 'unsupported', value: 'x', typeName: 'QPalette' }),
            ]);
            const text = $('input[type=text]:not(#filter)') as HTMLInputElement;
            text.value = 'Valider'; text.dispatchEvent(new dom.window.Event('change'));
            assert.deepEqual(sent.at(-1), { type: 'setProperty', name: 'okButton', property: 'text', value: 'Valider' });
            const check = $('input[type=checkbox]') as HTMLInputElement;
            check.checked = true; check.dispatchEvent(new dom.window.Event('change'));
            assert.deepEqual(sent.at(-1), { type: 'setProperty', name: 'okButton', property: 'checkable', value: true });
            const select = $('select') as HTMLSelectElement;
            select.value = 'Qt::RightToLeft'; select.dispatchEvent(new dom.window.Event('change'));
            assert.deepEqual(sent.at(-1), { type: 'setProperty', name: 'okButton', property: 'layoutDirection', value: 'Qt::RightToLeft' });
            const dims = $$('.multi input') as HTMLInputElement[];
            dims[0]!.value = '40'; dims[0]!.dispatchEvent(new dom.window.Event('change'));
            assert.deepEqual(sent.at(-1), { type: 'setProperty', name: 'okButton', property: 'minimumSize', value: [40, 0] });
            assert.equal($$('.readonly').length, 1, 'unsupported types are shown read-only, not hidden');
            ($('button.reset') as HTMLButtonElement).click();
            assert.deepEqual(sent.at(-1), { type: 'resetProperty', name: 'okButton', property: 'checkable' });
        });

        it('filters by name, by "modified only", and collapses groups', () => {
            withProps([prop('text', { group: 'A', changed: true }), prop('toolTip', { group: 'A' }), prop('flat', { group: 'B' })]);
            assert.equal($$('.prop-row').length, 3);
            const f = $('#filter') as HTMLInputElement;
            f.value = 'tool'; f.dispatchEvent(new dom.window.Event('input'));
            assert.equal($$('.prop-row').length, 1);
            f.value = ''; f.dispatchEvent(new dom.window.Event('input'));
            ($('#changed-only') as HTMLElement).click();
            assert.deepEqual($$('.prop-name').map((n) => n.textContent), ['text']);
            ($('#changed-only') as HTMLElement).click();
            $$('.group').find((g) => g.textContent?.includes('B'))?.click();
            assert.equal($$('.prop-row').length, 2);
        });

        it('size-like properties use labelled x/y/w/h inputs', () => {
            withProps([prop('geometry', { kind: 'rect', value: [1, 2, 3, 4] })]);
            assert.deepEqual($$('.multi label span').map((e) => e.textContent), ['x', 'y', 'w', 'h']);
        });

        it('Code tab: accessors and ready-to-paste connect() calls with the right class and overloads', () => {
            withProps([prop('text')], { snapshot: snap({ selection: ['okButton'], objects: [obj({ name: 'MyDialog', class: 'QDesignerWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }), obj({ name: 'okButton', class: 'QPushButton', parent: 'MyDialog', x: 9, y: 9, w: 100, h: 22 })] }) });
            $$('.tab').find((t) => t.textContent?.includes('Code'))?.click();
            assert.match($('#code')?.textContent ?? '', /ui->okButton/);
            assert.match($('#code')?.textContent ?? '', /self\.ui\.okButton/);
            const rows = $$('.sig-row');
            const copyButtons = (row: HTMLElement) => Array.from(row.querySelectorAll('button'));
            copyButtons(rows[0]!)[0]!.click();
            assert.deepEqual(sent.at(-1), { type: 'copyText', text: 'connect(ui->okButton, qOverload<bool>(&QAbstractButton::clicked), this, &MyDialog::on_okButton_clicked);' });
            copyButtons(rows[0]!)[1]!.click();
            assert.deepEqual(sent.at(-1), { type: 'copyText', text: 'void on_okButton_clicked(bool checked);' });
            copyButtons(rows[0]!)[2]!.click();
            assert.deepEqual(sent.at(-1), { type: 'findInCode', query: 'on_okButton_clicked' });
            copyButtons(rows[2]!)[0]!.click();
            assert.deepEqual(sent.at(-1), { type: 'copyText', text: 'connect(ui->okButton, &QAbstractButton::toggled, this, &MyDialog::on_okButton_toggled);' }, 'no qOverload when the name is unique');
            $$('.code-row button').find((b) => b.getAttribute('aria-label')?.includes('Find usages of ui->okButton'))?.click();
            assert.deepEqual(sent.at(-1), { type: 'findInCode', query: 'ui->okButton' });
        });

        it('Connections tab: lists, filters to the selection, selects and finds slots', () => {
            const connections: ConnectionInfo[] = [
                { sender: 'okButton', signal: 'clicked()', receiver: 'Form', slot: 'accept()' },
                { sender: 'other', signal: 'clicked()', receiver: 'other2', slot: 'clear()' },
            ];
            withProps([prop('text')], { connections });
            $$('.tab').find((t) => t.textContent?.includes('Connections'))?.click();
            assert.equal($$('.conn-row').length, 1);
            ($('#connections .chip') as HTMLElement).click();
            assert.equal($$('.conn-row').length, 2);
            $$('.conn-row .link').find((b) => b.textContent === 'okButton')?.click();
            assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['okButton'] });
            $$('.conn-row button[aria-label^="Find"]')[0]?.click();
            assert.deepEqual(sent.at(-1), { type: 'findInCode', query: 'accept' });
        });

        it('Tab badges show modified properties and connection counts', () => {
            withProps([prop('a', { changed: true }), prop('b', { changed: true })], { connections: [{ sender: 'a', signal: 's()', receiver: 'b', slot: 't()' }] });
            const badges = $$('.tab .badge').map((b) => b.textContent);
            assert.deepEqual(badges, ['2', '1']);
        });

        it('double-click on a leaf widget edits its text in place and applies it with Enter', () => {
            withProps([prop('objectName'), prop('text', { value: 'OK' })], {
                snapshot: snap({ selection: ['okButton'], objects: [obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }), obj({ name: 'okButton', class: 'QPushButton', parent: 'Form', x: 10, y: 10, w: 100, h: 30 })] }),
            });
            ($('#viewport') as HTMLElement).dispatchEvent(new dom.window.MouseEvent('dblclick', { clientX: 50, clientY: 20, bubbles: true }));
            const input = $('.inplace') as HTMLInputElement;
            assert.ok(input, 'an editor opens over the widget');
            assert.equal(input.value, 'OK');
            input.value = 'Valider';
            key('Enter', {}, input);
            assert.deepEqual(sent.at(-1), { type: 'setProperty', name: 'okButton', property: 'text', value: 'Valider' });
            assert.equal($('.inplace'), null);
        });
    });

    // ------------------------------------------------------------------ panels
    describe('panels', () => {
        it('splitters resize, clamp, persist, reset on double-click and respond to the keyboard', () => {
            const sp = $('#split-left') as HTMLElement;
            ptr(sp, 'pointerdown', 240, 100);
            ptr(sp, 'pointermove', 300, 100);
            ptr(sp, 'pointerup', 300, 100);
            assert.equal((stored as { leftW: number }).leftW, 300);
            ptr(sp, 'pointerdown', 300, 100); ptr(sp, 'pointermove', 5000, 100); ptr(sp, 'pointerup', 5000, 100);
            assert.equal((stored as { leftW: number }).leftW, 460, 'clamped to the maximum');
            key('ArrowLeft', {}, sp);
            assert.equal((stored as { leftW: number }).leftW, 444);
            sp.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
            assert.equal(($('#app') as HTMLElement).style.getPropertyValue('--left-w'), '240px');
        });

        it('sidebars can be collapsed from the toolbar and the choice is remembered', () => {
            ($('button[data-panel=right]') as HTMLButtonElement).click();
            assert.equal($('#app')?.classList.contains('no-right'), true);
            assert.equal((stored as { rightOpen: boolean }).rightOpen, false);
            ($('button[data-panel=right]') as HTMLButtonElement).click();
            assert.equal($('#app')?.classList.contains('no-right'), false);
        });
    });

    // ------------------------------------------------------------------ host messages
    it('engine messages become toasts that go away; errors are marked; backend loss shows a restart panel', () => {
        post({ snapshot: snap(), notices: ['Paste error: nope'] });
        assert.match($('#toasts .toast.warn')?.textContent ?? '', /Paste error/);
        post({ snapshot: snap(), notices: ['Paste error: nope'] });
        assert.equal($$('#toasts .toast').length, 1, 'identical messages replace each other');
        post({ type: 'error', message: 'boom' });
        assert.ok($('#toasts .toast.error'));
        ($('#toasts .toast.error .toast-close') as HTMLElement).click();
        assert.equal($$('#toasts .toast.error').length, 0);
        assert.equal(($('#loading') as HTMLElement).hidden, true, 'the loading screen leaves with the first state');
        post({ type: 'backendStatus', text: 'backend stopped' });
        assert.equal(($('#engine-down') as HTMLElement).hidden, false);
        assert.match($('#engine-down-text')?.textContent ?? '', /backend stopped/);
        sent.length = 0;
        ($('#engine-restart') as HTMLElement).click();
        assert.deepEqual(sent.at(-1), { type: 'restartBackend' });
        assert.equal(($('#engine-down') as HTMLElement).hidden, true);
        post({ snapshot: snap() });
        assert.equal(($('#engine-down') as HTMLElement).hidden, true);
    });

    it('form size inputs follow the document and edit the form geometry keeping its x/y', () => {
        post({ snapshot: snap({ formGeometry: [10, 20, 320, 200] }) });
        const [w, h] = $$('.size-input') as HTMLInputElement[];
        assert.equal(w?.value, '320');
        w!.value = '640'; w!.dispatchEvent(new dom.window.Event('change'));
        assert.deepEqual(sent.at(-1), { type: 'setProperty', name: 'Form', property: 'geometry', value: [10, 20, 640, 200] });
        assert.equal(h?.value, '200');
    });

    // =================================================================== features added in the big pass
    describe('selection, alignment and grouping', () => {
        const three = (selection: string[]) => snap({
            selection, actions: { delete: true, copy: true, layoutVertical: true },
            objects: [
                obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }),
                obj({ name: 'a', class: 'QPushButton', parent: 'Form', x: 10, y: 10, w: 50, h: 20 }),
                obj({ name: 'b', class: 'QPushButton', parent: 'Form', x: 100, y: 40, w: 70, h: 30 }),
                obj({ name: 'c', class: 'QPushButton', parent: 'Form', x: 250, y: 90, w: 40, h: 20 }),
                obj({ name: 'laid', class: 'QLabel', parent: 'Form', x: 10, y: 150, w: 40, h: 20, laidOut: true }),
            ],
        });
        const vp = () => $('#viewport') as HTMLElement;
        const alignBy = (label: string) => {
            ($('#toolbar button[data-align]') as HTMLButtonElement).click();
            $$('.menu-item').find((i) => i.textContent?.includes(label))?.click();
        };
        const lastItems = () => (sent.find((m) => m.type === 'setGeometries') as Extract<WebviewToHost, { type: 'setGeometries' }>).items;

        it('the floating bar of a multi-selection offers alignment, and an alignment is one gesture', () => {
            post({ snapshot: three(['a', 'b', 'c']) });
            assert.ok($('.pill')?.textContent?.includes('3 widgets'));
            sent.length = 0;
            ($('.pill button[aria-label="Align Left"]') as HTMLElement).click();
            assert.deepEqual(types(), ['gesture', 'setGeometries', 'gesture']);
            assert.deepEqual(sent[0], { type: 'gesture', phase: 'begin', label: 'Align Left' });
            assert.deepEqual(lastItems().map((i) => [i.name, i.rect[0]]), [['b', 10], ['c', 10]], 'only widgets that move are sent');
        });

        it('aligns edges and centres to the bounds of the selection', () => {
            post({ snapshot: three(['a', 'b', 'c']) });
            const run = (label: string) => { sent.length = 0; alignBy(label); return Object.fromEntries(lastItems().map((i) => [i.name, i.rect])); };
            assert.equal(run('Align Right')['a']?.[0], 240); // bounds right = 290; a is 50 wide
            assert.equal(run('Align Top')['c']?.[1], 10);
            assert.equal(run('Align Bottom')['a']?.[1], 90); // bounds bottom = 110; a is 20 high
            assert.equal(run('Align Horizontal Centers')['a']?.[0], 125); // bounds 10..290, centre 150
            assert.equal(run('Align Vertical Centers')['a']?.[1], 50); // bounds 10..110, centre 60
        });

        it('distributes with equal gaps and keeps the outer widgets where they are', () => {
            post({ snapshot: three(['a', 'b', 'c']) });
            sent.length = 0;
            alignBy('Distribute Horizontally');
            const items = Object.fromEntries(lastItems().map((i) => [i.name, i.rect[0]]));
            // widths 50+70+40=160 over 280px: two gaps of 60
            assert.deepEqual(items, { b: 120 });
        });

        it('matches sizes to the first selected widget', () => {
            post({ snapshot: three(['b', 'a', 'c']) });
            sent.length = 0;
            alignBy('Same Size');
            assert.deepEqual(lastItems().map((i) => [i.name, i.rect[2], i.rect[3]]), [['a', 70, 30], ['c', 70, 30]]);
        });

        it('one widget aligns to its parent; layout-owned widgets are never aligned', () => {
            post({ snapshot: three(['b']) });
            sent.length = 0;
            alignBy('Align Horizontal Centers');
            assert.equal(lastItems()[0]?.rect[0], 125);
            post({ snapshot: three(['laid']) });
            sent.length = 0;
            ($('#toolbar button[data-align]') as HTMLButtonElement).click();
            assert.ok($$('.menu-item').every((i) => i.getAttribute('aria-disabled') === 'true'));
        });

        it('a band dragged over empty space selects the widgets it touches, Shift adds to the selection', () => {
            post({ snapshot: three([]) });
            sent.length = 0;
            ptr(vp(), 'pointerdown', 5, 5); ptr(vp(), 'pointermove', 120, 60); ptr(vp(), 'pointerup', 120, 60);
            assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['a', 'b'] });
            post({ snapshot: three(['c']) });
            sent.length = 0;
            ptr(vp(), 'pointerdown', 5, 5, { shiftKey: true }); ptr(vp(), 'pointermove', 70, 40, { shiftKey: true }); ptr(vp(), 'pointerup', 70, 40, { shiftKey: true });
            assert.deepEqual((sent.at(-1) as { names: string[] }).names.sort(), ['a', 'c']);
        });

        it('dragging one of several selected widgets moves them all by the same amount', () => {
            post({ snapshot: three(['a', 'b']) });
            sent.length = 0;
            ptr(vp(), 'pointerdown', 120, 50); ptr(vp(), 'pointermove', 150, 70, { altKey: true }); ptr(vp(), 'pointerup', 150, 70);
            const items = lastItems();
            assert.deepEqual(items.map((i) => [i.name, i.rect[0], i.rect[1]]), [['a', 40, 30], ['b', 130, 60]]);
            assert.deepEqual(types(), ['gesture', 'setGeometries', 'gesture']);
            assert.equal((sent[0] as { label: string }).label, 'Move 2 widgets');
        });

        it('a plain click on a member of a multi-selection selects only it', () => {
            post({ snapshot: three(['a', 'b']) });
            sent.length = 0;
            ptr(vp(), 'pointerdown', 120, 50); ptr(vp(), 'pointerup', 120, 50);
            assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['b'] });
        });

        it('arrow keys nudge every selected widget in one undo step', () => {
            post({ snapshot: three(['a', 'b']) });
            sent.length = 0;
            key('ArrowRight');
            assert.deepEqual(types(), ['gesture', 'setGeometries', 'gesture']);
            assert.deepEqual(lastItems().map((i) => i.rect[0]), [20, 110]);
        });

        it('dropping widgets on another container reparents them, keeping their place on screen', () => {
            const s = snap({
                selection: ['go'],
                objects: [
                    obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }),
                    obj({ name: 'box', class: 'QGroupBox', parent: 'Form', x: 180, y: 20, w: 120, h: 120 }),
                    obj({ name: 'go', class: 'QPushButton', parent: 'Form', x: 20, y: 20, w: 60, h: 24 }),
                ],
            });
            post({ snapshot: s });
            sent.length = 0;
            ptr(vp(), 'pointerdown', 40, 30); ptr(vp(), 'pointermove', 200, 70, { altKey: true });
            assert.equal($$('#ghost .ov.drop-target').length, 1);
            assert.match($('#ghost .tag.good')?.textContent ?? '', /Move into box/);
            ptr(vp(), 'pointerup', 200, 70);
            const rep = sent.find((m) => m.type === 'reparent') as Extract<WebviewToHost, { type: 'reparent' }>;
            assert.equal(rep.parent, 'box');
            assert.deepEqual(rep.items, [{ name: 'go', rect: [180, 60, 60, 24] }]);
            assert.equal(types().at(-1), 'gesture', 'the whole drag stays one undo step');
        });

        it('containers that already have a layout are not offered as drop targets', () => {
            const s = snap({
                selection: ['go'],
                objects: [
                    obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }),
                    obj({ name: 'box', class: 'QGroupBox', parent: 'Form', x: 180, y: 20, w: 120, h: 120 }),
                    obj({ name: 'go', class: 'QPushButton', parent: 'Form', x: 20, y: 20, w: 60, h: 24 }),
                ],
                layouts: [{ owner: 'box', name: 'boxLayout', kind: 'QVBoxLayout', x: 182, y: 22, w: 116, h: 116 }],
            });
            post({ snapshot: s });
            ptr(vp(), 'pointerdown', 40, 30); ptr(vp(), 'pointermove', 200, 70);
            assert.equal($$('#ghost .ov.drop-target').length, 0);
        });
    });

    describe('connections', () => {
        const objs = [
            obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }),
            obj({ name: 'go', class: 'QPushButton', parent: 'Form', x: 10, y: 10, w: 80, h: 24 }),
            obj({ name: 'edit', class: 'QLineEdit', parent: 'Form', x: 10, y: 80, w: 120, h: 24 }),
        ];
        const info = (name: string, cls: string, signals: [string, string[]][], slots: [string, string[]][]): DescribeResult => ({
            name, class: cls, hierarchy: [cls, 'QObject'],
            signals: signals.map(([n, params]) => ({ name: n, signature: `${n}(${params.join(',')})`, params: params.map((t) => ({ type: t, name: '' })), owner: cls })),
            slots: slots.map(([n, params]) => ({ name: n, signature: `${n}(${params.join(',')})`, params: params.map((t) => ({ type: t, name: '' })), owner: cls })),
        });
        const flush = () => new Promise((r) => setTimeout(r, 10));
        const answerDescribes = async () => {
            for (const m of sent.filter((x) => x.type === 'describe') as { name: string }[]) {
                post({ type: 'describeResult', name: m.name, result: m.name === 'go'
                    ? info('go', 'QPushButton', [['clicked', ['bool']], ['clicked', []], ['pressed', []]], [])
                    : info('edit', 'QLineEdit', [], [['clear', []], ['setText', ['QString']], ['setEnabled', ['bool']]]) });
            }
            await flush();
        };

        it('F4 toggles connect mode; dragging between widgets asks the host for both widgets\' signals and slots', async () => {
            post({ snapshot: snap({ objects: objs }) });
            key('F4');
            assert.equal(($('button[data-mode=connect]') as HTMLElement).getAttribute('aria-pressed'), 'true');
            sent.length = 0;
            const vp = $('#viewport') as HTMLElement;
            ptr(vp, 'pointerdown', 40, 20); ptr(vp, 'pointermove', 60, 90);
            assert.ok($('#ghost svg line'), 'a live arrow follows the pointer');
            assert.equal($$('#ghost .ov.drop-target').length, 1);
            ptr(vp, 'pointerup', 60, 90);
            await flush();
            assert.deepEqual(sent.filter((m) => m.type === 'describe').map((m) => (m as { name: string }).name).sort(), ['edit', 'go']);
            await answerDescribes();
            assert.ok($('.popup.connect'));
        });

        it('offers only the slots compatible with the chosen signal and connects with their signatures', async () => {
            post({ snapshot: snap({ objects: objs }) });
            key('F4');
            const vp = $('#viewport') as HTMLElement;
            ptr(vp, 'pointerdown', 40, 20); ptr(vp, 'pointermove', 60, 90); ptr(vp, 'pointerup', 60, 90);
            await flush(); await answerDescribes();
            const cols = $$('.conn-col');
            const items = (col: number) => Array.from(cols[col]!.querySelectorAll('.conn-item')) as HTMLElement[];
            items(0).find((i) => i.textContent?.startsWith('clicked(bool)'))?.click();
            assert.deepEqual(items(1).map((i) => i.querySelector('code')?.textContent), ['clear()', 'setEnabled(bool)'], 'setText(QString) does not fit clicked(bool)');
            const ok = $('.popup .btn.primary') as HTMLButtonElement;
            assert.equal(ok.disabled, true, 'a slot must be chosen first');
            items(1).find((i) => i.textContent?.startsWith('setEnabled'))?.click();
            assert.equal(($('.popup .btn.primary') as HTMLButtonElement).disabled, false);
            sent.length = 0;
            ($('.popup .btn.primary') as HTMLButtonElement).click();
            assert.deepEqual(sent.at(-1), { type: 'connect', sender: 'go', signal: 'clicked(bool)', receiver: 'edit', slot: 'setEnabled(bool)' });
            assert.equal($('.popup'), null);
        });

        it('Escape closes the dialog even when a click re-rendered the list and focus fell to the page', async () => {
            post({ snapshot: snap({ objects: objs }) });
            key('F4');
            const vp = $('#viewport') as HTMLElement;
            ptr(vp, 'pointerdown', 40, 20); ptr(vp, 'pointermove', 60, 90); ptr(vp, 'pointerup', 60, 90);
            await flush(); await answerDescribes();
            ($$('.conn-col')[0]!.querySelector('.conn-item') as HTMLElement).click();
            key('Escape');
            assert.equal($('.popup.connect'), null);
        });

        it('arrows show the existing connections, and the Connections tab can delete one', () => {
            post({ snapshot: snap({ objects: objs, selection: ['go'] }), connections: [{ sender: 'go', signal: 'clicked()', receiver: 'edit', slot: 'clear()' }] });
            key('F4');
            assert.equal($$('svg.arrows .arrow').length, 1);
            assert.match($('svg.arrows .arrow-label')?.textContent ?? '', /clicked\(\) → clear\(\)/);
            $$('.tab').find((t) => t.textContent?.includes('Connections'))?.click();
            sent.length = 0;
            ($('#connections button[aria-label^="Delete the connection"]') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'disconnect', sender: 'go', signal: 'clicked()', receiver: 'edit', slot: 'clear()' });
        });

        it('the connections list shows everything when only the form is selected', () => {
            post({ snapshot: snap({ objects: objs, selection: ['Form'] }), connections: [{ sender: 'go', signal: 'clicked()', receiver: 'edit', slot: 'clear()' }] });
            $$('.tab').find((t) => t.textContent?.includes('Connections'))?.click();
            assert.equal($$('.conn-row').length, 1);
        });
    });

    describe('property editors', () => {
        const withProps = (properties: PropertyInfo[], extra: Partial<StateIn> = {}) => post({
            snapshot: snap({ selection: ['w'], objects: [obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }), obj({ name: 'w', class: 'QLabel', parent: 'Form', x: 10, y: 10, w: 100, h: 22 })] }),
            propertiesFor: 'w', properties: { class: 'QLabel', properties }, ...extra,
        });
        const change = (el: HTMLElement) => el.dispatchEvent(new dom.window.Event('change'));

        it('alignment is two rows of buttons that replace only their own axis', () => {
            withProps([prop('alignment', { kind: 'flags', value: ['AlignLeft', 'AlignVCenter'], choices: ['AlignLeft', 'AlignRight', 'AlignHCenter', 'AlignJustify', 'AlignTop', 'AlignVCenter', 'AlignBottom', 'AlignBaseline'] })]);
            assert.equal(($('button[aria-label="Align left"]') as HTMLElement).getAttribute('aria-pressed'), 'true');
            assert.equal(($('button[aria-label="Center vertically"]') as HTMLElement).getAttribute('aria-pressed'), 'true');
            ($('button[aria-label="Align right"]') as HTMLElement).click();
            const sentValue = (sent.at(-1) as { value: string[] }).value;
            assert.deepEqual([...sentValue].sort(), ['AlignRight', 'AlignVCenter']);
            ($('button[aria-label="Align bottom"]') as HTMLElement).click();
            assert.deepEqual([...((sent.at(-1) as { value: string[] }).value)].sort(), ['AlignBottom', 'AlignLeft']);
        });

        it('other flags are a checklist that sends the full set', () => {
            withProps([prop('textInteractionFlags', { kind: 'flags', value: ['TextSelectableByMouse'], choices: ['NoTextInteraction', 'TextSelectableByMouse', 'TextEditable', 'TextInteractionMask'] })]);
            ($('.flags-head') as HTMLElement).click();
            assert.deepEqual($$('.flag').map((f) => f.textContent), ['NoTextInteraction', 'TextSelectableByMouse', 'TextEditable'], 'mask values are hidden');
            const cb = $$('.flag input')[2] as HTMLInputElement;
            cb.checked = true; change(cb);
            assert.deepEqual((sent.at(-1) as { value: string[] }).value.sort(), ['TextEditable', 'TextSelectableByMouse']);
        });

        it('size policy, font and key sequence', () => {
            withProps([
                prop('sizePolicy', { kind: 'sizePolicy', value: { h: 'Preferred', v: 'Fixed', hs: 0, vs: 0 }, choices: ['Fixed', 'Preferred', 'Expanding'] }),
                prop('font', { kind: 'font', value: { family: 'Sans', pointSize: 9, bold: false, italic: false, underline: false, strikeOut: false } }),
                prop('shortcut', { kind: 'keysequence', value: '' }),
            ]);
            const hsel = $('[data-prop=sizePolicy] select') as HTMLSelectElement;
            hsel.value = 'Expanding'; change(hsel);
            assert.deepEqual((sent.at(-1) as { value: unknown }).value, { h: 'Expanding', v: 'Fixed', hs: 0, vs: 0 });
            ($('button[aria-label="Bold"]') as HTMLElement).click();
            assert.equal(((sent.at(-1) as { value: { bold: boolean } }).value).bold, true);
            const size = $('[data-prop=font] input[type=number]') as HTMLInputElement;
            size.value = '14'; change(size);
            assert.equal(((sent.at(-1) as { value: { pointSize: number } }).value).pointSize, 14);
            const sc = $('[data-prop=shortcut]') as HTMLInputElement;
            sc.value = 'Ctrl+G'; change(sc);
            assert.deepEqual(sent.at(-1), { type: 'setProperty', name: 'w', property: 'shortcut', value: 'Ctrl+G' });
        });

        it('icons: choose asks the host for a file, clear sets an empty path', () => {
            withProps([prop('icon', { kind: 'icon', value: '/x/icons/ok.png', thumb: 'data:image/png;base64,AAAA' })]);
            assert.equal(($('.thumb') as HTMLImageElement).getAttribute('src'), 'data:image/png;base64,AAAA');
            assert.match($('.file-name')?.textContent ?? '', /ok\.png/);
            ($('button[aria-label="Choose an image"]') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'pickFile', name: 'w', property: 'icon' });
            ($('button[aria-label="Remove the image"]') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'setProperty', name: 'w', property: 'icon', value: '' });
        });

        it('lists, colours, dates and read-only types', () => {
            withProps([
                prop('items', { kind: 'stringlist', value: ['a', 'b'] }),
                prop('when', { kind: 'date', value: '2026-01-31' }),
                prop('tint', { kind: 'color', value: '#80ff0000' }),
                prop('palette', { kind: 'unsupported', value: 'custom palette' }),
            ]);
            const ta = $('[data-prop=items]') as HTMLTextAreaElement;
            ta.value = 'x\n\ny\nz'; change(ta);
            assert.deepEqual((sent.at(-1) as { value: string[] }).value, ['x', 'y', 'z']);
            const d = $('[data-prop=when]') as HTMLInputElement;
            assert.equal(d.type, 'date');
            const c = $('[data-prop=tint] input') as HTMLInputElement;
            assert.equal(c.value, '#ff0000');
            c.value = '#00ff00'; change(c);
            assert.equal((sent.at(-1) as { value: string }).value, '#8000ff00', 'the alpha channel is kept');
            assert.equal($$('.readonly').length, 1);
        });

        it('long text opens a larger editor and sends the result', () => {
            withProps([prop('styleSheet', { value: 'color: red;' })]);
            ($('button[aria-label^="Edit styleSheet"]') as HTMLElement).click();
            const ta = $('.big-text') as HTMLTextAreaElement;
            ta.value = 'color: blue;\nfont-weight: bold;';
            ($('.popup .btn.primary') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'setProperty', name: 'w', property: 'styleSheet', value: 'color: blue;\nfont-weight: bold;' });
        });

        it('with several widgets selected, an edit names them all', () => {
            post({
                snapshot: snap({ selection: ['w', 'v'], objects: [obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }), obj({ name: 'w', class: 'QLabel', parent: 'Form', x: 10, y: 10, w: 100, h: 22 }), obj({ name: 'v', class: 'QLabel', parent: 'Form', x: 10, y: 50, w: 100, h: 22 })] }),
                propertiesFor: 'w', properties: { class: 'QLabel', properties: [prop('toolTip')] },
            });
            const input = $('[data-prop=toolTip] input, input[data-prop=toolTip]') as HTMLInputElement;
            input.value = 'shared'; change(input);
            assert.deepEqual(sent.at(-1), { type: 'setProperty', name: 'w', names: ['w', 'v'], property: 'toolTip', value: 'shared' });
            assert.ok($('#inspector-head .chip')?.textContent?.includes('+1 more'));
        });

        it('a layout chosen in the outline is inspected without changing the selection', () => {
            post({
                snapshot: snap({ selection: ['Form'], layouts: [{ owner: 'Form', name: 'vl', kind: 'QVBoxLayout', x: 0, y: 0, w: 320, h: 200 }] }),
            });
            ($$('.tree-row.layout')[0] as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'inspect', name: 'vl' });
            post({ snapshot: snap({ selection: ['Form'], layouts: [{ owner: 'Form', name: 'vl', kind: 'QVBoxLayout', x: 0, y: 0, w: 320, h: 200 }] }), propertiesFor: 'vl', properties: { class: 'QVBoxLayout', isLayout: true, properties: [prop('spacing', { kind: 'int', value: 6, group: 'QLayout' })] } });
            assert.match($('#inspector-head')?.textContent ?? '', /vl.*layout/);
            const sp = $('[data-prop=spacing]') as HTMLInputElement;
            sp.value = '12'; change(sp);
            assert.deepEqual(sent.at(-1), { type: 'setProperty', name: 'vl', property: 'spacing', value: 12 });
            assert.equal($('.add-dynamic'), null, 'dynamic properties are for widgets');
        });

        it('dynamic properties: added through a dialog with a valid name, removed from the list', () => {
            withProps([prop('myTag', { dynamic: true, value: 'x', group: 'Dynamic Properties' })]);
            ($('button[aria-label="Remove dynamic property myTag"]') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'removeDynamicProperty', name: 'w', property: 'myTag' });
            ($('.add-dynamic') as HTMLElement).click();
            const [name, value] = $$('.popup input') as HTMLInputElement[];
            name!.value = '9bad'; ($('.popup .btn.primary') as HTMLElement).click();
            assert.match($('.rename-error')?.textContent ?? '', /letters/);
            name!.value = 'myTag'; ($('.popup .btn.primary') as HTMLElement).click();
            assert.match($('.rename-error')?.textContent ?? '', /already has/);
            name!.value = 'count'; ($('.popup select') as HTMLSelectElement).value = 'int'; value!.value = '7';
            ($('.popup .btn.primary') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'addDynamicProperty', name: 'w', property: 'count', kind: 'int', value: 7 });
        });
    });

    describe('form tab, preview, pages and misc', () => {
        const base = (selection: string[] = []) => snap({
            selection, actions: { copy: true },
            objects: [
                obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }),
                obj({ name: 'tabs', class: 'QTabWidget', parent: 'Form', x: 10, y: 10, w: 200, h: 120 }),
                obj({ name: 'go', class: 'QPushButton', parent: 'Form', x: 10, y: 150, w: 60, h: 24 }),
            ],
        });

        it('opening the Form tab asks the host for the form settings and tab order, leaving it stops asking', () => {
            post({ snapshot: base() });
            sent.length = 0;
            $$('.tab').find((t) => t.textContent?.includes('Form'))?.click();
            assert.deepEqual(sent.find((m) => m.type === 'want'), { type: 'want', tabOrder: true, formInfo: true });
            $$('.tab').find((t) => t.textContent?.includes('Properties'))?.click();
            assert.deepEqual(sent.filter((m) => m.type === 'want').at(-1), { type: 'want', tabOrder: false, formInfo: true });
        });

        it('form settings are edited field by field; the tab order is numbered on the form and reorderable', () => {
            $$('.tab').find((t) => t.textContent?.includes('Form'))?.click();
            post({ snapshot: base(), formInfo: { grid: [10, 10], layoutDefault: [null, null], author: 'Enzo', comment: '', exportMacro: '', pixmapFunction: '', includeHints: [], resourceFiles: [], resources: [], actions: [], actionTargets: [], customSlots: [], customSignals: [] }, tabOrder: ['tabs', 'go'] });
            sent.length = 0;
            const gx = $('input[aria-label="Grid X"]') as HTMLInputElement;
            gx.value = '5'; gx.dispatchEvent(new dom.window.Event('change'));
            assert.deepEqual(sent.at(-1), { type: 'setFormInfo', info: { grid: [5, 10] } });
            const margin = $('input[aria-label="Margin"]') as HTMLInputElement;
            margin.value = '4'; margin.dispatchEvent(new dom.window.Event('change'));
            assert.deepEqual(sent.at(-1), { type: 'setFormInfo', info: { layoutDefault: [4, null] } });
            assert.deepEqual($$('.badge-num:not(.inline)').map((b) => b.textContent), ['1', '2']);
            ($$('.order-row')[1]!.querySelector('button[aria-label="Move go up"]') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'setTabOrder', order: ['go', 'tabs'] });
        });

        it('a tab widget gets page controls on its floating bar', () => {
            post({ snapshot: base(['tabs']), container: { pages: ['one', 'two', 'three'], current: 2 } });
            assert.match($('.pill .pages')?.textContent ?? '', /3\/3/);
            sent.length = 0;
            ($('.pill button[aria-label="Next page"]') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'setCurrentPage', name: 'tabs', index: 0 });
            ($('.pill button[aria-label="Add a page after this one"]') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'pageOp', name: 'tabs', op: 'addAfter' });
            ($('.pill button[aria-label="Delete this page"]') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'pageOp', name: 'tabs', op: 'remove' });
        });

        it('preview: requests a render, shows it, follows the style choice, closes with Escape', () => {
            post({ snapshot: base() });
            sent.length = 0;
            ($('button[data-preview]') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'preview', style: 'Fusion', dark: false, scale: 1 });
            post({ type: 'preview', style: 'Fusion', dark: false, result: { png: PNG, width: 320, height: 200, styles: ['Windows', 'Fusion'] } });
            assert.equal(($('.preview-img') as HTMLImageElement).getAttribute('src'), `data:image/png;base64,${PNG}`);
            assert.deepEqual(($$('.popup.preview select option') as HTMLOptionElement[]).map((o) => o.value).sort(), ['Fusion', 'Windows']);
            const dark = $('.popup.preview input[type=checkbox]') as HTMLInputElement;
            dark.checked = true; dark.dispatchEvent(new dom.window.Event('change'));
            assert.equal((sent.at(-1) as { dark: boolean }).dark, true);
            key('Escape');
            assert.equal($('.popup.preview'), null);
        });

        it('promote opens a dialog that validates the class name and sends the header', () => {
            post({ snapshot: base(['go']), code: { name: 'go', class: 'QPushButton', hierarchy: ['QPushButton'], signals: [], slots: [] }, actions: undefined } as StateIn);
            ($('.pill button[aria-label^="More actions"]') as HTMLElement).click();
            $$('.menu-item').find((i) => i.textContent?.includes('Promote to custom widget'))?.click();
            const [cls, header] = $$('.popup input') as HTMLInputElement[];
            cls!.value = 'Fancy Button'; cls!.dispatchEvent(new dom.window.Event('input'));
            ($('.popup .btn.primary') as HTMLElement).click();
            assert.match($('.rename-error')?.textContent ?? '', /valid C\+\+ class name/);
            cls!.value = 'FancyButton'; cls!.dispatchEvent(new dom.window.Event('input'));
            assert.equal(header!.value, 'fancybutton.h', 'the header name follows the class');
            sent.length = 0;
            ($('.popup .btn.primary') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'promote', names: ['go'], className: 'FancyButton', include: 'fancybutton.h' });
        });

        it('undo and redo buttons mirror the engine state and call the host', () => {
            post({ snapshot: snap({ canUndo: true, canRedo: false }) });
            const undo = $('button[data-history=undo]') as HTMLButtonElement, redo = $('button[data-history=redo]') as HTMLButtonElement;
            assert.equal(undo.disabled, false);
            assert.equal(redo.disabled, true);
            undo.click();
            assert.deepEqual(sent.at(-1), { type: 'undo' });
        });

        it('Ctrl+D duplicates through copy then paste', () => {
            post({ snapshot: base(['go']) });
            sent.length = 0;
            key('d', { ctrlKey: true });
            assert.deepEqual(sent.map((m) => (m as { action?: string }).action), ['copy', 'paste']);
        });

        it('in-place editing of an unselected widget selects it first, then opens once its text arrives', () => {
            post({ snapshot: base() });
            sent.length = 0;
            ($('#viewport') as HTMLElement).dispatchEvent(new dom.window.MouseEvent('dblclick', { clientX: 20, clientY: 160, bubbles: true }));
            assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['go'] });
            assert.equal($('.inplace'), null, 'not before the properties are known');
            post({ snapshot: base(['go']), propertiesFor: 'go', properties: { class: 'QPushButton', properties: [prop('text', { value: 'Go' })] } });
            assert.equal(($('.inplace') as HTMLInputElement).value, 'Go');
            key('Escape', {}, $('.inplace') as HTMLElement);
            assert.equal($('.inplace'), null);
        });

        it('double-clicking empty space of a container opens quick add at that spot', () => {
            post({ snapshot: base() });
            ($('#viewport') as HTMLElement).dispatchEvent(new dom.window.MouseEvent('dblclick', { clientX: 250, clientY: 160, bubbles: true }));
            assert.ok($('.quickadd'));
        });
    });

    // =================================================================== comfort features
    describe('outline, commands, help, history, keyboard', () => {
        const tree = () => snap({
            selection: ['b'],
            objects: [
                obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }),
                obj({ name: 'box', class: 'QGroupBox', parent: 'Form', x: 10, y: 10, w: 200, h: 150 }),
                obj({ name: 'a', class: 'QPushButton', parent: 'box', x: 20, y: 30, w: 50, h: 20 }),
                obj({ name: 'b', class: 'QLineEdit', parent: 'box', x: 20, y: 60, w: 100, h: 20 }),
                obj({ name: 'c', class: 'QLabel', parent: 'Form', x: 230, y: 20, w: 50, h: 20 }),
            ],
            actions: { delete: true, copy: true },
        });
        const names = () => $$('.tree-row').map((r) => r.dataset.name);

        it('the outline folds and unfolds, and opens up to reveal a selection', () => {
            post({ snapshot: tree() });
            assert.deepEqual(names(), ['Form', 'box', 'a', 'b', 'c']);
            ($$('.tree-row')[1]!.querySelector('.twisty') as HTMLElement).click();
            assert.deepEqual(names(), ['Form', 'box', 'c'], 'the group box is folded');
            post({ snapshot: { ...tree(), selection: ['a'] } });
            assert.deepEqual(names(), ['Form', 'box', 'a', 'b', 'c'], 'selecting a hidden widget unfolds its ancestors');
        });

        it('the outline lists the form actions in a group, and a click opens one in the inspector', () => {
            const info = { grid: [10, 10], layoutDefault: [null, null], author: '', comment: '', exportMacro: '', pixmapFunction: '', includeHints: [], resourceFiles: [], resources: [], customSlots: [], customSignals: [], actionTargets: [],
                actions: [{ name: 'actionOpen', text: 'Open', separator: false, checkable: false, shortcut: '', hasIcon: false, usedIn: [] }, { name: 'sep', text: '', separator: true, checkable: false, shortcut: '', hasIcon: false, usedIn: [] }] };
            post({ snapshot: tree(), formInfo: info } as never);
            assert.deepEqual(names(), ['Form', 'box', 'a', 'b', 'c', 'actions', 'actionOpen']);
            sent.length = 0;
            ($$('.tree-row').find((r) => r.dataset.name === 'actionOpen') as HTMLElement).click();
            assert.deepEqual(sent.find((m) => m.type === 'inspect'), { type: 'inspect', name: 'actionOpen' });
        });

        it('the outline lists the menus with their entries, and a menu opens its menu bar', () => {
            const info = { grid: [10, 10], layoutDefault: [null, null], author: '', comment: '', exportMacro: '', pixmapFunction: '', includeHints: [], resourceFiles: [], resources: [], customSlots: [], customSignals: [],
                actionTargets: [{ name: 'menuFile', kind: 'menu', title: 'File' }, { name: 'mainToolBar', kind: 'toolbar', title: 'Tools' }],
                actions: [{ name: 'actionNew', text: 'New', separator: false, checkable: false, shortcut: '', hasIcon: false, usedIn: ['menuFile'] }] };
            const s = tree();
            post({ snapshot: { ...s, objects: [...s.objects, obj({ name: 'menuBar', class: 'QMenuBar', parent: 'Form', x: 0, y: 0, w: 100, h: 20 })] }, formInfo: info } as never);
            const rows = () => $$('.tree-row').map((r) => r.dataset.name);
            assert.deepEqual(rows().slice(-5), ['menus', 'menuFile', 'actionNew', 'actions', 'actionNew']);
            sent.length = 0;
            ($$('.tree-row').find((r) => r.dataset.name === 'menuFile') as HTMLElement).click();
            assert.deepEqual(sent.find((m) => m.type === 'inspect'), { type: 'inspect', name: 'menuBar' });
        });

        it('the outline filter keeps ancestors of matches', () => {
            post({ snapshot: tree() });
            const f = $('#outline-filter') as HTMLInputElement;
            f.value = 'line'; f.dispatchEvent(new dom.window.Event('input'));
            assert.deepEqual(names(), ['Form', 'box', 'b']);
            f.value = 'zzz'; f.dispatchEvent(new dom.window.Event('input'));
            assert.match($('#tree .hint')?.textContent ?? '', /No object matches/);
        });

        it('arrow keys walk the outline and select as they go; Left folds, Right unfolds', () => {
            post({ snapshot: tree() });
            sent.length = 0;
            const row = (n: string) => $$('.tree-row').find((r) => r.dataset.name === n) as HTMLElement;
            key('ArrowDown', {}, row('b'));
            assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['c'] });
            key('ArrowUp', {}, row('b'));
            assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['a'] });
            key('ArrowLeft', {}, row('box'));
            assert.deepEqual(names(), ['Form', 'box', 'c']);
            key('ArrowRight', {}, row('box'));
            assert.deepEqual(names(), ['Form', 'box', 'a', 'b', 'c']);
        });

        it('> opens the command search; disabled commands go last; Enter runs the highlighted one', () => {
            post({ snapshot: tree() });
            key('>');
            const input = $('.qa-input') as HTMLInputElement;
            assert.equal(input.value, '>');
            input.value = '>undo'; input.dispatchEvent(new dom.window.Event('input'));
            assert.equal($('.qa-item.off .qa-name')?.textContent, 'Undo', 'nothing to undo yet, so it is greyed');
            input.value = '>delete'; input.dispatchEvent(new dom.window.Event('input'));
            assert.equal($('.qa-item.active .qa-name')?.textContent, 'Delete');
            sent.length = 0;
            key('Enter', {}, input);
            assert.deepEqual(sent.find((m) => m.type === 'action'), { type: 'action', action: 'delete' });
            assert.equal($('.quickadd'), null);
        });

        it('the rulers command shows a ruler along each edge in form pixels, and hides them again', () => {
            post({ snapshot: tree() });
            assert.equal($('.ruler'), null);
            for (const wanted of ['Show rulers', 'Hide the rulers']) {
                key('>');
                const input = $('.qa-input') as HTMLInputElement;
                input.value = '>rulers'; input.dispatchEvent(new dom.window.Event('input'));
                assert.match($('.qa-item.active .qa-name')?.textContent ?? '', new RegExp(wanted));
                key('Enter', {}, input);
                if (wanted === 'Show rulers') {
                    assert.ok($('.ruler-top'), 'top ruler');
                    assert.ok($('.ruler-left'), 'left ruler');
                    assert.ok(($('.ruler-top svg')?.querySelectorAll('line').length ?? 0) > 5, 'ticks');
                    assert.ok($$('.ruler-top text').some((t) => t.textContent === '0'), 'labelled from 0');
                }
            }
            assert.equal($('.ruler'), null);
        });

        it('commands cover alignment, zoom, tabs and help, found by keywords', () => {
            post({ snapshot: tree() });
            key('>');
            const input = $('.qa-input') as HTMLInputElement;
            input.value = '>distribute'; input.dispatchEvent(new dom.window.Event('input'));
            assert.ok($$('.qa-item .qa-name').some((n) => n.textContent === 'Distribute Horizontally'));
            input.value = '>focus'; input.dispatchEvent(new dom.window.Event('input'));
            assert.ok($$('.qa-item .qa-name').some((n) => /form settings and tab order/.test(n.textContent ?? '')), 'matched through keywords');
        });

        it('? shows the shortcuts sheet and Escape closes it', () => {
            post({ snapshot: tree() });
            key('?');
            assert.ok($('.popup.help'));
            assert.ok($$('.help-row kbd').some((k) => k.textContent === 'Ctrl+D'));
            key('Escape');
            assert.equal($('.popup.help'), null);
        });

        it('deleting shows a toast with Undo', () => {
            post({ snapshot: tree() });
            sent.length = 0;
            key('Delete');
            assert.deepEqual(sent.at(-1), { type: 'action', action: 'delete' });
            assert.match($('#toasts .toast')?.textContent ?? '', /Deleted b/);
            ($('#toasts .toast-action') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'undo' });
            assert.equal($$('#toasts .toast').length, 0);
        });

        it('copying says so', () => {
            post({ snapshot: tree(), code: { name: 'b', class: 'QLineEdit', hierarchy: ['QLineEdit'], signals: [], slots: [] } });
            $$('.tab').find((t) => t.textContent?.includes('Code'))?.click();
            ($('.code-row button[aria-label^="Copy ui->b"]') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'copyText', text: 'ui->b' });
            assert.match($('#toasts .toast')?.textContent ?? '', /Copied ui->b/);
        });

        it('the history menu lists the undo stack and jumps several steps at once', () => {
            post({ snapshot: snap({ canUndo: true, undoIndex: 3, undoCount: 3 }) });
            sent.length = 0;
            ($('button[data-history-menu]') as HTMLElement).click();
            assert.deepEqual(sent.at(-1), { type: 'history' });
            post({ type: 'history', items: ['Move a', 'Resize b', 'Delete c'], index: 3 });
            const labels = $$('.menu .menu-label').map((l) => l.textContent);
            assert.deepEqual(labels.slice(0, 4), ['Delete c', 'Resize b', 'Move a', 'Original document']);
            $$('.menu-item').find((i) => i.textContent?.includes('Move a'))?.click();
            assert.deepEqual(sent.at(-1), { type: 'undo', steps: 2 });
            post({ type: 'history', items: ['Move a', 'Resize b', 'Delete c'], index: 1 });
            $$('.menu-item').find((i) => i.textContent?.includes('Delete c'))?.click();
            assert.deepEqual(sent.at(-1), { type: 'redo', steps: 2 });
        });

        it('Tab and Shift+Tab walk the widgets, Ctrl+arrows go to the parent or first child', () => {
            post({ snapshot: tree() });
            sent.length = 0;
            key('Tab');
            assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['c'] });
            key('Tab', { shiftKey: true });
            assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['a'] });
            key('ArrowUp', { ctrlKey: true });
            assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['box'] });
            post({ snapshot: { ...tree(), selection: ['box'] } });
            key('ArrowDown', { ctrlKey: true });
            assert.deepEqual(sent.at(-1), { type: 'selectNames', names: ['a'] });
        });

        it('zoom shortcuts: Ctrl+1 resets, Ctrl+/- step, Ctrl+0 fits', () => {
            post({ snapshot: tree() });
            key('=', { ctrlKey: true });
            assert.match($('#zoom .level')?.textContent ?? '', /125%/);
            key('-', { ctrlKey: true }); key('-', { ctrlKey: true });
            assert.match($('#zoom .level')?.textContent ?? '', /75%/);
            key('1', { ctrlKey: true });
            assert.match($('#zoom .level')?.textContent ?? '', /100%/);
        });

        it('Space + drag pans the canvas; the middle button too', () => {
            post({ snapshot: tree() });
            const vp = $('#viewport') as HTMLElement;
            vp.scrollLeft = 100; vp.scrollTop = 50;
            dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
            assert.equal(vp.classList.contains('pan-ready'), true);
            ptr(vp, 'pointerdown', 200, 200); ptr(vp, 'pointermove', 170, 180);
            assert.equal(vp.classList.contains('panning'), true);
            assert.deepEqual([vp.scrollLeft, vp.scrollTop], [130, 70]);
            ptr(vp, 'pointerup', 170, 180);
            dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
            assert.equal(vp.classList.contains('pan-ready'), false);
            vp.scrollLeft = 0;
            ptr(vp, 'pointerdown', 50, 50, { button: 1 }); ptr(vp, 'pointermove', 20, 50); ptr(vp, 'pointerup', 20, 50);
            assert.equal(vp.scrollLeft, 30);
            assert.equal(sent.some((m) => m.type === 'hitSelect' || m.type === 'selectNames'), false, 'panning never selects');
        });

        it('dragging shows distances to the neighbours and to the edges of the parent', () => {
            const s = snap({
                selection: ['a'],
                objects: [
                    obj({ name: 'Form', class: 'QWidget', parent: null, x: 0, y: 0, w: 320, h: 200 }),
                    obj({ name: 'a', class: 'QPushButton', parent: 'Form', x: 100, y: 80, w: 50, h: 20 }),
                    obj({ name: 'left', class: 'QLabel', parent: 'Form', x: 10, y: 80, w: 40, h: 20 }),
                ],
            });
            post({ snapshot: s });
            const vp = $('#viewport') as HTMLElement;
            ptr(vp, 'pointerdown', 120, 90); ptr(vp, 'pointermove', 130, 90, { altKey: true });
            const labels = $$('#ghost .tag.measure').map((t) => t.textContent);
            assert.ok(labels.includes('60'), `gap to the label on the left: ${labels.join(',')}`);
            assert.ok(labels.includes('160'), 'gap to the parent edge on the right');
        });

        it('an empty form says what to do, and the hint goes away once it has content', () => {
            post({ snapshot: snap() });
            assert.match($('.empty-hint')?.textContent ?? '', /This form is empty/);
            post({ snapshot: tree() });
            assert.equal($('.empty-hint'), null);
        });

        it('a form bigger than the window opens fitted, unless a zoom was chosen before', async () => {
            boot();
            const vp = $('#viewport') as HTMLElement;
            Object.defineProperty(vp, 'clientWidth', { value: 700, configurable: true });
            Object.defineProperty(vp, 'clientHeight', { value: 500, configurable: true });
            post({ snapshot: snap({ width: 2200, height: 1500 }) });
            await new Promise((r) => setTimeout(r, 120));
            assert.ok(Number.parseInt($('#zoom .level')?.textContent ?? '100', 10) < 40, 'fitted');
            boot({ zoom: 2 });
            Object.defineProperty(($('#viewport') as HTMLElement), 'clientWidth', { value: 700, configurable: true });
            post({ snapshot: snap({ width: 2200, height: 1500 }) });
            await new Promise((r) => setTimeout(r, 120));
            assert.match($('#zoom .level')?.textContent ?? '', /200%/);
        });
    });
});
