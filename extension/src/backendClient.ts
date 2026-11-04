import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BackendMethod, BackendMethods } from './protocol';

interface Pending {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
}

export interface BackendClientOptions {
    executable: string;
    /** Folders holding a `designer` directory of custom widget plugins (added to QT_PLUGIN_PATH). */
    pluginPaths?: string[];
    /** File the backend writes its call stack to if the engine crashes. */
    crashLog?: string;
    /** Per-request timeout in ms. */
    requestTimeoutMs?: number;
    /** Time allowed for the backend's `ready` event. */
    startTimeoutMs?: number;
}

/**
 * Talks to designer_backend over stdio, one JSON object per line.
 * Emits 'exit' (code, signal) when the process ends and 'stderr' (text) for diagnostics.
 */
export class BackendClient extends EventEmitter {
    private proc: ChildProcessWithoutNullStreams | undefined;
    private buffer = '';
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();
    private disposed = false;

    constructor(private readonly options: BackendClientOptions) {
        super();
    }

    get running(): boolean {
        return this.proc !== undefined && !this.disposed;
    }

    start(): Promise<{ qt: string }> {
        return new Promise((resolve, reject) => {
            // Never forward a shell's scaling or platform overrides; the backend picks `offscreen` itself.
            const env = { ...process.env };
            delete env.QT_SCALE_FACTOR;
            delete env.QT_QPA_PLATFORM;
            // Custom widget plugins: folders that contain a `designer` directory with the plugin libraries.
            if (this.options.pluginPaths?.length) {
                env.QT_PLUGIN_PATH = [...this.options.pluginPaths, env.QT_PLUGIN_PATH ?? ''].filter(Boolean).join(path.delimiter);
            }
            // A bundled backend (scripts/bundle-backend.sh) carries its own Qt plugins next to the executable.
            const bundled = bundledPluginPath(this.options.executable);
            if (bundled) {
                env.QT_PLUGIN_PATH = [bundled, env.QT_PLUGIN_PATH ?? ''].filter(Boolean).join(path.delimiter);
            }
            if (this.options.crashLog) {
                env.QDR_CRASH_LOG = this.options.crashLog;
            }
            const proc = spawn(this.options.executable, [], { stdio: ['pipe', 'pipe', 'pipe'], env });
            this.proc = proc;
            const startTimer = setTimeout(() => {
                reject(new Error('backend did not report ready in time'));
                proc.kill();
            }, this.options.startTimeoutMs ?? 20000);

            let ready = false;
            proc.once('error', (err) => {
                clearTimeout(startTimer);
                reject(err);
            });
            proc.stderr.setEncoding('utf8');
            // Writing to a backend that just died raises EPIPE on stdin; the exit event rejects what was pending.
            proc.stdin.on('error', () => undefined);
            proc.stderr.on('data', (chunk: string) => this.emit('stderr', chunk));
            proc.stdout.setEncoding('utf8');
            proc.stdout.on('data', (chunk: string) => {
                this.buffer += chunk;
                let nl: number;
                while ((nl = this.buffer.indexOf('\n')) >= 0) {
                    const line = this.buffer.slice(0, nl);
                    this.buffer = this.buffer.slice(nl + 1);
                    if (!line.trim()) {
                        continue;
                    }
                    const msg = this.parse(line);
                    if (!msg) {
                        continue;
                    }
                    if (!ready && msg.event === 'ready') {
                        ready = true;
                        clearTimeout(startTimer);
                        resolve({ qt: String(msg.qt ?? '') });
                    } else {
                        this.dispatch(msg);
                    }
                }
            });
            proc.once('exit', (code, signal) => {
                clearTimeout(startTimer);
                this.proc = undefined;
                const err = new Error(`backend exited (code ${code}, signal ${signal})`);
                for (const p of this.pending.values()) {
                    clearTimeout(p.timer);
                    p.reject(err);
                }
                this.pending.clear();
                if (!ready) {
                    reject(err);
                }
                this.emit('exit', code, signal);
            });
        });
    }

    request<M extends BackendMethod>(method: M, params: BackendMethods[M]['params']): Promise<BackendMethods[M]['result']> {
        const proc = this.proc;
        if (!proc || this.disposed) {
            return Promise.reject(new Error('backend is not running'));
        }
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`backend request '${method}' timed out`));
            }, this.options.requestTimeoutMs ?? 30000);
            this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
            proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
        });
    }

    /** Test hook: dies like a crash (no goodbye, no EOF). */
    killForTest(): void {
        this.proc?.kill('SIGKILL');
    }

    dispose(): void {
        this.disposed = true;
        const proc = this.proc;
        if (proc) {
            proc.stdin.end(); // the backend exits on EOF
            setTimeout(() => proc.kill(), 2000).unref();
        }
    }

    private parse(line: string): Record<string, unknown> | undefined {
        try {
            const v: unknown = JSON.parse(line);
            return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
        } catch {
            this.emit('stderr', `unparseable backend line: ${line}\n`);
            return undefined;
        }
    }

    private dispatch(msg: Record<string, unknown>): void {
        const id = msg.id;
        if (typeof id !== 'number') {
            return;
        }
        const p = this.pending.get(id);
        if (!p) {
            return;
        }
        this.pending.delete(id);
        clearTimeout(p.timer);
        if (typeof msg.error === 'string') {
            p.reject(new Error(msg.error));
        } else {
            p.resolve(msg.result);
        }
    }
}

/** The `plugins` folder beside a bundled backend executable, when there is one. */
export function bundledPluginPath(executable: string): string | undefined {
    const dir = path.join(path.dirname(executable), 'plugins');
    return fs.existsSync(path.join(dir, 'platforms')) ? dir : undefined;
}
