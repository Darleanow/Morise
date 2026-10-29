import { $, el } from './dom';

const popups = $<HTMLDivElement>('popups');
const open = new Set<() => void>();
const stack: (() => void)[] = [];

export interface Popup {
    close(): void;
    box: HTMLElement;
}

/** A modal box over a dimmed page. Escape and a click outside close it. */
export function openPopup(content: (Node | string)[], className = '', onClose?: () => void): Popup {
    const box = el('div', { className: `popup ${className}`, role: 'dialog' }, ...content);
    box.setAttribute('aria-modal', 'true');
    const scrim = el('div', { className: 'scrim' }, box);
    popups.append(scrim);
    const close = () => {
        scrim.remove();
        const i = stack.indexOf(close);
        if (i >= 0) {
            stack.splice(i, 1);
        }
        if (open.delete(close)) {
            onClose?.();
        }
    };
    open.add(close);
    stack.push(close);
    scrim.addEventListener('pointerdown', (ev) => {
        if (ev.target === scrim) {
            close();
        }
    });
    box.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            close();
        }
    });
    return { close, box };
}

export function anyPopupOpen(): boolean {
    return open.size > 0;
}

export function closeAllPopups(): void {
    for (const c of [...open]) {
        c();
    }
}

export function header(title: string, subtitle = ''): HTMLElement {
    return el('div', { className: 'popup-head' }, el('b', {}, title), subtitle ? el('span', { className: 'dim' }, subtitle) : '');
}

export function footer(...children: HTMLElement[]): HTMLElement {
    return el('div', { className: 'popup-foot' }, ...children);
}

export function primaryButton(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
    const b = el('button', { type: 'button', className: 'btn primary', disabled }, label);
    b.addEventListener('click', onClick);
    return b;
}

export function secondaryButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', { type: 'button', className: 'btn' }, label);
    b.addEventListener('click', onClick);
    return b;
}

// Lists inside popups are rebuilt on every click, which drops the focus on <body>: close on Escape from anywhere.
document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && stack.length > 0) {
        ev.preventDefault();
        stack[stack.length - 1]?.();
    }
});
