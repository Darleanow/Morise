import type { PreviewInput, PreviewResult } from '../protocol';
import { el, icon } from './dom';
import { footer, openPopup, primaryButton, secondaryButton, type Popup } from './popup';
import { S, send } from './state';

let popup: Popup | undefined;
let image: HTMLImageElement | undefined;
let styleSelect: HTMLSelectElement | undefined;
let darkBox: HTMLInputElement | undefined;
let sizeLabel: HTMLElement | undefined;
let lastStyle = '';
let lastDark = false;
let timer: number | undefined;

export function previewOpen(): boolean {
    return popup !== undefined;
}

let shownAt = -1;

function request(): void {
    shownAt = S.snapshot?.undoIndex ?? -1;
    pending = [];
    send({ type: 'preview', style: styleSelect?.value ?? lastStyle, dark: darkBox?.checked ?? lastDark, scale: Math.min(4, Math.max(1, window.devicePixelRatio)) });
}

/** The form as the application will show it: no grid, no design-time widgets, in the style you choose. */
export function openPreview(): void {
    if (popup) {
        return;
    }
    image = el('img', { className: 'preview-img', alt: 'Runtime preview of the form', draggable: false });
    styleSelect = el('select', {});
    styleSelect.setAttribute('aria-label', 'Widget style');
    darkBox = el('input', { type: 'checkbox', checked: lastDark });
    sizeLabel = el('span', { className: 'dim' });
    for (const s of [lastStyle || 'Fusion']) {
        styleSelect.append(el('option', { value: s }, s));
    }
    styleSelect.addEventListener('change', request);
    darkBox.addEventListener('change', request);
    const close = () => popup?.close();
    wireInput(image);
    popup = openPopup([
        el('div', { className: 'popup-head preview-head' },
            icon('open-preview'), el('b', {}, 'Preview'), el('span', { className: 'dim' }, 'what your application will show'),
            el('span', { className: 'spacer' }), el('label', { className: 'flag' }, 'Style', styleSelect), el('label', { className: 'flag' }, darkBox, 'Dark'),
            sizeLabel),
        el('div', { className: 'preview-body' }, el('div', { className: 'preview-frame' }, image)),
        footer(el('span', { className: 'dim' }, 'Interactive: click, type, scroll and drag in the form as in the application. Pop-ups are drawn over it.'), el('span', { className: 'spacer' }), secondaryButton('Refresh', request), primaryButton('Close', close)),
    ], 'preview', () => {
        popup = undefined;
        image = undefined;
        pending = [];
        send({ type: 'previewStop' });
    });
    request();
}

export function onPreview(result: PreviewResult, style: string, dark: boolean): void {
    lastStyle = style;
    lastDark = dark;
    if (!popup || !image || !styleSelect) {
        return;
    }
    image.src = `data:image/png;base64,${result.png}`;
    image.style.width = `${result.width}px`;
    image.style.height = `${result.height}px`;
    if (sizeLabel) {
        sizeLabel.textContent = `${result.width} × ${result.height}`;
    }
    const styles = result.styles ?? [];
    const wanted = style || (styles.includes('Fusion') ? 'Fusion' : (styles[0] ?? ''));
    styleSelect.replaceChildren(...[...new Set([wanted, ...styles])].filter(Boolean).map((s) => el('option', { value: s, selected: s === wanted }, s)));
}

// ---- live input: the page forwards the mouse and keyboard to the form the engine keeps alive ------------

let pending: PreviewInput[] = [];
let inFlight = false;

function flush(): void {
    if (inFlight || pending.length === 0) {
        return;
    }
    inFlight = true;
    send({ type: 'previewEvent', ...(pending.shift() as PreviewInput) });
}

function push(ev: PreviewInput): void {
    // Only the latest pointer position matters while an earlier one is still being drawn.
    if (ev.kind === 'move' && pending.length > 0 && pending[pending.length - 1]?.kind === 'move') {
        pending[pending.length - 1] = ev;
    } else if (pending.length < 300) {
        pending.push(ev);
    }
    flush();
}

/** A picture arrived for an input event: show it and send the next one. */
export function onPreviewFrame(result: PreviewResult): void {
    inFlight = false;
    if (popup && image) {
        image.src = `data:image/png;base64,${result.png}`;
    }
    flush();
}

function modifiers(ev: MouseEvent | KeyboardEvent | WheelEvent): number {
    return (ev.shiftKey ? 0x02000000 : 0) | (ev.ctrlKey ? 0x04000000 : 0) | (ev.altKey ? 0x08000000 : 0) | (ev.metaKey ? 0x10000000 : 0);
}

function wireInput(img: HTMLImageElement): void {
    img.tabIndex = 0;
    const at = (ev: MouseEvent): { x: number; y: number } => {
        const r = img.getBoundingClientRect();
        return { x: Math.round(((ev.clientX - r.left) / Math.max(1, r.width)) * (parseFloat(img.style.width) || r.width)), y: Math.round(((ev.clientY - r.top) / Math.max(1, r.height)) * (parseFloat(img.style.height) || r.height)) };
    };
    const button = (ev: MouseEvent) => (ev.button === 2 ? 2 : ev.button === 1 ? 1 : 0);
    img.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        img.focus();
        img.setPointerCapture?.(ev.pointerId);
        push({ kind: ev.detail === 2 ? 'dblclick' : 'press', ...at(ev), button: button(ev), mods: modifiers(ev) });
    });
    img.addEventListener('pointerup', (ev) => {
        push({ kind: 'release', ...at(ev), button: button(ev), mods: modifiers(ev) });
    });
    img.addEventListener('pointermove', (ev) => {
        push({ kind: 'move', ...at(ev), button: button(ev), mods: modifiers(ev) });
    });
    img.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        push({ kind: 'wheel', ...at(ev), dx: ev.deltaX, dy: ev.deltaY, mods: modifiers(ev) });
    }, { passive: false });
    img.addEventListener('contextmenu', (ev) => ev.preventDefault());
    const key = (kind: 'keydown' | 'keyup') => (ev: KeyboardEvent) => {
        if (ev.key === 'Escape' || (ev.ctrlKey && ev.key.toLowerCase() === 'r')) {
            return; // Escape closes the preview, like every box
        }
        ev.preventDefault();
        ev.stopPropagation();
        push({ kind, key: ev.key, mods: modifiers(ev) });
    };
    img.addEventListener('keydown', key('keydown'));
    img.addEventListener('keyup', key('keyup'));
}

/** Keep an open preview in step with edits made on the canvas. */
export function refreshPreviewSoon(): void {
    // The live form keeps what the user typed in it: rebuild only when the design itself changed.
    if (!popup || (S.snapshot?.undoIndex ?? -1) === shownAt) {
        return;
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(request, 250);
}

void S;
