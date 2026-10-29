import { $, el, icon } from './dom';

const root = $<HTMLDivElement>('toasts');
const MAX = 4;

export interface ToastOptions {
    kind?: 'info' | 'warn' | 'error';
    /** A button on the toast, e.g. Undo. */
    action?: { label: string; run: () => void };
    /** Milliseconds before it disappears (0 keeps it until dismissed). */
    ms?: number;
}

/** A short, non-blocking message. Identical messages replace each other instead of piling up. */
export function toast(text: string, opts: ToastOptions = {}): void {
    const kind = opts.kind ?? 'info';
    for (const t of Array.from(root.children)) {
        if (t.getAttribute('data-text') === text) {
            t.remove();
        }
    }
    while (root.children.length >= MAX) {
        root.firstElementChild?.remove();
    }
    const node = el('div', { className: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
        icon(kind === 'error' ? 'error' : kind === 'warn' ? 'warning' : 'info'), el('span', { className: 'toast-text' }, text));
    node.setAttribute('data-text', text);
    if (opts.action) {
        const a = opts.action;
        const b = el('button', { type: 'button', className: 'toast-action' }, a.label);
        b.addEventListener('click', () => {
            node.remove();
            a.run();
        });
        node.append(b);
    }
    const close = el('button', { type: 'button', className: 'icon-btn toast-close', title: 'Dismiss' }, icon('close'));
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', () => node.remove());
    node.append(close);
    root.append(node);
    const ms = opts.ms ?? (kind === 'error' ? 9000 : kind === 'warn' ? 7000 : 3200);
    if (ms > 0) {
        window.setTimeout(() => node.remove(), ms);
    }
}

export function clearToasts(): void {
    root.replaceChildren();
}
