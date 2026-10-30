import { execFile } from 'node:child_process';
import * as path from 'node:path';

/** The committed (git HEAD) text of a file, or why it cannot be read, in words for the user. */
export function readCommitted(file: string): Promise<{ text?: string; error?: string }> {
    return new Promise((resolve) => {
        execFile('git', ['show', `HEAD:./${path.basename(file)}`], { cwd: path.dirname(file), maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
            if (!err) {
                resolve({ text: stdout });
            } else if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                resolve({ error: 'git is not installed or not on the PATH.' });
            } else if (/not a git repository/i.test(stderr)) {
                resolve({ error: 'This file is not in a git repository.' });
            } else if (/exists on disk, but not in|does not exist in|unknown revision|bad revision|ambiguous argument|invalid object name/i.test(stderr)) {
                resolve({ error: 'This file has no committed version yet.' });
            } else {
                resolve({ error: stderr.trim().split('\n')[0] || 'git could not read the committed file.' });
            }
        });
    });
}
