import type { CompareResult } from '../protocol';
import { el, icon } from './dom';
import { footer, header, openPopup, secondaryButton } from './popup';
import { S, send } from './state';
import { toast } from './toast';
import { diffForms, type Change } from './xmldiff';

type Mode = 'swipe' | 'fade' | 'side';
const GLYPH = { added: 'diff-added', removed: 'diff-removed', changed: 'diff-modified' } as const;

export function requestCompare(): void {
    toast('Reading the committed version…');
    send({ type: 'compare' });
}

function image(png: string, width: number, height: number, label: string): HTMLElement {
    const img = el('img', { src: `data:image/png;base64,${png}`, alt: label, draggable: false });
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    return img;
}

function stage(r: Extract<CompareResult, { ok: true }>, mode: Mode, amount: number): HTMLElement {
    const s = S.snapshot;
    const before = image(r.png, r.width, r.height, 'Committed version');
    const now = s ? image(s.png, s.width, s.height, 'Current version') : el('div');
    const wrap = (...kids: HTMLElement[]) => el('div', { className: `cmp-stage cmp-${mode}` }, ...kids);
    if (mode === 'side') {
        return wrap(el('figure', {}, before, el('figcaption', {}, 'Committed (HEAD)')), el('figure', {}, now, el('figcaption', {}, 'Current')));
    }
    const layer = el('div', { className: 'cmp-layer' }, now);
    if (mode === 'swipe') {
        layer.style.clipPath = `inset(0 0 0 ${amount}%)`;
    } else {
        layer.style.opacity = String(amount / 100);
    }
    const holder = el('div', { className: 'cmp-holder' }, before, layer);
    holder.style.width = `${Math.max(r.width, s?.width ?? 0)}px`;
    holder.style.height = `${Math.max(r.height, s?.height ?? 0)}px`;
    return wrap(holder);
}

function changeRow(c: Change, close: () => void): HTMLElement {
    const row = el('div', { className: `cmp-change cmp-${c.kind}`, role: 'listitem', tabIndex: c.inForm ? 0 : -1 },
        icon(GLYPH[c.kind]), el('div', { className: 'cmp-text' }, el('div', {}, el('b', {}, c.target), ' ', el('span', { className: 'dim' }, c.cls)), ...c.lines.map((l) => el('div', { className: 'dim cmp-line' }, l))));
    if (c.inForm) {
        const go = () => {
            send({ type: 'selectNames', names: [c.target] });
            close();
        };
        row.title = 'Select it on the form';
        row.addEventListener('click', go);
        row.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                go();
            }
        });
    }
    return row;
}

/** The answer to `compare`: lists what changed since the last commit and lets the two renderings be swiped or faded. */
export function onCompareResult(r: CompareResult): void {
    if (!r.ok) {
        toast(r.error, { kind: 'error' });
        return;
    }
    const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
    const base = parse(r.baseXml);
    const cur = parse(r.currentXml);
    if (base.getElementsByTagName('parsererror').length > 0 || cur.getElementsByTagName('parsererror').length > 0) {
        toast('One of the two versions is not readable XML', { kind: 'error' });
        return;
    }
    const changes = diffForms(base, cur);
    let mode: Mode = 'swipe';
    let amount = 50;
    const view = el('div', { className: 'cmp-view' });
    const slider = el('input', { type: 'range', min: '0', max: '100', value: String(amount), className: 'cmp-slider' });
    slider.setAttribute('aria-label', 'Compare the two versions');
    const modes = (['swipe', 'fade', 'side'] as const).map((m) => {
        const b = el('button', { type: 'button', className: 'btn chip' }, m === 'swipe' ? 'Swipe' : m === 'fade' ? 'Fade' : 'Side by side');
        b.addEventListener('click', () => {
            mode = m;
            redraw();
        });
        return b;
    });
    const redraw = () => {
        modes.forEach((b, i) => b.classList.toggle('on', ['swipe', 'fade', 'side'][i] === mode));
        slider.hidden = mode === 'side';
        view.replaceChildren(stage(r, mode, amount));
    };
    slider.addEventListener('input', () => {
        amount = Number(slider.value);
        redraw();
    });
    const added = changes.filter((c) => c.kind === 'added').length;
    const removed = changes.filter((c) => c.kind === 'removed').length;
    const summary = changes.length === 0 ? 'No structural difference' : `${added} added · ${removed} removed · ${changes.length - added - removed} changed`;
    const list = el('div', { className: 'cmp-list', role: 'list' }, ...(changes.length === 0 ? [el('div', { className: 'hint' }, 'The form is the same as in the last commit.')] : changes.map((c) => changeRow(c, () => popup.close()))));
    const popup = openPopup([header(`Changes since ${r.ref}`, summary), el('div', { className: 'cmp-body' }, list, el('div', { className: 'cmp-right' }, el('div', { className: 'qss-chips' }, ...modes, slider), view)),
        footer(el('span', { className: 'spacer' }), secondaryButton('Close', () => popup.close()))], 'compare');
    redraw();
}
