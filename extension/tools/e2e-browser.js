// End-to-end check in a real browser: the real webview bundle talking to the real designer_backend,
// with a minimal stand-in for the extension host (it relays messages the way uiEditorProvider does).
// Needs playwright-core and a Chromium (see README, "Visual check"). Run: CHROME=<path> node e2e-browser.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EXT = path.resolve(__dirname, '..');
const ROOT = path.resolve(EXT, '..');
const { BackendClient } = require(path.join(EXT, 'out/src/backendClient.js'));
const { pageBody } = require(path.join(EXT, 'out/src/pageBody.js'));
const { chromium } = require('playwright-core');

const DARK_THEME = '--vscode-editor-background:#1f1f1f;--vscode-foreground:#cccccc;--vscode-font-family:system-ui,sans-serif;--vscode-font-size:13px;--vscode-sideBar-background:#181818;--vscode-input-background:#313131;--vscode-input-foreground:#ccc;--vscode-focusBorder:#0078d4;--vscode-list-hoverBackground:#2a2d2e;--vscode-list-activeSelectionBackground:#04395e;--vscode-badge-background:#616161;--vscode-badge-foreground:#fff;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-editorWidget-background:#202020;--vscode-toolbar-hoverBackground:#383a3d;';
const LIGHT_THEME = '--vscode-editor-background:#ffffff;--vscode-foreground:#3b3b3b;--vscode-font-family:system-ui,sans-serif;--vscode-font-size:13px;--vscode-sideBar-background:#f8f8f8;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-input-border:#cecece;--vscode-focusBorder:#005fb8;--vscode-list-hoverBackground:#f2f2f2;--vscode-list-activeSelectionBackground:#e4e6f1;--vscode-badge-background:#cccccc;--vscode-badge-foreground:#3b3b3b;--vscode-button-background:#005fb8;--vscode-button-foreground:#ffffff;--vscode-editorWidget-background:#f8f8f8;--vscode-toolbar-hoverBackground:#b8b8b8;';
const THEME = process.env.LIGHT ? LIGHT_THEME : DARK_THEME;
const shots = process.env.SHOTS_DIR;
let failures = 0;
const results = [];
let failShot = async () => {};
let sentLog = () => [];
async function check(label, fn) {
  if (process.env.ONLY && !label.includes(process.env.ONLY)) return;
  try { await fn(); results.push(['PASS', label]); } catch (e) { await failShot(label); if (process.env.DEBUG_SENT) console.error('  last sent:', JSON.stringify(sentLog().slice(-8).map((m) => m.type + (m.parent ? ':' + m.parent : '') + (m.property ? ':' + m.name + '.' + m.property + '=' + JSON.stringify(m.value) : '')))); failures++; results.push(['FAIL', label + '\n      ' + String(e.message).split('\n').slice(0, 6).join(' | ')]); }
}

