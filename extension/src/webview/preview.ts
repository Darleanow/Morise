import type { PreviewResult } from '../protocol';
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

function request(): void {
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
    popup = openPopup([
        el('div', { className: 'popup-head preview-head' },
            icon('open-preview'), el('b', {}, 'Preview'), el('span', { className: 'dim' }, 'what your application will show'),
            el('span', { className: 'spacer' }), el('label', { className: 'flag' }, 'Style', styleSelect), el('label', { className: 'flag' }, darkBox, 'Dark'),
            sizeLabel),
        el('div', { className: 'preview-body' }, el('div', { className: 'preview-frame' }, image)),
        footer(el('span', { className: 'dim' }, 'Static render: the widgets are drawn by Qt in this style; they do not react to the mouse.'), el('span', { className: 'spacer' }), secondaryButton('Refresh', request), primaryButton('Close', close)),
    ], 'preview', () => {
        popup = undefined;
        image = undefined;
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
    const wanted = style || (result.styles.includes('Fusion') ? 'Fusion' : (result.styles[0] ?? ''));
    styleSelect.replaceChildren(...[...new Set([wanted, ...result.styles])].filter(Boolean).map((s) => el('option', { value: s, selected: s === wanted }, s)));
}

/** Keep an open preview in step with edits made on the canvas. */
export function refreshPreviewSoon(): void {
    if (!popup) {
        return;
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(request, 250);
}

void S;
