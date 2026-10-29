// Smoke test of the real page on real forms: every .ui under vendor/ and backend/testdata is opened in Chromium
// (same host stand-in as e2e-browser.js), each widget is clicked, hovered and inspected. Fails on page errors,
// missing images, empty inspectors or slow round trips. Run: CHROME=<path> node corpus-ui.js [maxForms]
const fs = require('node:fs');
const path = require('node:path');
const EXT = path.resolve(__dirname, '..');
const ROOT = path.resolve(EXT, '..');
const { BackendClient } = require(path.join(EXT, 'out/src/backendClient.js'));
const { pageBody } = require(path.join(EXT, 'out/src/pageBody.js'));
const { chromium } = require('playwright-core');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else if (e.name.endsWith('.ui')) yield p;
  }
}

(async () => {
  const files = [...walk(path.join(ROOT, 'vendor')), ...walk(path.join(ROOT, 'backend/testdata'))].sort();
  const max = Number(process.argv[2] ?? files.length);
  const client = new BackendClient({ executable: path.join(ROOT, 'backend/build/designer_backend'), requestTimeoutMs: 20000 });
  await client.start();
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const css = fs.readFileSync(path.join(EXT, 'media/editor.css'), 'utf8');
  const js = fs.readFileSync(path.join(EXT, 'media/webview/main.js'), 'utf8');
  const THEME = '--vscode-editor-background:#1f1f1f;--vscode-foreground:#ccc;--vscode-font-size:13px;--vscode-sideBar-background:#181818;--vscode-input-background:#313131;--vscode-input-foreground:#ccc;--vscode-focusBorder:#0078d4;';

  let docId = '', snap, inspect = null, n = 0, slow = 0, maxMs = 0, queue = Promise.resolve();
  const post = (data) => page.evaluate((d) => window.dispatchEvent(new MessageEvent('message', { data: d })), data);
  async function push() {
    const name = inspect ?? snap.selection[0];
    const properties = name ? await client.request('properties', { docId, name }).catch(() => null) : null;
    const code = name ? await client.request('describe', { docId, name }).catch(() => null) : null;
    const container = name ? await client.request('containerInfo', { docId, name }).then((c) => (c.current >= 0 ? c : null)).catch(() => null) : null;
    const connections = (await client.request('connections', { docId })).connections;
    const pal = await client.request('palette', {});
    const s = { ...snap }; delete s.messages;
    await post({ type: 'state', snapshot: s, properties, propertiesFor: name ?? null, palette: pal.categories, fonts: pal.fonts, notices: [], code, connections, container });
  }
  async function handle(m) {
    const t = Date.now();
    try {
      if (m.type === 'hitSelect') { const r = await client.request('hitTest', { docId, x: m.x, y: m.y }); snap = await client.request('select', { docId, names: r.name ? [r.name] : [] }); }
      else if (m.type === 'selectNames') { inspect = null; snap = await client.request('select', { docId, names: m.names }); }
      else if (m.type === 'inspect') inspect = m.name;
      else if (m.type === 'view') snap = await client.request('view', { docId, scale: m.scale });
      else if (m.type === 'ready' || m.type === 'want') { /* state only */ }
      else return;
    } catch (e) { errors.push(`host: ${m.type}: ${e.message}`); }
    await push();
    const ms = Date.now() - t; maxMs = Math.max(maxMs, ms); if (ms > 400) slow++;
  }
  await page.exposeFunction('__host', (m) => { queue = queue.then(() => handle(m)); });
  const settle = async () => { await queue; await page.waitForTimeout(40); await queue; };

  const problems = [];
  let forms = 0, clicks = 0;
  for (const file of files.slice(0, max)) {
    const rel = path.relative(ROOT, file);
    const before = errors.length;
    try {
      docId = 'c' + (++n);
      snap = await client.request('open', { docId, xml: fs.readFileSync(file, 'utf8'), path: file });
      inspect = null;
      await page.setContent(`<!DOCTYPE html><html><head><meta charset=utf-8><link rel=stylesheet href="file://${EXT}/media/codicons/codicon.css"><style>html{${THEME}}${css}</style></head><body>${pageBody()}<script>window.acquireVsCodeApi=()=>({postMessage:m=>window.__host(m),getState:()=>undefined,setState:()=>{}});</script><script>${js}</script></body></html>`);
      await settle();
      forms++;
      const box = await page.locator('#form').boundingBox();
      const imgOk = await page.evaluate(() => { const i = document.getElementById('form'); return i.complete && i.naturalWidth > 0; });
      if (!box || !imgOk) problems.push(`${rel}: the form image did not load`);
      const rows = await page.locator('.tree-row').count();
      if (rows < snap.objects.length) problems.push(`${rel}: outline shows ${rows} rows for ${snap.objects.length} widgets`);
      const k = box ? box.width / snap.width : 1;
      for (const o of snap.objects.slice(0, 30)) {
        if (!box || o.w < 3 || o.h < 3) continue;
        const t = Date.now();
        await page.mouse.move(box.x + (o.x + o.w / 2) * k, box.y + (o.y + o.h / 2) * k);
        await page.mouse.click(box.x + (o.x + o.w / 2) * k, box.y + (o.y + o.h / 2) * k);
        await settle(); clicks++;
        const head = (await page.locator('#inspector-head').textContent()) ?? '';
        if (!head.trim() || /Nothing selected/.test(head)) problems.push(`${rel}: clicking ${o.name} left the inspector empty`);
        if (Date.now() - t > 1500) problems.push(`${rel}: selecting ${o.name} took ${Date.now() - t} ms`);
      }
      await page.keyboard.press('F4'); await page.keyboard.press('Escape');
      if (errors.length > before) problems.push(`${rel}: page errors: ${errors.slice(before).join(' | ').slice(0, 200)}`);
    } catch (e) {
      problems.push(`${rel}: ${String(e.message).split('\n')[0]}`);
    }
    await client.request('close', { docId }).catch(() => undefined);
  }
  await browser.close();
  client.dispose();
  console.log(`${forms} forms, ${clicks} widget clicks, slowest round trip ${maxMs} ms, ${slow} round trips over 400 ms`);
  for (const p of problems) console.log('PROBLEM', p);
  console.log(`${problems.length} problem(s)`);
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
