import type { PaletteWidget } from '../protocol';
import { addWidgetAt } from './adding';
import { $, el, icon } from './dom';
import { hooks, type Command } from './hooks';
import { S, prefs } from './state';

const popups = $<HTMLDivElement>('popups');
let root: HTMLElement | null = null;

interface Entry { w: PaletteWidget; category: number; categoryName: string }

function entries(): Entry[] {
    return S.palette.flatMap((c) => c.widgets.map((w) => ({ w, category: c.index, categoryName: c.name })));
}

function score(e: Entry, q: string): number {
    const name = e.w.name.toLowerCase();
    const cls = e.w.className.toLowerCase();
    if (name === q || cls === q || cls === `q${q}`) return 100;
    if (name.startsWith(q) || cls.startsWith(q) || cls.startsWith(`q${q}`)) return 80;
    if (name.includes(q) || cls.includes(q)) return 50;
    return e.categoryName.toLowerCase().includes(q) ? 10 : 0;
}

export function quickAddOpen(): boolean {
    return root !== null;
}

export function closeQuickAdd(): void {
    root?.remove();
    root = null;
}

export function openQuickAdd(at?: { x: number; y: number }, startInCommands = false): void {
    closeQuickAdd();
    const input = el('input', { type: 'text', placeholder: 'Add a widget: button, label, line edit… (type > for commands)', className: 'qa-input', value: startInCommands ? '>' : '' });
    input.setAttribute('aria-label', 'Add a widget, or type > to search commands');
    const list = el('div', { className: 'qa-list', role: 'listbox' });
    const hintText = el('span', { className: 'qa-hint-text' }, '');
    const hint = el('div', { className: 'qa-hint' }, hintText, el('span', { className: 'dim qa-keys' }, '↑↓ choose  ↵ run  > commands  Esc close'));
    const box = el('div', { className: 'popup quickadd' }, el('div', { className: 'qa-row' }, icon('add'), input), list, hint);
    const scrim = el('div', { className: 'scrim' }, box);
    root = scrim;
    popups.append(scrim);

    let shown: (Entry | Command)[] = [];
    let active = 0;
    const isCommand = (x: Entry | Command): x is Command => 'run' in x;

    const choose = (e: Entry | Command | undefined) => {
        if (!e) {
            return;
        }
        closeQuickAdd();
        if (isCommand(e)) {
            if (e.enabled !== false) {
                e.run();
            }
            return;
        }
        addWidgetAt(e.category, e.w.index, at);
    };
    const paint = () => {
        const raw = input.value;
        const commandMode = raw.startsWith('>');
        const q = (commandMode ? raw.slice(1) : raw).trim().toLowerCase();
        input.placeholder = commandMode ? 'Type a command: align, preview, zoom\u2026' : 'Add a widget: button, label, line edit\u2026   (type > for commands)';
        hintText.textContent = commandMode ? 'Runs a command' : at ? `Adds at ${Math.round(at.x)}, ${Math.round(at.y)}` : 'Adds inside the selected container';
        if (commandMode) {
            const all = hooks.commands();
            shown = (q === '' ? all : all.filter((c) => `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(q))).sort((a, b) => Number(b.enabled !== false) - Number(a.enabled !== false)).slice(0, 60);
        } else {
            const all = entries();
            if (q === '') {
                const recent = prefs.recent.flatMap((r) => all.filter((e) => e.category === r.category && e.w.index === r.index));
                shown = [...recent, ...all.filter((e) => !recent.includes(e))].slice(0, 40);
            } else {
                shown = all.map((e) => ({ e, s: score(e, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.e).slice(0, 40);
            }
        }
        active = Math.min(active, Math.max(0, shown.length - 1));
        list.replaceChildren(...shown.map((e, i) => {
            let row: HTMLElement;
            if (isCommand(e)) {
                row = el('div', { className: `qa-item${i === active ? ' active' : ''}${e.enabled === false ? ' off' : ''}`, role: 'option' },
                    icon(e.icon), el('span', { className: 'qa-name' }, e.label), el('span', { className: 'spacer' }), e.shortcut ? el('kbd', {}, e.shortcut) : '');
            } else {
                const glyph = e.w.icon ? el('img', { className: 'wicon', src: e.w.icon, alt: '', draggable: false }) : icon('symbol-field');
                row = el('div', { className: `qa-item${i === active ? ' active' : ''}`, role: 'option' }, glyph, el('span', { className: 'qa-name' }, e.w.name), el('span', { className: 'dim' }, e.w.className), el('span', { className: 'dim qa-cat' }, e.categoryName));
            }
            row.setAttribute('aria-selected', String(i === active));
            // Only move the highlight: rebuilding the rows here would replace the one under the pointer and swallow its click.
            row.addEventListener('mouseenter', () => {
                active = i;
                list.querySelectorAll('.qa-item').forEach((r, j) => {
                    r.classList.toggle('active', j === i);
                    r.setAttribute('aria-selected', String(j === i));
                });
            });
            row.addEventListener('click', () => choose(e));
            return row;
        }));
        if (shown.length === 0) {
            list.append(el('div', { className: 'hint' }, commandMode ? 'No command matches.' : 'No widget matches.'));
        }
        list.querySelector('.qa-item.active')?.scrollIntoView?.({ block: 'nearest' });
    };
    input.addEventListener('input', () => {
        active = 0;
        paint();
    });
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            active = Math.min(shown.length - 1, active + 1);
            paint();
        } else if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            active = Math.max(0, active - 1);
            paint();
        } else if (ev.key === 'Enter') {
            ev.preventDefault();
            choose(shown[active]);
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            closeQuickAdd();
        }
    });
    scrim.addEventListener('pointerdown', (ev) => {
        if (ev.target === scrim) {
            closeQuickAdd();
        }
    });
    paint();
    input.focus();
}
