import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { BackendClient } from '../src/backendClient';
import { TEMPLATES, classNameFor, templateXml } from '../src/templates';

const root = path.resolve(__dirname, '..', '..', '..');
const exe = path.join(root, 'backend', 'build', 'designer_backend');
const uic = '/home/devel/Qt/6.11.3/gcc_64/libexec/uic';

describe('new form templates', () => {
    it('turns what the user typed into a valid class name', () => {
        assert.equal(classNameFor('login_dialog.ui'), 'Login_dialog');
        assert.equal(classNameFor('my form.ui'), 'MyForm');
        assert.equal(classNameFor('3d-view.ui'), 'Form3dView');
        assert.equal(classNameFor('.ui'), 'Form');
        assert.equal(classNameFor('<x>.ui'), 'X');
    });

    describe('against the real backend', () => {
        const client = new BackendClient({ executable: exe, requestTimeoutMs: 20000 });
        before(async () => {
            await client.start();
        });
        after(() => client.dispose());

        for (const t of TEMPLATES) {
            it(`${t.label} opens, keeps its class, saves, and is accepted by uic`, async () => {
                const xml = templateXml(t.id, 'Login');
                const snap = await client.request('open', { docId: t.id, xml });
                const form = snap.objects.find((o) => o.parent === null);
                assert.equal(form?.name, 'Login');
                const saved = (await client.request('contents', { docId: t.id })).xml;
                assert.ok(saved.includes(`class="${t.base}"`), `saved as ${t.base}`);
                if (fs.existsSync(uic)) {
                    const file = path.join(os.tmpdir(), `qtd-template-${process.pid}-${t.id}.ui`);
                    fs.writeFileSync(file, saved);
                    try {
                        execFileSync(uic, [file]);
                    } finally {
                        fs.rmSync(file, { force: true });
                    }
                }
                if (t.id.startsWith('dialogButtons')) {
                    assert.equal((await client.request('connections', { docId: t.id })).connections.length, 2, 'accepted() and rejected() are connected');
                }
            });
        }
    });
});