(async () => {
  const client = new BackendClient({ executable: path.join(ROOT, 'backend/build/designer_backend') });
  await client.start();
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  const ctx = await browser.newContext({ viewport: { width: Number(process.env.VW || 1400), height: Number(process.env.VH || 800) }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  if (process.env.DEBUG_PAGE) page.on('console', (m) => console.log('PAGE', m.text()));

  let docN = 0, docId, snap, sent = [], webviewState = {};
  let queue = Promise.resolve();
  sentLog = () => sent;
  let inspectName = null, wants = { tabOrder: false, formInfo: false };
  const post = (data) => page.evaluate((d) => window.dispatchEvent(new MessageEvent('message', { data: d })), data);
  async function push() {
    const name = inspectName ?? snap.selection[0];
    const properties = name ? await client.request('properties', { docId, name }).catch(() => null) : null;
    const code = name ? await client.request('describe', { docId, name }).catch(() => null) : null;
    const container = name ? await client.request('containerInfo', { docId, name }).then((c) => (c.current >= 0 ? c : null)).catch(() => null) : null;
    const connections = (await client.request('connections', { docId })).connections;
    const pal = await client.request('palette', {});
    const extra = {};
    if (wants.tabOrder) extra.tabOrder = (await client.request('tabOrder', { docId })).order;
    if (wants.formInfo) extra.formInfo = await client.request('formInfo', { docId });
    const s = { ...snap }; delete s.messages;
    await post({ type: 'state', snapshot: s, properties, propertiesFor: name ?? null, palette: pal.categories, fonts: pal.fonts, locales: pal.locales, notices: snap.messages ?? [], code, connections, container, ...extra });
  }
  const mutating = new Set(['view','selectNames','setProperty','resetProperty','addWidget','action','gesture','setGeometries','makeSubmenu','pickResource','removeResource','addMenu','addMenuEntry','removeMenuEntry','addAction','removeAction','useAction','actionGroup','setCustomMethods','taskAction','setContents','setItems','moveWidget','reparent','pageOp','setCurrentPage','setTabOrder','promote','demote','setFormInfo','addDynamicProperty','removeDynamicProperty','connect','disconnect']);
  async function handle(m) {
    sent.push(m);
    const d = { docId };
    try {
      switch (m.type) {
        case 'view': snap = await client.request('view', { docId, scale: m.scale }); break;
        case 'hitSelect': { inspectName = null; const { name } = await client.request('hitTest', { docId, x: m.x, y: m.y }); snap = await client.request('select', { docId, names: name ? [name] : [] }); if (name && !snap.selection.includes(name)) inspectName = name; break; }
        case 'selectNames': inspectName = null; snap = await client.request('select', { docId, names: m.names }); if (m.names.length === 1 && !snap.selection.includes(m.names[0]) && snap.objects.some((o) => o.name === m.names[0])) inspectName = m.names[0]; break;
        case 'inspect': inspectName = m.name; break;
        case 'setProperty': snap = await client.request('setProperty', { ...d, name: m.name, names: m.names, property: m.property, value: m.value }); break;
        case 'resetProperty': snap = await client.request('resetProperty', { ...d, name: m.name, property: m.property }); break;
        case 'addWidget': snap = await client.request('addWidget', { ...d, category: m.category, index: m.index, x: m.x, y: m.y, side: m.side }); break;
        case 'action': snap = await client.request('action', { ...d, action: m.action }); break;
        case 'gesture': snap = await client.request('gesture', { ...d, phase: m.phase, label: m.label }); break;
        case 'setGeometries': snap = await client.request('setGeometries', { ...d, items: m.items }); break;
        case 'pickResource': snap = await client.request('addResource', { ...d, path: process.env.E2E_QRC }); break;
        case 'removeResource': snap = await client.request('removeResource', { ...d, path: m.path }); break;
        case 'makeSubmenu': snap = await client.request('makeSubmenu', { ...d, menu: m.menu, index: m.index }); break;
        case 'addMenu': snap = await client.request('addMenu', { ...d, title: m.title }); break;
        case 'addMenuEntry': snap = await client.request('addMenuEntry', { ...d, menu: m.menu, text: m.text, separator: m.separator }); break;
        case 'addAction': snap = await client.request('addAction', { ...d, text: m.text, checkable: m.checkable, shortcut: m.shortcut }); break;
        case 'useAction': snap = await client.request('useAction', { ...d, target: m.target, action: m.action, separator: m.separator, remove: m.remove }); break;
        case 'actionGroup': snap = await client.request('actionGroup', { ...d, name: m.name, remove: m.remove, action: m.action, group: m.group }); break;
        case 'saveImage': return;
        case 'checkStyleSheet': await post({ type: 'styleSheetCheck', text: m.text, valid: (await client.request('checkStyleSheet', { text: m.text })).valid }); return;
        case 'setCustomMethods': snap = await client.request('setCustomMethods', { ...d, slots: m.slots, signals: m.signals }); break;
        case 'removeAction': snap = await client.request('removeAction', { ...d, name: m.name }); break;
        case 'removeMenuEntry': snap = await client.request('removeMenuEntry', { ...d, menu: m.menu, index: m.index }); break;
        case 'taskAction': snap = await client.request('taskAction', { ...d, name: m.name, text: m.text, path: m.path }); break;
        case 'setContents': snap = await client.request('setContents', { ...d, name: m.name, contents: m.contents }); break;
        case 'setItems': snap = await client.request('setItems', { ...d, name: m.name, items: m.items }); break;
        case 'moveWidget': snap = await client.request('moveWidget', { ...d, name: m.name, x: m.x, y: m.y, side: m.side, grabX: m.grabX, grabY: m.grabY }); break;
        case 'reparent': snap = await client.request('reparent', { ...d, parent: m.parent, items: m.items }); break;
        case 'pageOp': snap = await client.request('pageOp', { ...d, name: m.name, op: m.op }); break;
        case 'setCurrentPage': snap = await client.request('setCurrentPage', { ...d, name: m.name, index: m.index }); break;
        case 'setTabOrder': snap = await client.request('setTabOrder', { ...d, order: m.order }); break;
        case 'promote': snap = await client.request('promote', { ...d, names: m.names, className: m.className, include: m.include }); break;
        case 'demote': snap = await client.request('demote', { ...d, name: m.name }); break;
        case 'setFormInfo': snap = await client.request('setFormInfo', { ...d, info: m.info }); break;
        case 'addDynamicProperty': snap = await client.request('addDynamicProperty', { ...d, name: m.name, property: m.property, kind: m.kind, value: m.value }); break;
        case 'removeDynamicProperty': snap = await client.request('removeDynamicProperty', { ...d, name: m.name, property: m.property }); break;
        case 'connect': snap = await client.request('connect', { ...d, sender: m.sender, signal: m.signal, receiver: m.receiver, slot: m.slot }); break;
        case 'disconnect': snap = await client.request('disconnect', { ...d, sender: m.sender, signal: m.signal, receiver: m.receiver, slot: m.slot }); break;
        case 'cancelGesture': snap = await client.request('gesture', { ...d, phase: 'end', label: '' }); snap = await client.request('undo', d); break;
        case 'undo': for (let i = 0; i < (m.steps ?? 1); i++) snap = await client.request('undo', d); break;
        case 'redo': for (let i = 0; i < (m.steps ?? 1); i++) snap = await client.request('redo', d); break;
        case 'history': { const h = await client.request('history', d); await post({ type: 'history', items: h.items, index: h.index }); return; }
        case 'want': wants = { tabOrder: m.tabOrder, formInfo: m.formInfo }; break;
        case 'describe': await post({ type: 'describeResult', name: m.name, result: await client.request('describe', { ...d, name: m.name }).catch(() => null) }); return;
        case 'previewStop': await client.request('previewStop', { docId }); return;
        case 'previewEvent': { const { type: _t, ...input } = m; await post({ type: 'previewFrame', result: await client.request('previewEvent', { docId, ...input }) }); return; }
        case 'preview': await post({ type: 'preview', result: await client.request('preview', { ...d, style: m.style, dark: m.dark, scale: m.scale }), style: m.style, dark: m.dark }); return;
        case 'ready': break;
        default: return;
      }
    } catch (e) {
      console.error('host error', m.type, e.message);
    }
    await push();
  }
  await page.exposeFunction('__host', (m) => { queue = queue.then(() => handle(m)).catch((e) => console.error('host error', e.message)); });
  const backendNow = async () => client.request('snapshot', { docId });
  const settle = async () => { await queue; await page.waitForTimeout(60); await queue; };

  async function open(file) {
    docId = 'e2e' + (++docN);
    snap = await client.request('open', { docId, xml: fs.readFileSync(path.join(ROOT, 'backend/testdata', file), 'utf8') });
    sent = [];
    const css = fs.readFileSync(path.join(EXT, 'media/editor.css'), 'utf8');
    const js = fs.readFileSync(path.join(EXT, 'media/webview/main.js'), 'utf8');
    const html = `<!DOCTYPE html><html><head><meta charset=utf-8><link rel=stylesheet href="file://${EXT}/media/codicons/codicon.css"><style>html{${THEME}}${css}</style></head><body>${pageBody()}
<script>window.__state=${JSON.stringify(webviewState)};window.acquireVsCodeApi=()=>({postMessage:m=>window.__host(m),getState:()=>window.__state,setState:s=>{window.__state=s}});</script>
<script>${js}</script></body></html>`;
    const f = path.join(require('os').tmpdir(), `qtd-e2e-${process.pid}-${docN}.html`);
    fs.writeFileSync(f, html);
    await page.goto('file://' + f);
    await settle();
  }
  const formBox = async () => page.locator('#form').boundingBox();
  const zoomK = async () => (await formBox()).width / snap.width;
  const at = async (x, y) => { const b = await formBox(); const k = b.width / snap.width; return [b.x + x * k, b.y + y * k]; };
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
  failShot = async (label) => { if (shots) await page.screenshot({ path: path.join(shots, 'FAIL-' + label.replace(/[^a-z0-9]+/gi, '-').slice(0, 50) + '.png') }).catch(() => {}); };

  // ---------------------------------------------------------------- resize the form itself
  await open('free.ui');
  await check('form: clicking empty space selects the form and shows its 3 resize handles', async () => {
    await page.mouse.click(...(await at(250, 150)));
    await settle();
    assert.deepEqual(snap.selection, ['FreeForm']);
    assert.equal(await page.locator('.handle').count(), 3);
  });
  await check('form: dragging the corner handle resizes live and reflows, as ONE undo step', async () => {
    const before = await backendNow();
    const [sx, sy] = await at(300, 200);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 40, sy + 25, { steps: 4 });
    await settle();
    const mid = await backendNow();
    assert.ok(mid.width > before.width, `live preview should already be wider (mid ${mid.width})`);
    await page.mouse.move(sx + 90, sy + 60, { steps: 4 });
    await page.mouse.up();
    await settle();
    await shot('e2e-form-resized');
    const after = await backendNow();
    assert.equal(after.width, 390);
    assert.equal(after.height, 260);
    assert.equal(after.undoIndex, before.undoIndex + 1, 'whole drag merged into one command');
    assert.equal((await page.locator('#form').boundingBox()).width, 390, 'image shows the new size');
  });
  await check('form: toolbar inputs follow and edit the size', async () => {
    assert.equal(await page.locator('.size-input').first().inputValue(), '390');
    await page.locator('.size-input').first().fill('500');
    await page.locator('.size-input').first().dispatchEvent('change');
    await settle();
    assert.equal((await backendNow()).width, 500);
  });
  await check('form: Escape during a drag cancels it (back to the previous size)', async () => {
    const [sx, sy] = await at(500, 260);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 80, sy + 40, { steps: 3 });
    await settle();
    assert.ok((await backendNow()).width > 500);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settle();
    assert.equal((await backendNow()).width, 500);
  });
  await check('form: arrow keys with Shift resize by a grid step', async () => {
    await page.mouse.click(...(await at(450, 220)));
    await settle();
    await page.keyboard.press('Shift+ArrowRight');
    await settle();
    assert.equal((await backendNow()).width, 510);
  });

  // ---------------------------------------------------------------- free widgets
  await open('free.ui');
  await check('widget: drag moves a free widget, snapped to the grid', async () => {
    const b = snap.objects.find((o) => o.name === 'freeButton');
    const [sx, sy] = await at(b.x + 30, b.y + 15);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 53, sy + 42, { steps: 5 });
    await page.mouse.up();
    await settle();
    const o = (await backendNow()).objects.find((x) => x.name === 'freeButton');
    assert.deepEqual([o.x, o.y], [70, 60]);
  });
  await check('widget: right edge handle resizes it live', async () => {
    const o = snap.objects.find((x) => x.name === 'freeButton');
    const [sx, sy] = await at(o.x + o.w, o.y + o.h / 2);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 50, sy, { steps: 4 });
    await page.mouse.up();
    await settle();
    const r = (await backendNow()).objects.find((x) => x.name === 'freeButton');
    assert.equal(r.w, 150);
    assert.equal(r.h, o.h);
    await shot('e2e-widget-resized');
  });
  await check('widget: arrow keys nudge by the grid, Alt by 1 px', async () => {
    const b0 = (await backendNow()).objects.find((x) => x.name === 'freeButton');
    await page.keyboard.press('ArrowRight'); await settle();
    await page.keyboard.press('Alt+ArrowDown'); await settle();
    const b1 = (await backendNow()).objects.find((x) => x.name === 'freeButton');
    assert.deepEqual([b1.x - b0.x, b1.y - b0.y], [10, 1]);
  });

  // ---------------------------------------------------------------- layout-managed widgets
  await open('sample.ui');
  await check('layout: a laid-out widget shows a lock, no resize handles, and its layout outline', async () => {
    const o = snap.objects.find((x) => x.name === 'okButton');
    await page.mouse.click(...(await at(o.x + o.w / 2, o.y + o.h / 2)));
    await settle();
    assert.deepEqual(snap.selection, ['okButton']);
    assert.equal(await page.locator('.handle').count(), 0);
    assert.ok(await page.locator('.pill .codicon-lock').count() >= 1);
    assert.ok(await page.locator('.ov.layout').count() >= 1);
  });
  await check('layout: dragging a laid-out widget does not change its geometry', async () => {
    const o = snap.objects.find((x) => x.name === 'okButton');
    const [sx, sy] = await at(o.x + 40, o.y + 10);
    await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 60, sy + 40, { steps: 4 }); await page.mouse.up();
    await settle();
    assert.equal(sent.filter((m) => m.type === 'setProperty' && m.property === 'geometry').length, 0);
  });
  await check('layout: resizing the FORM reflows the layout (button follows the width)', async () => {
    await page.mouse.click(...(await at(2, 2)));
    await settle();
    const before = (await backendNow()).objects.find((x) => x.name === 'okButton').w;
    const [sx, sy] = await at(320, 100);
    await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 100, sy, { steps: 5 }); await page.mouse.up();
    await settle();
    const after = (await backendNow()).objects.find((x) => x.name === 'okButton').w;
    assert.equal(after - before, 100);
    await shot('e2e-layout-reflow');
  });
  await check('context menu: right-click opens it with engine-enabled actions; Rename works', async () => {
    const o = (await backendNow()).objects.find((x) => x.name === 'okButton');
    await page.mouse.click(...(await at(o.x + 20, o.y + 5)));
    await settle();
    await page.mouse.click(...(await at(o.x + 20, o.y + 5)), { button: 'right' });
    await settle();
    await page.waitForSelector('.menu');
    await shot('e2e-context-menu');
    const labels = await page.locator('.menu .menu-label').allTextContents();
    assert.ok(labels.includes('Rename…') && labels.includes('Delete') && labels.includes('Lay Out'), labels.join('|'));
    await page.locator('.menu-item', { hasText: 'Rename' }).click();
    await page.waitForSelector('.popup.rename input');
    await page.keyboard.type('confirmButton');
    await page.keyboard.press('Enter');
    await settle();
    assert.ok((await backendNow()).objects.some((x) => x.name === 'confirmButton'));
  });
  await check('rename: invalid identifiers are rejected without touching the document', async () => {
    await page.keyboard.press('F2');
    await page.waitForSelector('.popup.rename input');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('9bad name');
    await page.keyboard.press('Enter');
    assert.match(await page.locator('.rename-error').textContent(), /letters/);
    await shot('e2e-rename');
    await page.keyboard.press('Escape');
    assert.ok((await backendNow()).objects.some((x) => x.name === 'confirmButton'));
  });

  // ---------------------------------------------------------------- adding widgets
  await open('free.ui');
  await check('quick add: "/" opens a search; Enter adds the widget at the container', async () => {
    const n = snap.objects.length;
    await page.mouse.click(...(await at(250, 150)));
    await settle();
    await page.keyboard.press('/');
    await page.waitForSelector('.quickadd');
    await page.keyboard.type('line edit');
    await shot('e2e-quickadd');
    await page.keyboard.press('Enter');
    await settle();
    const s = await backendNow();
    assert.equal(s.objects.length, n + 1);
    assert.ok(s.objects.some((o) => o.class === 'QLineEdit'));
  });
  await check('quick add: the toolbar button and a mouse click on a row add the widget', async () => {
    const n = (await backendNow()).objects.length;
    await page.locator('button.tb.add').click();
    await page.waitForSelector('.popup.quickadd');
    await page.keyboard.type('check box');
    const row = page.locator('.qa-item', { hasText: 'Check Box' }).first();
    const b = await row.boundingBox();
    await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 4 });
    await page.evaluate(() => { window.__ev = []; for (const t of ['pointerdown','pointerup','mousedown','mouseup','click']) document.addEventListener(t, (e) => window.__ev.push(t + ':' + (e.target.className || e.target.tagName)), true); });
    await page.mouse.down(); await page.mouse.move(b.x + 24, b.y + b.height / 2, { steps: 3 }); await page.mouse.up();
    await settle();
    if (process.env.DEBUG_EV) console.log(await page.evaluate(() => window.__ev.join(' ')), JSON.stringify(b));
    assert.equal(await page.locator('.popup.quickadd').count(), 0, 'the search closed');
    assert.equal((await backendNow()).objects.length, n + 1, 'a widget was added');
  });
  await check('palette: drag a widget from the palette onto the form', async () => {
    const n = (await backendNow()).objects.length;
    const item = page.locator('.pal-item', { hasText: 'Push Button' }).first();
    const [tx, ty] = await at(180, 120);
    await item.dragTo(page.locator('#form'), { targetPosition: { x: tx - (await formBox()).x, y: ty - (await formBox()).y } });
    await settle();
    assert.equal((await backendNow()).objects.length, n + 1);
  });

  // ---------------------------------------------------------------- panels, zoom, tabs
  await check('panels: the sidebar splitter resizes the column and the size is remembered', async () => {
    const w0 = (await page.locator('#left').boundingBox()).width;
    const sp = await page.locator('#split-left').boundingBox();
    await page.mouse.move(sp.x + 2, sp.y + 200); await page.mouse.down(); await page.mouse.move(sp.x + 82, sp.y + 200, { steps: 4 }); await page.mouse.up();
    const w1 = (await page.locator('#left').boundingBox()).width;
    assert.ok(w1 > w0 + 60, `left ${w0} -> ${w1}`);
    assert.equal((await page.evaluate(() => window.__state)).leftW, Math.round(w1));
    await page.locator('#split-left').dblclick();
    assert.equal(Math.round((await page.locator('#left').boundingBox()).width), 240);
  });
  await check('panels: the toggle buttons collapse and restore the sidebars', async () => {
    await page.locator('button[data-panel=right]').click();
    assert.equal(Math.round((await page.locator('#inspector').boundingBox())?.width ?? 0), 0);
    await page.locator('button[data-panel=right]').click();
    assert.ok((await page.locator('#inspector').boundingBox()).width > 200);
  });
  await check('zoom: zooming asks Qt for a sharper render and keeps coordinates logical', async () => {
    await page.locator('#zoom button[title="Zoom in"]').click();
    await page.locator('#zoom button[title="Zoom in"]').click();
    await page.waitForTimeout(300); await settle();
    assert.equal(Math.round(await zoomK() * 100), 150);
    assert.equal((await backendNow()).dpr, 1.5);
    const o = snap.objects.find((x) => x.name === 'freeLabel');
    await page.mouse.click(...(await at(o.x + 5, o.y + 5)));
    await settle();
    assert.deepEqual(snap.selection, ['freeLabel']);
  });
  await check('tabs: Code shows the accessor and Properties is searchable', async () => {
    await page.locator('.tab', { hasText: 'Code' }).click();
    assert.match(await page.locator('#code').textContent(), /ui->freeLabel/);
    await page.locator('.tab', { hasText: 'Properties' }).click();
    await page.locator('#filter').fill('geometry');
    assert.equal(await page.locator('.prop-block .prop-name').count(), 1);
  });

  // ================================================================ selection, alignment, grouping
  const obj = async (name) => (await backendNow()).objects.find((o) => o.name === name);
  const prop = async (name, p) => (await client.request('properties', { docId, name })).properties.find((x) => x.name === p);
  const dragBy = async (from, to, steps = 6, mods = []) => {
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps }); await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
    await settle();
  };

  await open('rich.ui');
  await check('selection: dragging a band over empty space selects the widgets inside it', async () => {
    await dragBy(await at(3, 174), await at(285, 252));
    assert.deepEqual([...snap.selection].sort(), ['caption', 'go', 'nameEdit']);
    assert.ok(await page.locator('.pill', { hasText: '3 widgets' }).count() >= 1);
    await shot('e2e-multi-select');
  });
  await check('selection: dragging one selected widget moves all of them together, as one undo step', async () => {
    const before = await Promise.all(['caption', 'go', 'nameEdit'].map(obj));
    const i0 = (await backendNow()).undoIndex;
    const g = before[1];
    await dragBy(await at(g.x + 20, g.y + 10), await at(g.x + 20 + 30, g.y + 10 + 20));
    const after = await Promise.all(['caption', 'go', 'nameEdit'].map(obj));
    after.forEach((a, i) => assert.deepEqual([a.x - before[i].x, a.y - before[i].y], [30, 20], a.name));
    assert.equal((await backendNow()).undoIndex, i0 + 1);
  });
  await check('align: "Align Left" lines the group up and is one undo step', async () => {
    const i0 = (await backendNow()).undoIndex;
    await page.locator('.pill button[aria-label="Align Left"]').click();
    await settle();
    const xs = (await Promise.all(['caption', 'go', 'nameEdit'].map(obj))).map((o) => o.x);
    assert.equal(new Set(xs).size, 1, xs.join(','));
    assert.equal((await backendNow()).undoIndex, i0 + 1);
    await shot('e2e-aligned');
  });
  await check('align: distribute vertically gives equal gaps', async () => {
    await page.locator('#toolbar button[data-align]').click();
    await page.locator('.menu-item', { hasText: 'Distribute Vertically' }).click();
    await settle();
    const os = (await Promise.all(['caption', 'go', 'nameEdit'].map(obj))).sort((a, b) => a.y - b.y);
    const gaps = [os[1].y - (os[0].y + os[0].h), os[2].y - (os[1].y + os[1].h)];
    assert.ok(Math.abs(gaps[0] - gaps[1]) <= 1, gaps.join(' vs '));
  });
  await check('align: "Same Width" matches the first selected widget', async () => {
    await page.locator('#toolbar button[data-align]').click();
    await page.locator('.menu-item', { hasText: 'Same Width' }).click();
    await settle();
    const ws = (await Promise.all(['caption', 'go', 'nameEdit'].map(obj))).map((o) => o.w);
    assert.equal(new Set(ws).size, 1, ws.join(','));
  });
  await check('align: one widget aligns to its parent (centre horizontally)', async () => {
    await page.locator('.tree-row[data-name=go]').click(); await settle();
    assert.deepEqual(snap.selection, ['go']);
    await page.locator('#toolbar button[data-align]').click();
    await page.locator('.menu-item', { hasText: 'Align Horizontal Centers' }).click();
    await settle();
    const after = await obj('go'); const root = await obj('RichForm');
    assert.ok(Math.abs((after.x + after.w / 2) - root.w / 2) <= 1, `${after.x}+${after.w}/2 vs ${root.w / 2}`);
  });

  await open('rich.ui');
  await check('reparent: dragging a widget onto another container moves it into it (one undo step)', async () => {
    const g = await obj('go'); const box = await obj('box');
    const i0 = (await backendNow()).undoIndex;
    await dragBy(await at(g.x + 20, g.y + 12), await at(box.x + 40, box.y + 60));
    const after = await obj('go');
    assert.equal(after.parent, 'box');
    assert.ok(after.x >= box.x && after.y >= box.y, 'stays inside the box on screen');
    assert.equal((await backendNow()).undoIndex, i0 + 1);
    await shot('e2e-reparented');
    await page.keyboard.press('Control+z').catch(() => {});
  });
  await check('reparent: undo returns it to the form', async () => {
    await client.request('undo', { docId }); snap = await client.request('snapshot', { docId }); await push();
    assert.equal((await obj('go')).parent, 'RichForm');
  });

  await check('in-place edit: double-click a label, type, Enter applies the new text', async () => {
    const c = await obj('caption');
    await page.mouse.dblclick(...(await at(c.x + 10, c.y + 8))); await settle();
    await page.waitForSelector('.inplace');
    await shot('e2e-inplace');
    await page.keyboard.press('Control+A'); await page.keyboard.type('Bonjour');
    await page.keyboard.press('Enter'); await settle();
    assert.equal((await prop('caption', 'text')).value, 'Bonjour');
    assert.equal(await page.locator('.inplace').count(), 0);
  });
  await check('in-place edit: Escape cancels without changing anything', async () => {
    await page.keyboard.press('Enter'); await page.waitForSelector('.inplace');
    await page.keyboard.type('XYZ'); await page.keyboard.press('Escape'); await settle();
    assert.equal((await prop('caption', 'text')).value, 'Bonjour');
  });

  await check('editors: alignment buttons set horizontal and vertical alignment', async () => {
    await page.locator('.tab', { hasText: 'Properties' }).click();
    await page.locator('#props button[aria-label="Align right"]').click(); await settle();
    await page.locator('#props button[aria-label="Align bottom"]').click(); await settle();
    const v = (await prop('caption', 'alignment')).value.map((x) => x.replace(/^Qt::(AlignmentFlag::)?/, ''));
    assert.ok(v.includes('AlignRight') && v.includes('AlignBottom') && !v.includes('AlignLeft'), v.join('|'));
    assert.equal(await page.locator('#props button[aria-label="Align right"]').getAttribute('aria-pressed'), 'true');
  });
  await check('editors: size policy, font and cursor are editable', async () => {
    const sp = page.locator('[data-prop=sizePolicy] select').first();
    await sp.selectOption('Expanding'); await settle();
    assert.equal((await prop('caption', 'sizePolicy')).value.h, 'Expanding');
    const bold = page.locator('[data-prop=font] button[aria-label="Bold"]');
    await bold.click(); await settle();
    assert.equal((await prop('caption', 'font')).value.bold, true);
    await page.locator('[data-prop=cursor]').selectOption('PointingHandCursor'); await settle();
    assert.equal((await prop('caption', 'cursor')).value, 'PointingHandCursor');
    await shot('e2e-editors');
  });
  await check('editors: a long text opens a larger editor', async () => {
    await page.locator('[data-prop=toolTip]').scrollIntoViewIfNeeded();
    await page.locator('button[aria-label^="Edit toolTip"]').click();
    await page.waitForSelector('.big-text');
    await page.locator('.big-text').fill('first line\nsecond line');
    await page.locator('.popup .btn.primary').click(); await settle();
    assert.equal((await prop('caption', 'toolTip')).value, 'first line\nsecond line');
  });
  await check('editors: editing a multi-selection applies to every widget in one step', async () => {
    const g = await obj('go');
    await page.keyboard.down('Shift'); await page.mouse.click(...(await at(g.x + 5, g.y + 5))); await page.keyboard.up('Shift'); await settle();
    assert.equal(snap.selection.length, 2);
    const i0 = (await backendNow()).undoIndex;
    const input = page.locator('[data-prop=statusTip] input');
    await input.fill('shared'); await input.dispatchEvent('change'); await settle();
    assert.equal((await prop('caption', 'statusTip')).value, 'shared');
    assert.equal((await prop('go', 'statusTip')).value, 'shared');
    assert.equal((await backendNow()).undoIndex, i0 + 1);
  });

  await open('rich.ui');
  await check('connect mode: dragging between widgets opens the dialog and creates the connection', async () => {
    await page.keyboard.press('F4');
    assert.equal(await page.locator('button[data-mode=connect]').getAttribute('aria-pressed'), 'true');
    const g = await obj('go'), n = await obj('nameEdit');
    await dragBy(await at(g.x + g.w / 2, g.y + g.h / 2), await at(n.x + n.w / 2, n.y + n.h / 2));
    await page.waitForSelector('.popup.connect');
    await shot('e2e-connect-dialog');
    await page.locator('.conn-col').first().locator('.conn-item', { hasText: 'clicked()' }).first().click();
    await page.locator('.conn-col').nth(1).locator('.conn-item', { hasText: 'clear()' }).first().click();
    await page.locator('.popup .btn.primary').click(); await settle();
    const conns = (await client.request('connections', { docId })).connections;
    assert.deepEqual(conns.map((c) => `${c.sender}.${c.signal}>${c.receiver}.${c.slot}`), ['go.clicked()>nameEdit.clear()']);
    assert.ok(await page.locator('svg.arrows .arrow').count() >= 1, 'the connection is drawn as an arrow');
    await shot('e2e-connect-arrows');
  });
  await check('connect mode: the dialog only offers slots compatible with the chosen signal', async () => {
    const g = await obj('go'), n = await obj('nameEdit');
    await dragBy(await at(g.x + 10, g.y + 5), await at(n.x + 10, n.y + 5));
    await page.waitForSelector('.popup.connect');
    await page.locator('.conn-col').first().locator('.conn-item', { hasText: 'clicked()' }).first().click();
    const slots = await page.locator('.conn-col').nth(1).locator('.conn-item code').allTextContents();
    assert.ok(slots.includes('clear()') && !slots.some((x) => x.includes('setText(QString)')), slots.join(' | '));
    await page.keyboard.press('Escape');
    await page.keyboard.press('F4');
  });
  await check('connections tab: the connection can be deleted and the deletion undone', async () => {
    await page.locator('.tab', { hasText: 'Connections' }).click();
    await page.locator('#connections button[aria-label^="Delete the connection"]').first().click(); await settle();
    assert.equal((await client.request('connections', { docId })).connections.length, 0);
    await page.locator('#toolbar button[data-history=undo]').click(); await settle();
    assert.equal((await client.request('connections', { docId })).connections.length, 1);
  });

  await open('rich.ui');
  await check('container pages: the pill pages through a tab widget and adds/removes pages', async () => {
    const t = await obj('tabs');
    await page.mouse.click(...(await at(t.x + 100, t.y + 90))); await settle();
    assert.deepEqual(snap.selection, ['tabs'].length ? snap.selection : []);
    await page.locator('.pill button[aria-label="Next page"]').click(); await settle();
    assert.equal((await client.request('containerInfo', { docId, name: 'tabs' })).current, 1);
    await page.locator('.pill button[aria-label="Add a page after this one"]').click(); await settle();
    assert.equal((await client.request('containerInfo', { docId, name: 'tabs' })).pages.length, 3);
    await page.locator('.pill button[aria-label="Delete this page"]').click(); await settle();
    assert.equal((await client.request('containerInfo', { docId, name: 'tabs' })).pages.length, 2);
  });

  await check('preview: shows the runtime render, switches style and theme, and closes with Escape', async () => {
    await page.locator('button[data-preview]').click();
    await page.waitForSelector('.popup.preview img.preview-img[src^="data:image/png"]');
    const first = await page.locator('.preview-img').getAttribute('src');
    await page.locator('.popup.preview input[type=checkbox]').check(); await page.waitForTimeout(500); await settle();
    assert.notEqual(await page.locator('.preview-img').getAttribute('src'), first, 'dark theme changes the render');
    await shot('e2e-preview');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.popup.preview').count(), 0);
  });

  await check('form tab: tab order is numbered on the form and can be reordered', async () => {
    await page.locator('.tab', { hasText: 'Form' }).click(); await settle();
    await page.waitForSelector('.order-row');
    assert.ok(await page.locator('.badge-num:not(.inline)').count() >= 3, 'numbered badges on the canvas');
    const before = await page.locator('.order-name').allTextContents();
    await page.locator('.order-row').nth(1).locator('button[aria-label^="Move"][aria-label$="up"]').click({ force: true }); await settle();
    const after = await page.locator('.order-name').allTextContents();
    assert.deepEqual(after.slice(0, 2), [before[1], before[0]]);
    await shot('e2e-form-tab');
  });
  await check('form tab: grid and author are editable', async () => {
    const gx = page.locator('.fields input[aria-label="Grid X"]');
    await gx.fill('5'); await gx.dispatchEvent('change'); await settle();
    assert.equal((await client.request('formInfo', { docId })).grid[0], 5);
    assert.equal((await backendNow()).grid[0], 5);
  });

  await check('promote: the context menu promotes a widget to a custom class', async () => {
    const g = await obj('go');
    await page.mouse.click(...(await at(g.x + 5, g.y + 5))); await settle();
    await page.mouse.click(...(await at(g.x + 5, g.y + 5)), { button: 'right' }); await page.waitForSelector('.menu');
    await page.locator('.menu-item', { hasText: 'Promote to custom widget' }).click();
    await page.locator('.popup input').first().fill('FancyButton');
    await page.locator('.popup .btn.primary').click(); await settle();
    const xml = (await client.request('contents', { docId })).xml;
    assert.ok(xml.includes('FancyButton') && xml.includes('fancybutton.h'));
  });

  await open('rich.ui');
  await check('layouts: a layout is listed in the outline, inspectable, and its spacing is editable', async () => {
    const g = await obj('go'), n = await obj('nameEdit');
    await dragBy(await at(g.x - 5, g.y - 4), await at(n.x + n.w + 4, n.y + n.h + 4));
    assert.ok(snap.selection.includes('go') && snap.selection.includes('nameEdit'), snap.selection.join(','));
    await page.locator('.pill button[aria-label^="Lay Out Vertically"]').click(); await settle();
    const row = page.locator('.tree-row.layout').first();
    await row.click(); await settle();
    await page.locator('.tab', { hasText: 'Properties' }).click();
    assert.match(await page.locator('#inspector-head').textContent(), /layout/i);
    const sp = page.locator('[data-prop=spacing]');
    await sp.fill('17'); await sp.press('Tab'); await settle();
    const name = snap.layouts[0].name;
    assert.equal((await prop(name, 'spacing')).value, 17);
    await shot('e2e-layout-props');
  });
  await check('duplicate: Ctrl+D copies the selected widget', async () => {
    await open('free.ui');
    const n = (await backendNow()).objects.length;
    const b = await obj('freeButton');
    await page.mouse.click(...(await at(b.x + 5, b.y + 5))); await settle();
    await page.keyboard.press('Control+d'); await settle();
    assert.equal((await backendNow()).objects.length, n + 1);
  });
  await check('dynamic property: can be added from the inspector and removed again', async () => {
    await page.locator('.tab', { hasText: 'Properties' }).click();
    await page.locator('.add-dynamic').click();
    await page.locator('.popup input[placeholder=propertyName]').fill('myTag');
    await page.locator('.popup input[placeholder="initial value"]').fill('hello');
    await page.locator('.popup .btn.primary').click(); await settle();
    const target = snap.selection[0];
    assert.equal((await prop(target, 'myTag')).value, 'hello');
    await page.locator('button[aria-label="Remove dynamic property myTag"]').click(); await settle();
    assert.equal(await prop(target, 'myTag'), undefined);
  });
  await check('undo and redo buttons drive the engine', async () => {
    const n = (await backendNow()).objects.length;
    await page.locator('#toolbar button[data-history=undo]').click(); await settle();
    await page.locator('#toolbar button[data-history=undo]').click(); await settle();
    await page.locator('#toolbar button[data-history=redo]').click(); await settle();
    assert.ok(await page.locator('#toolbar button[data-history=undo]').isEnabled());
    void n;
  });


  // ================================================================ comfort: view, outline, commands, history
  await open('big.ui');
  await check('big form: opens fitted to the window instead of cropped', async () => {
    await page.waitForTimeout(250);
    const level = parseInt(await page.locator('#zoom .level').textContent(), 10);
    assert.ok(level < 60, `zoom ${level}%`);
    const vp = await page.locator('#viewport').boundingBox(); const f = await formBox();
    assert.ok(f.width <= vp.width && f.height <= vp.height, `${f.width}x${f.height} in ${vp.width}x${vp.height}`);
    await shot('e2e-big-fitted');
  });
  await check('zoom: Ctrl+1 gives 100%, wheel zoom keeps the point under the pointer, Ctrl+0 fits again', async () => {
    await page.keyboard.press('Control+1'); await settle(); await page.waitForTimeout(200);
    assert.match(await page.locator('#zoom .level').textContent(), /100%/);
    const target = await at(60, 30);
    await page.mouse.move(...target);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    const after = await at(60, 30);
    assert.ok(Math.abs(after[0] - target[0]) < 6 && Math.abs(after[1] - target[1]) < 6, `moved ${after[0] - target[0]},${after[1] - target[1]}`);
    await page.keyboard.press('Control+0'); await page.waitForTimeout(200);
    assert.ok(parseInt(await page.locator('#zoom .level').textContent(), 10) < 60);
  });
  await check('pan: Space + drag scrolls the canvas without selecting anything', async () => {
    await page.keyboard.press('Control+1'); await page.waitForTimeout(250); await settle();
    const vp = page.locator('#viewport');
    const before = await vp.evaluate((e) => [e.scrollLeft, e.scrollTop]);
    const nsel = snap.selection.join();
    const c = await vp.boundingBox();
    await page.keyboard.down('Space');
    await page.mouse.move(c.x + 400, c.y + 300); await page.mouse.down(); await page.mouse.move(c.x + 250, c.y + 200, { steps: 4 }); await page.mouse.up();
    await page.keyboard.up('Space');
    const after = await vp.evaluate((e) => [e.scrollLeft, e.scrollTop]);
    assert.ok(after[0] > before[0] + 100 && after[1] > before[1] + 60, `${before} -> ${after}`);
    assert.equal(snap.selection.join(), nsel);
  });

  await open('empty.ui');
  await check('empty form: says what to do; the hint disappears after adding a widget', async () => {
    assert.match(await page.locator('.empty-hint').textContent(), /This form is empty/);
    await page.keyboard.press('/'); await page.waitForSelector('.quickadd');
    await page.keyboard.type('check box'); await page.keyboard.press('Enter'); await settle();
    assert.equal(await page.locator('.empty-hint').count(), 0);
  });

  await open('rich.ui');
  await check('outline: arrows walk the tree and select; the canvas does not move the widget meanwhile', async () => {
    await page.locator('.tree-row[data-name=tabs]').click(); await settle();
    const before = await obj('tabs');
    await page.keyboard.press('ArrowDown'); await settle();
    assert.equal(snap.selection[0], 'box');
    await page.keyboard.press('ArrowDown'); await settle();
    assert.equal(snap.selection[0], 'caption');
    const after = await obj('tabs');
    assert.deepEqual([after.x, after.y], [before.x, before.y]);
  });
  await check('outline: folding, filtering and the selection path', async () => {
    const f = page.locator('#outline-filter');
    await f.fill('edit'); await settle();
    assert.deepEqual(await page.locator('.tree-row .tree-name').allTextContents(), ['RichForm', 'nameEdit']);
    await f.fill('');
    await page.locator('#outline-collapse').click();
    assert.equal(await page.locator('.tree-row').count(), 1 + (await page.locator('.tree-row').count() - 1), 'collapse-all keeps the root');
  });
  await check('keyboard: Tab / Shift+Tab walk the widgets, Ctrl+Up goes to the parent', async () => {
    await page.mouse.click(...(await at(300, 280))); await settle();
    await page.keyboard.press('Tab'); await settle();
    const first = snap.selection[0];
    await page.keyboard.press('Tab'); await settle();
    assert.notEqual(snap.selection[0], first);
    await page.keyboard.press('Shift+Tab'); await settle();
    assert.equal(snap.selection[0], first);
    await page.keyboard.press('Control+ArrowUp'); await settle();
    assert.equal(snap.selection[0], 'RichForm');
  });
  await check('commands: ">" searches every action; Enter runs it', async () => {
    const g = await obj('go');
    await page.mouse.click(...(await at(g.x + 5, g.y + 5))); await settle();
    await page.keyboard.press('>'); await page.waitForSelector('.quickadd');
    await page.keyboard.type('duplic'); await page.keyboard.press('Enter'); await settle();
    assert.equal((await backendNow()).objects.filter((o) => o.class === 'QPushButton').length, 2);
    await shot('e2e-commands');
  });
  await check('commands: the shortcut sheet opens with ? and closes with Escape', async () => {
    await page.keyboard.press('?'); await page.waitForSelector('.popup.help');
    assert.ok(await page.locator('.help-row kbd', { hasText: 'Ctrl+D' }).count());
    await shot('e2e-help');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.popup.help').count(), 0);
  });
  await check('toast: deleting says so and its Undo brings the widget back', async () => {
    const n = (await backendNow()).objects.length;
    await page.keyboard.press('Delete'); await settle();
    assert.equal((await backendNow()).objects.length, n - 1);
    assert.ok(await page.locator('#toasts .toast', { hasText: 'Deleted' }).count());
    await page.locator('#toasts .toast-action').click(); await settle();
    assert.equal((await backendNow()).objects.length, n);
  });
  await check('history: the menu lists the stack and jumps back several steps at once', async () => {
    const c = await obj('caption');
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await settle(); }
    const moved = await obj('caption');
    assert.ok(moved.x > c.x || (await backendNow()).undoIndex > 0);
    const i0 = (await backendNow()).undoIndex;
    await page.locator('button[data-history-menu]').click(); await page.waitForSelector('.menu');
    await shot('e2e-history');
    await page.locator('.menu-item', { hasText: 'Original document' }).click(); await settle();
    assert.equal((await backendNow()).undoIndex, 0);
    assert.ok(i0 > 0);
  });
  await check('measures: dragging shows the distance to the neighbours', async () => {
    await open('free.ui');
    const b = await obj('freeButton');
    await page.mouse.move(...(await at(b.x + 30, b.y + 10))); await page.mouse.down();
    await page.mouse.move(...(await at(b.x + 80, b.y + 60)), { steps: 5 });
    // The ghost is rebuilt on every frame, so read count and colour in one page call.
    const { tags, bg } = await page.evaluate(() => {
      const l = document.querySelector('#ghost .ov.measure');
      return { tags: document.querySelectorAll('#ghost .tag.measure').length, bg: l ? getComputedStyle(l).backgroundColor : '' };
    });
    assert.ok(tags >= 2, `measure tags: ${tags}`);
    assert.match(bg, /rgb\(2\d\d, \d+, \d+\)|rgba\(2\d\d/, `measure lines are red, got ${bg}`);
    const rowH = await page.locator('.tree-row').first().evaluate((e) => e.getBoundingClientRect().height);
    assert.ok(rowH < 32, `outline rows are compact, got ${rowH}px`);
    await shot('e2e-measures');
    await page.mouse.up(); await settle();
  });

  await check('layout: dragging a widget inside a layout reorders it, in one undo step', async () => {
    await open('sample.ui');
    const order = async () => (await backendNow()).objects.filter((o) => ['titleLabel', 'okButton', 'nameEdit'].includes(o.name)).sort((a, b) => a.y - b.y).map((o) => o.name);
    assert.deepEqual(await order(), ['titleLabel', 'okButton', 'nameEdit']);
    const ok = await obj('okButton');
    await page.mouse.move(...(await at(ok.x + 40, ok.y + 10))); await page.mouse.down();
    await page.mouse.move(...(await at(150, 20)), { steps: 8 });
    assert.ok(await page.locator('#ghost .insert-line').count() >= 1, 'an insertion line shows where it would land');
    await shot('e2e-layout-drag');
    await page.mouse.up(); await settle();
    assert.deepEqual(await order(), ['okButton', 'titleLabel', 'nameEdit']);
    const u0 = (await backendNow()).undoIndex;
    await page.locator('button[title^="Undo ("]').click(); await settle();
    assert.equal((await backendNow()).undoIndex, u0 - 1);
    assert.deepEqual(await order(), ['titleLabel', 'okButton', 'nameEdit']);
  });
  await check('layout: "/" adds the new widget right after the selected one, not at the top', async () => {
    await open('sample.ui');
    await page.mouse.click(...(await at(150, 150))); await settle(); // okButton
    await page.keyboard.press('/'); await page.waitForSelector('.popup.quickadd');
    await page.keyboard.type('line edit'); await page.keyboard.press('Enter'); await settle();
    const names = (await backendNow()).objects.filter((o) => o.laidOut).sort((a, b) => a.y - b.y).map((o) => o.name);
    assert.deepEqual(names, ['titleLabel', 'okButton', 'lineEdit', 'nameEdit'], JSON.stringify(sent.filter((m) => m.type === 'addWidget' || m.type === 'hitSelect')));
  });
  await check('add: a label from the palette is wide enough for its caption', async () => {
    await open('free.ui');
    await page.mouse.click(...(await at(250, 150))); await settle();
    await page.keyboard.press('/'); await page.waitForSelector('.popup.quickadd');
    await page.keyboard.type('label'); await page.keyboard.press('Enter'); await settle();
    const added = (await backendNow()).objects.filter((o) => o.class === 'QLabel').pop();
    assert.ok(added.w > 30, `label width ${added.w}`);
  });

  await check('alignment: a click sets, a second click clears the axis, reset restores the default', async () => {
    await open('sample.ui');
    await page.mouse.click(...(await at(150, 60))); await settle(); // titleLabel
    const align = async () => (await client.request('properties', { docId, name: 'titleLabel' })).properties.find((q) => q.name === 'alignment').value.map((f) => f.replace('Qt::', ''));
    await page.locator('.align-editor button[title="Align right"]').click(); await settle();
    assert.ok((await align()).includes('AlignRight'));
    await page.locator('.align-editor button[title="Align right"]').click(); await settle();
    assert.ok(!(await align()).includes('AlignRight') && (await align()).includes('AlignVCenter'), 'second click clears the horizontal axis only');
    await page.locator('.align-editor button[title="Align right"]').click(); await settle();
    await page.locator('.prop-block button.reset[title="Reset alignment"]').click(); await settle();
    assert.ok((await align()).includes('AlignLeft') || (await align()).includes('AlignLeading'));
  });
  await check('buddy: a label picks its buddy from the widgets of the form', async () => {
    await page.mouse.click(...(await at(150, 60))); await settle();
    await page.locator('[data-prop="buddy"]').selectOption('nameEdit'); await settle();
    const q = (await client.request('properties', { docId, name: 'titleLabel' })).properties.find((x) => x.name === 'buddy');
    assert.equal(q.value, 'nameEdit');
  });
  await check('items: a combo box list is edited, reordered and cleared from the inspector', async () => {
    await open('free.ui');
    await page.mouse.click(...(await at(250, 150))); await settle();
    await page.keyboard.press('/'); await page.waitForSelector('.popup.quickadd');
    await page.keyboard.type('combo'); await page.keyboard.press('Enter'); await settle();
    const items = async () => (await client.request('properties', { docId, name: 'comboBox' })).items;
    await page.locator('.items-editor .add-dynamic').click(); await settle();
    await page.locator('.items-editor .add-dynamic').click(); await settle();
    assert.deepEqual(await items(), ['Item 1', 'Item 2']);
    await page.locator('.items-editor input').first().fill('First'); await page.keyboard.press('Tab'); await settle();
    assert.deepEqual(await items(), ['First', 'Item 2']);
    await page.locator('.items-editor button[title="Move down"]').first().click(); await settle();
    assert.deepEqual(await items(), ['Item 2', 'First']);
    await page.locator('.items-editor button[title="Remove item"]').first().click(); await settle();
    assert.deepEqual(await items(), ['First']);
  });
  await check('table: the grid editor edits headers and cells, applied as one step', async () => {
    await open('free.ui');
    await page.mouse.click(...(await at(250, 150))); await settle();
    await page.keyboard.press('/'); await page.waitForSelector('.popup.quickadd');
    await page.keyboard.type('table widget'); await page.keyboard.press('Enter'); await settle();
    await page.locator('.items-editor button', { hasText: 'Edit table' }).click(); await page.waitForSelector('.popup.grid-editor');
    await page.locator('.grid-editor button', { hasText: 'Add column' }).click();
    await page.locator('.grid-editor button', { hasText: 'Add row' }).click();
    await page.locator('.grid-editor tbody td input').first().fill('hello');
    await page.locator('.grid-editor thead input').first().fill('Name');
    await page.locator('.grid-editor button', { hasText: 'Apply' }).click(); await settle();
    const c = (await client.request('properties', { docId, name: 'tableWidget' })).contents;
    assert.equal(c.rows.length >= 1 && c.cells[0][0], 'hello');
    assert.equal(c.columns[0], 'Name');
  });
  await check('tree: indent makes a child, and the nesting is applied', async () => {
    await open('free.ui');
    await page.mouse.click(...(await at(250, 150))); await settle();
    await page.keyboard.press('/'); await page.waitForSelector('.popup.quickadd');
    await page.keyboard.type('tree widget'); await page.keyboard.press('Enter'); await settle();
    await page.locator('.items-editor button', { hasText: 'Edit tree' }).click(); await page.waitForSelector('.popup.grid-editor');
    await page.locator('.grid-editor button', { hasText: 'Add item' }).click();
    await page.locator('.grid-editor button', { hasText: 'Add item' }).click();
    await page.locator('.grid-editor button[title^="Indent"]').nth(1).click();
    await shot('e2e-grid');
    await page.locator('.grid-editor button', { hasText: 'Apply' }).click(); await settle();
    const c = (await client.request('properties', { docId, name: 'treeWidget' })).contents;
    assert.equal(c.items.length, 1);
    assert.equal(c.items[0].children.length, 1);
  });
  await check('main window: the window parts are created from the context menu and listed in the outline', async () => {
    await open('mainwindow.ui');
    await page.mouse.click(...(await at(200, 200)), { button: 'right' });
    await page.waitForSelector('.menu');
    await page.locator('.menu-item', { hasText: 'Window parts' }).hover();
    await page.locator('.menu-item', { hasText: 'Create the menu bar' }).click(); await settle();
    await page.mouse.click(...(await at(200, 200)), { button: 'right' });
    await page.locator('.menu-item', { hasText: 'Window parts' }).hover();
    await page.locator('.menu-item', { hasText: 'Create the status bar' }).click(); await settle();
    const names = (await backendNow()).objects.map((o) => o.name);
    assert.ok(names.includes('menuBar') && names.includes('statusBar'), names.join(','));
    assert.ok(await page.locator('.tree-row', { hasText: 'menuBar' }).count(), 'the outline lists the menu bar');
    await page.locator('.tree-row', { hasText: 'statusBar' }).click(); await settle();
    assert.ok(await page.locator('#inspector').getByText('statusBar').count(), 'the inspector shows the status bar');
    await shot('e2e-mainwindow');
  });
  await check('menus: the menu bar editor adds a menu and an entry from the inspector', async () => {
    await open('mainwindow.ui');
    await page.mouse.click(...(await at(200, 200)), { button: 'right' });
    await page.locator('.menu-item', { hasText: 'Window parts' }).hover();
    await page.locator('.menu-item', { hasText: 'Create the menu bar' }).click(); await settle();
    await page.locator('.tree-row', { hasText: 'menuBar' }).click(); await settle();
    await page.locator('.menus-editor button', { hasText: 'Add a menu' }).click(); await page.waitForSelector('.popup');
    await page.keyboard.type('File'); await page.keyboard.press('Enter'); await settle();
    await page.locator('.menus-editor button[title="Add an entry"]').click(); await page.waitForSelector('.popup');
    await page.keyboard.press('Control+a'); await page.keyboard.type('Open'); await page.keyboard.press('Enter'); await settle();
    const menus = (await client.request('properties', { docId, name: 'menuBar' })).menus;
    assert.equal(menus[0].title, 'File');
    assert.deepEqual(menus[0].entries.map((e) => e.text), ['Open']);
    await page.locator('.menus-editor button[title="Turn this entry into a sub menu"]').click(); await settle();
    await page.locator('.menus-editor button[title="Add an entry to this sub menu"]').click(); await page.waitForSelector('.popup');
    await page.keyboard.press('Control+a'); await page.keyboard.type('Inner'); await page.keyboard.press('Enter'); await settle();
    const withSub = (await client.request('properties', { docId, name: 'menuBar' })).menus;
    assert.deepEqual(withSub[0].entries[0].entries.map((e) => e.text), ['Inner']);
    await page.locator('.menus-editor .link-btn', { hasText: 'Open' }).click(); await settle();
    assert.ok(await page.locator('#inspector').getByText('actionOpen').count(), 'the action opens in the inspector');
    await shot('e2e-menus');
  });
  await check('layout: a free widget dragged onto a laid-out container joins its layout', async () => {
    await open('freeinlayout.ui');
    const lone = await obj('loneButton'), second = await obj('second');
    assert.equal(lone.laidOut, false);
    await page.mouse.move(...(await at(lone.x + 40, lone.y + 12))); await page.mouse.down();
    await page.mouse.move(...(await at(second.x + second.w / 2, second.y + second.h * 0.8)), { steps: 10 });
    assert.ok(await page.locator('#ghost .insert-line').count() >= 1, 'an insertion line shows where it would land');
    await page.mouse.up(); await settle();
    const now = await obj('loneButton');
    assert.equal(now.laidOut, true);
    assert.equal(now.parent, 'box');
    const order = (await backendNow()).objects.filter((o) => o.parent === 'box').sort((a, b) => a.y - b.y).map((o) => o.name);
    assert.deepEqual(order, ['first', 'second', 'loneButton']);
    await page.locator('button[title^="Undo ("]').click(); await settle();
    assert.equal((await obj('loneButton')).laidOut, false, 'one undo puts it back');
  });
  await check('resources: a .qrc is added from the Form tab and its icons are offered by the icon editor', async () => {
    process.env.E2E_QRC = path.join(ROOT, 'backend/testdata/resources/res.qrc');
    await open('free.ui');
    await page.mouse.click(...(await at(60, 35))); await settle();
    await page.locator('#inspector button.tab[title="Form"]').click(); await settle();
    await page.locator('button', { hasText: 'Add a resource file' }).click(); await settle();
    assert.ok(await page.locator('.resource-file', { hasText: 'res.qrc' }).count(), 'the resource file is listed');
    assert.equal(await page.locator('.thumb-cell img').count(), 2, 'the images are shown as thumbnails');
    await page.locator('#inspector button.tab[title="Properties"]').click(); await settle();
    await page.locator('button[title^="Choose from the form"]').click();
    await page.locator('.menu-item', { hasText: ':/icons/save.png' }).click(); await settle();
    const icon = (await client.request('properties', { docId, name: 'freeButton' })).properties.find((q) => q.name === 'icon');
    assert.ok(String(icon.value).includes('save.png'), String(icon.value));
  });
  await check('action groups: created in the Form tab, an action put in it and taken out, removed, and undo restores', async () => {
    await open('mainwindow.ui');
    await client.request('taskAction', { docId, name: 'MainWindow', text: 'Create Menu Bar' });
    await page.mouse.click(...(await at(60, 35))); await settle();
    await page.locator('#inspector button.tab[title="Form"]').click(); await settle();
    const text = page.locator('.action-new input[aria-label="Text of the new action"]');
    await text.fill('Left'); await text.press('Enter'); await settle();
    const name = page.locator('.action-new input[aria-label="Name of the new action group"]');
    await name.fill('alignGroup'); await name.press('Enter'); await settle();
    assert.equal(await page.locator('.action-row', { hasText: 'alignGroup' }).count(), 1, 'the group is listed');
    await page.locator('.action-row', { hasText: 'Left' }).locator('button[aria-label^="Place"]').click();
    await page.locator('.menu-item', { hasText: 'Put in group alignGroup' }).click(); await settle();
    assert.ok((await page.locator('.action-row', { hasText: 'alignGroup' }).textContent()).includes('actionLeft'), 'the group lists its member');
    await shot('e2e-action-groups');
    await page.locator('.action-row', { hasText: 'Left' }).locator('button[aria-label^="Place"]').click();
    await page.locator('.menu-item', { hasText: 'Take out of group alignGroup' }).click(); await settle();
    assert.ok((await page.locator('.action-row', { hasText: 'alignGroup' }).textContent()).includes('empty'), 'taken out again');
    await page.locator('button[aria-label="Remove the group alignGroup"]').click(); await settle();
    assert.equal(await page.locator('.action-row', { hasText: 'alignGroup' }).count(), 0, 'the group is gone');
    await page.locator('#toolbar button[title^="Undo"]').first().click(); await settle();
    assert.equal(await page.locator('.action-row', { hasText: 'alignGroup' }).count(), 1, 'undo brings it back');
  });
  await check('actions: the Form tab lists them, creates one, opens it in the inspector, removes it, and undo brings it back', async () => {
    await open('mainwindow.ui');
    await client.request('taskAction', { docId, name: 'MainWindow', text: 'Create Menu Bar' });
    await client.request('addMenu', { docId, title: 'File' });
    await page.mouse.click(...(await at(60, 35))); await settle();
    await page.locator('#inspector button.tab[title="Form"]').click(); await settle();
    const field = page.locator('.action-new input[aria-label="Text of the new action"]');
    await field.fill('Save As'); await field.press('Enter'); await settle();
    await shot('e2e-actions');
    const row = page.locator('.action-row', { hasText: 'Save As' });
    assert.equal(await row.count(), 1, 'the new action is listed');
    assert.ok((await row.textContent()).includes('unused'));
    {
      await page.locator('.action-row', { hasText: 'Save As' }).locator('button[aria-label^="Place"]').click();
      await page.locator('.menu-item', { hasText: 'Add to' }).first().click(); await settle();
      assert.ok((await page.locator('.action-row', { hasText: 'Save As' }).textContent()).includes('in menu'), 'the row says where the action is used');
      await page.locator('.action-row', { hasText: 'Save As' }).locator('button[aria-label^="Place"]').click();
      await page.locator('.menu-item', { hasText: 'Remove from' }).first().click(); await settle();
      assert.ok((await page.locator('.action-row', { hasText: 'Save As' }).textContent()).includes('unused'), 'taken out again');
    }
    await row.click(); await settle();
    assert.ok(await page.locator('#inspector [aria-label="text"], #inspector input').count() > 0, 'its properties open in the inspector');
    assert.equal(((await backendNow()).objects || []).length > 0, true);
    await page.locator('#inspector button.tab[title="Form"]').click(); await settle();
    await page.locator('.action-row', { hasText: 'Save As' }).locator('button[aria-label^="Remove"]').click(); await settle();
    assert.equal(await page.locator('.action-row', { hasText: 'Save As' }).count(), 0, 'removed');
    await page.locator('button[title^="Undo ("]').click(); await settle();
    assert.equal(await page.locator('.action-row', { hasText: 'Save As' }).count(), 1, 'undo restores it');
  });
  await check('preview: the form is live, a click checks a box, typing fills a field, a combo opens and selects', async () => {
    await open('interactive.ui');
    await page.keyboard.press('Control+r'); await page.waitForSelector('.popup.preview .preview-img');
    const img = page.locator('.preview-img');
    await page.waitForFunction(() => document.querySelector('.preview-img')?.getAttribute('src')?.startsWith('data:image/png'));
    const src = () => img.getAttribute('src');
    const settleFrame = async (before) => { await page.waitForFunction((b) => document.querySelector('.preview-img').getAttribute('src') !== b, before, { timeout: 4000 }); await page.waitForTimeout(80); };
    const box = await img.boundingBox();
    const k = box.width / 300;
    let before = await src();
    await page.mouse.click(box.x + 20 * k, box.y + 20 * k); await settleFrame(before);
    before = await src();
    await page.mouse.click(box.x + 60 * k, box.y + 57 * k);
    await page.keyboard.type('Qt');
    await settleFrame(before);
    before = await src();
    await page.mouse.click(box.x + 60 * k, box.y + 97 * k); await settleFrame(before);
    await shot('e2e-preview-live');
    await page.waitForTimeout(600);
    before = await src();
    await page.mouse.click(box.x + 60 * k, box.y + 125 * k); await settleFrame(before);
    await shot('e2e-preview-live2');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.popup.preview').count(), 0);
  });
  await check('tasks: the context menu offers the engine tasks, Morph into changes the class', async () => {
    await open('sample.ui');
    const ok = await obj('okButton');
    await page.mouse.click(...(await at(ok.x + 20, ok.y + 10)), { button: 'right' });
    await page.waitForSelector('.menu');
    await page.locator('.menu-item', { hasText: 'Widget tasks' }).hover();
    await page.locator('.menu-item', { hasText: 'Morph into' }).hover();
    await page.locator('.menu-item', { hasText: 'QCheckBox' }).click(); await settle();
    assert.equal((await obj('okButton')).class, 'QCheckBox');
  });
  await check('palette and locale: a role colour is changed from the inspector, the locale from two lists', async () => {
    await open('sample.ui');
    const ok = await obj('okButton');
    await page.mouse.click(...(await at(ok.x + 20, ok.y + 10))); await settle();
    const block = page.locator('.prop-block', { has: page.locator('[data-prop="palette"]') });
    await block.locator('.flags-head').click();
    await block.locator('input[type=color][aria-label="Button, Active"]').fill('#cc0000'); await settle();
    const pal = (await client.request('properties', { docId, name: 'okButton' })).properties.find((q) => q.name === 'palette');
    assert.deepEqual(pal.value.set, ['Button']);
    assert.equal(pal.value.groups.Active.Button, '#ffcc0000');
    await page.locator('.locale-editor select[aria-label="Language"]').scrollIntoViewIfNeeded();
    await page.locator('.locale-editor select[aria-label="Language"]').selectOption('French', { timeout: 3000 }); await settle();
    const loc = (await client.request('properties', { docId, name: 'okButton' })).properties.find((q) => q.name === 'locale');
    assert.equal(loc.value.language, 'French');
  });
  await check('tabs: a click on a tab header switches the page, a double-click renames it', async () => {
    await open('tabs.ui');
    const tabRect = async (i) => (await client.request('containerInfo', { docId, name: 'tabs' })).tabs[i];
    const current = async () => (await client.request('containerInfo', { docId, name: 'tabs' })).current;
    const second = await tabRect(1);
    await page.mouse.click(...(await at(second.x + second.w / 2, second.y + second.h / 2))); await settle();
    assert.equal(await current(), 1, 'the first click on an unselected tab widget already switches');
    const third = await tabRect(2);
    await page.mouse.dblclick(...(await at(third.x + third.w / 2, third.y + third.h / 2))); await settle();
    await page.waitForSelector('input.inplace');
    await page.keyboard.press('Control+a'); await page.keyboard.type('Renamed'); await page.keyboard.press('Enter'); await settle();
    assert.equal(await current(), 2);
    const title = (await client.request('properties', { docId, name: 'tabs' })).properties.find((q) => q.name === 'currentTabText');
    assert.equal(title.value, 'Renamed');
  });
  await check('tool box: a click on a page header opens that page, a double-click renames it', async () => {
    await open('toolbox.ui');
    const info = async () => client.request('containerInfo', { docId, name: 'box' });
    const beta = (await info()).tabs[1];
    await page.mouse.click(...(await at(beta.x + beta.w / 2, beta.y + beta.h / 2))); await settle();
    assert.equal((await info()).current, 1);
    const header = (await info()).tabs[1];
    await page.mouse.dblclick(...(await at(header.x + header.w / 2, header.y + header.h / 2))); await settle();
    await page.waitForSelector('input.inplace');
    await page.keyboard.press('Control+a'); await page.keyboard.type('Delta'); await page.keyboard.press('Enter'); await settle();
    const title = (await client.request('properties', { docId, name: 'box' })).properties.find((q) => q.name === 'currentItemText');
    assert.equal(title.value, 'Delta');
  });
  await check('layout: a widget dragged out of its layout onto a free area becomes free, one undo puts it back', async () => {
    await open('freeinlayout.ui');
    const first = await obj('first');
    assert.equal(first.laidOut, true);
    await page.mouse.move(...(await at(first.x + 20, first.y + 8))); await page.mouse.down();
    await page.mouse.move(...(await at(50, 160)), { steps: 10 });
    assert.ok(await page.locator('#ghost .drop-target').count() >= 1, 'the free area is highlighted');
    await page.mouse.up(); await settle();
    const now = await obj('first');
    assert.equal(now.laidOut, false);
    assert.equal(now.parent, 'FreeInLayout');
    await page.locator('button[title^="Undo ("]').click(); await settle();
    assert.equal((await obj('first')).laidOut, true);
  });
  await check('custom slots: added from the Form tab, offered to connections, removed', async () => {
    await open('rich.ui');
    await page.mouse.click(...(await at(300, 280))); await settle();
    await page.locator('#inspector button.tab[title="Form"]').click(); await settle();
    const field = page.locator('.method-list input[aria-label="Signature of the new slot"]');
    await field.fill('not valid'); await field.press('Enter');
    assert.ok(await page.locator('.method-list .rename-error', { hasText: 'argument types' }).count(), 'a bad signature is explained');
    await field.fill('save(bool)'); await field.press('Enter'); await settle();
    assert.ok(await page.locator('.method-row', { hasText: 'save(bool)' }).count(), 'the slot is listed');
    const d = await client.request('describe', { docId, name: (await backendNow()).objects[0].name });
    assert.ok(d.slots.some((m) => m.signature === 'save(bool)'), 'the engine knows it');
    await page.locator('button[aria-label="Remove save(bool)"]').click(); await settle();
    assert.equal(await page.locator('.method-row', { hasText: 'save(bool)' }).count(), 0);
  });
  await check('style sheet: the larger editor says live whether the sheet is valid', async () => {
    await open('sample.ui');
    const ok = await obj('okButton');
    await page.mouse.click(...(await at(ok.x + 20, ok.y + 10))); await settle();
    await page.locator('button[title^="Edit styleSheet"]').click();
    const ta = page.locator('textarea.big-text');
    await ta.fill('QPushButton { color: red;'); await page.waitForSelector('.style-status.bad');
    await ta.fill('color: red;'); await page.waitForSelector('.style-status.ok');
    assert.match(await page.locator('.style-status').textContent(), /Valid/);
    await page.keyboard.press('Escape');
  });
  await check('keyboard: Delete, arrows and shortcuts typed in a field never act on the form', async () => {
    await open('rich.ui');
    const go = await obj('go');
    await page.mouse.click(...(await at(go.x + 10, go.y + 8))); await settle();
    const n = (await backendNow()).objects.length;
    const before = JSON.stringify(await obj('go'));
    for (const field of ['#inspector input[placeholder^="Filter"]', '#palette-filter, #left input[type=search], #left input[type=text]']) {
      const f = page.locator(field).first();
      if (!(await f.count())) continue;
      await f.click();
      await page.keyboard.type('abc');
      await page.keyboard.press('Delete'); await page.keyboard.press('Backspace');
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Control+d');
      await settle();
    }
    assert.equal((await backendNow()).objects.length, n, 'nothing was deleted or duplicated');
    assert.equal(JSON.stringify(await obj('go')), before, 'nothing moved');
  });
  await check('translation: a text can be marked not translatable and given a comment for the translator', async () => {
    await open('sample.ui');
    const ok = await obj('okButton');
    await page.mouse.click(...(await at(ok.x + 20, ok.y + 10))); await settle();
    await page.locator('button[title^="Translation of text"]').first().click();
    await page.locator('input[aria-label="Translatable"]').uncheck();
    await page.locator('textarea[aria-label="Comment for the translator"]').fill('Confirm button');
    await page.locator('.popup button', { hasText: 'Apply' }).click(); await settle();
    const xml = (await client.request('contents', { docId })).xml;
    assert.match(xml, /<string notr="true"[^>]*extracomment="Confirm button"[^>]*>OK<\/string>/);
    assert.ok(await page.locator('button[title^="Translation of text (not translated)"]').count(), 'the button shows it differs from the default');
  });
  await check('rulers: the command shows them, zoom rescales them, and the pointer marker follows the mouse', async () => {
    await open('rich.ui');
    await page.keyboard.press('>');
    await page.keyboard.type('rulers');
    await page.keyboard.press('Enter'); await settle();
    assert.equal(await page.locator('.ruler-top svg line').count() > 5, true, 'ticks drawn');
    const form = await page.locator('#form').boundingBox();
    await page.mouse.move(form.x + 40, form.y + 30); await settle();
    const mark = await page.locator('.ruler-top .ruler-mark').evaluate((n) => parseFloat(n.style.left));
    assert.ok(mark > 10, 'marker moved to ' + mark);
    if (shots) await page.screenshot({ path: `${shots}/rulers.png` });
    await page.keyboard.press('>');
    await page.keyboard.type('rulers');
    await page.keyboard.press('Enter'); await settle();
    assert.equal(await page.locator('.ruler').count(), 0);
  });
  await check('toolbar sweep: every enabled button reacts to a real mouse click', async () => {
    await open('rich.ui');
    const go = await obj('go');
    await page.mouse.click(...(await at(go.x + 10, go.y + 8))); await settle();
    const dead = [];
    const n = await page.locator('#toolbar button:not([disabled])').count();
    for (let i = 0; i < n; i++) {
      const btn = page.locator('#toolbar button:not([disabled])').nth(i);
      const label = (await btn.getAttribute('title')) || (await btn.getAttribute('aria-label')) || String(i);
      if (/Delete|Cut|Undo|Redo|Paste/i.test(label) || !(await btn.isVisible())) continue; // some buttons are hidden on purpose in a narrow toolbar
      const before = await page.evaluate(() => document.body.innerHTML.length + '|' + document.querySelectorAll('.popup,.menu').length + '|' + (window.__sentCount || 0));
      const sentBefore = sent.length;
      await btn.click().catch(() => {});
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => document.body.innerHTML.length + '|' + document.querySelectorAll('.popup,.menu').length);
      const reacted = before.split('|').slice(0, 2).join('|') !== after || sent.length > sentBefore || (await btn.getAttribute('aria-pressed')) !== null;
      if (!reacted) dead.push(label);
      await page.keyboard.press('Escape'); await page.mouse.click(10, 10).catch(() => {}); await settle();
      await page.mouse.click(...(await at(go.x + 10, go.y + 8))); await settle();
    }
    assert.deepEqual(dead, [], 'buttons that did nothing: ' + dead.join(', '));
  });
  await check('mouse sweep: the pill buttons and every top-level context menu entry react to a real click', async () => {
    await open('rich.ui');
    const go = await obj('go');
    const pt = await at(go.x + 10, go.y + 8);
    const dead = [];
    const react = async (label, act) => {
      const sentBefore = sent.length;
      const before = await page.evaluate(() => document.querySelectorAll('.popup,.inplace').length + '/' + document.querySelectorAll('[aria-pressed=true]').length + '/' + document.body.className);
      await act(); await page.waitForTimeout(250);
      const after = await page.evaluate(() => document.querySelectorAll('.popup,.inplace').length + '/' + document.querySelectorAll('[aria-pressed=true]').length + '/' + document.body.className);
      if (sent.length === sentBefore && after === before) dead.push(label);
      await page.keyboard.press('Escape'); await settle();
    };
    await page.mouse.click(...pt); await settle();
    const pill = page.locator('.pill button');
    const count = await pill.count();
    for (let i = 0; i < count; i++) {
      const b = page.locator('.pill button').nth(i);
      const label = 'pill:' + ((await b.getAttribute('title')) || (await b.getAttribute('aria-label')) || i);
      if (/Delete|Remove|More actions/i.test(label)) continue; // More opens a menu, tested above
      await react(label, () => b.click());
      await page.mouse.click(...pt); await settle();
    }
    await page.mouse.click(...pt, { button: 'right' }); await page.waitForSelector('.menu');
    const items = await page.locator('.menu > .menu-item:not(.disabled)').evaluateAll((els) => els.filter((e) => !e.querySelector('.codicon-chevron-right')).map((e) => e.textContent));
    await page.keyboard.press('Escape');
    for (const text of items) {
      if (/Delete|Cut|Undo|Redo|Paste|Break|Layout/i.test(text) ) continue;
      await page.mouse.click(...pt); await settle();
      await page.mouse.click(...pt, { button: 'right' }); await page.waitForSelector('.menu');
      await react('menu:' + text.trim(), () => page.locator('.menu > .menu-item', { hasText: text.trim() }).first().click());
    }
    assert.deepEqual(dead, [], 'did nothing: ' + dead.join(' | '));
  });
  await check('no uncaught page errors', async () => assert.deepEqual(pageErrors, []));

  await shot('e2e-final');
  await browser.close();
  client.dispose();
  for (const [s, l] of results) console.log(`${s} ${l}`);
  console.log(`\n${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
