import type { PaletteWidget } from '../protocol';
import { addWidgetAt } from './adding';
import { dragged, PALETTE_MIME } from './canvas';
import { $, el, icon } from './dom';
import { classIcons, prefs, S, savePrefs } from './state';

const paletteEl = $<HTMLDivElement>('palette');
const filterEl = $<HTMLInputElement>('palette-filter');
const collapsed = new Set<number>();

export function learnIcons(): void {
    classIcons.clear();
    for (const cat of S.palette) {
        for (const w of cat.widgets) {
            if (w.icon && w.className && !classIcons.has(w.className)) {
                classIcons.set(w.className, w.icon);
            }
        }
    }
}

function glyph(w: PaletteWidget): HTMLElement {
    if (w.icon) {
        const img = el('img', { className: 'wicon', src: w.icon, alt: '' });
        img.draggable = false;
        return img;
    }
    return icon('symbol-field');
}

function item(w: PaletteWidget, category: number): HTMLElement {
    const row = el('div', { className: 'pal-item', draggable: true, tabIndex: 0, title: `${w.className || w.name}: drag onto the form, double-click or press Enter to add` }, glyph(w), el('span', {}, w.name));
    row.addEventListener('dragstart', (ev) => {
        dragged.entry = { name: w.name, category, index: w.index };
        ev.dataTransfer?.setData(PALETTE_MIME, `${category},${w.index}`);
        if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = 'copy';
        }
    });
    const add = () => addWidgetAt(category, w.index);
    row.addEventListener('dblclick', add);
    row.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            add();
        }
    });
    return row;
}

export function renderPalette(): void {
    const q = filterEl.value.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    const section = (key: number, label: string, glyphName: string, widgets: { w: PaletteWidget; category: number }[]) => {
        if (widgets.length === 0) {
            return;
        }
        const open = q !== '' || !collapsed.has(key);
        const head = el('div', { className: 'pal-cat', role: 'button', tabIndex: 0 }, icon(open ? 'chevron-down' : 'chevron-right'), icon(glyphName), label);
        head.setAttribute('aria-expanded', String(open));
        const toggle = () => {
            if (collapsed.has(key)) {
                collapsed.delete(key);
            } else {
                collapsed.add(key);
            }
            renderPalette();
        };
        head.addEventListener('click', toggle);
        head.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                toggle();
            }
        });
        frag.append(head);
        if (open) {
            for (const { w, category } of widgets) {
                frag.append(item(w, category));
            }
        }
    };

    if (q === '') {
        const recent = prefs.recent.flatMap((r) => {
            const w = S.palette.find((c) => c.index === r.category)?.widgets.find((x) => x.index === r.index);
            return w ? [{ w, category: r.category }] : [];
        });
        section(-1, 'Recent', 'history', recent);
    }
    for (const cat of S.palette) {
        const widgets = cat.widgets.filter((w) => !q || w.name.toLowerCase().includes(q) || w.className.toLowerCase().includes(q)).map((w) => ({ w, category: cat.index }));
        section(cat.index, cat.name, 'folder', widgets);
    }
    if (!frag.hasChildNodes()) {
        frag.append(el('p', { className: 'hint' }, 'No widget matches your search.'));
    }
    paletteEl.replaceChildren(frag);
}

export function initPalette(): void {
    filterEl.addEventListener('input', renderPalette);
    const collapseAll = $<HTMLButtonElement>('palette-collapse');
    collapseAll.replaceChildren(icon('collapse-all'));
    collapseAll.addEventListener('click', () => {
        const allCollapsed = S.palette.every((c) => collapsed.has(c.index));
        collapsed.clear();
        if (!allCollapsed) {
            for (const c of S.palette) {
                collapsed.add(c.index);
            }
        }
        renderPalette();
    });
    savePrefs();
}
