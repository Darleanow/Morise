import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { readCommitted } from '../src/gitCompare';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'pipe' });

describe('readCommitted', () => {
    it('reads HEAD, and explains a missing repository, commit or file', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qdr-git-'));
        const file = path.join(dir, 'a.ui');
        fs.writeFileSync(file, 'one');
        assert.match((await readCommitted(file)).error ?? '', /not in a git repository/);
        git(dir, 'init', '-q');
        assert.match((await readCommitted(file)).error ?? '', /no committed version/);
        git(dir, 'add', 'a.ui');
        git(dir, 'commit', '-qm', 'x');
        fs.writeFileSync(file, 'two');
        assert.equal((await readCommitted(file)).text, 'one');
        const fresh = path.join(dir, 'b.ui');
        fs.writeFileSync(fresh, 'x');
        assert.match((await readCommitted(fresh)).error ?? '', /no committed version/);
    });
});
