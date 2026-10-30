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

/** Match score: the whole label, a prefix of it or of a word, then any substring; letters scattered in order do not count. */
function fuzzy(haystack: string, label: string, q: string): number {
    const h = haystack.toLowerCase();
    const l = label.toLowerCase();
    if (l === q) return 100;
    if (l.startsWith(q)) return 85;
    if (h.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 70;
    if (h.includes(q)) return 50;
    return 0;
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
    const rank = (items: Command[], q: string, limit: number): Command[] =>
        (q === '' ? items.map((c) => ({ c, s: 1 })) : items.map((c) => ({ c, s: fuzzy(`${c.label} ${c.keywords ?? ''}`, c.label, q) })).filter((x) => x.s > 0))
            .sort((x, y) => (Number(y.c.enabled !== false) - Number(x.c.enabled !== false)) || y.s - x.s).map((x) => x.c).slice(0, limit);
    const paint = () => {
        const raw = input.value;
        const prefix = raw[0] === '>' || raw[0] === '@' || raw[0] === ':' ? raw[0] : '';
        const q = (prefix ? raw.slice(1) : raw).trim().toLowerCase();
        const commandMode = prefix !== '';
        input.placeholder = prefix === '>' ? 'Type a command: align, preview, zoom\u2026' : prefix === '@' ? 'Go to an object of the form\u2026' : prefix === ':' ? 'Go to a property of the selection\u2026' : 'Search widgets, objects and commands\u2026   (> commands  @ objects  : properties)';
        hintText.textContent = prefix === '>' ? 'Runs a command' : prefix === '@' ? 'Selects the object' : prefix === ':' ? 'Edits the property' : at ? `Adds at ${Math.round(at.x)}, ${Math.round(at.y)}` : 'Adds inside the selected container';
        if (prefix === '>') {
            shown = rank(hooks.commands(), q, 60);
        } else if (prefix === '@') {
            shown = rank(hooks.objects(), q, 60);
        } else if (prefix === ':') {
            shown = rank(hooks.properties(), q, 80);
        } else {
            const all = entries();
            if (q === '') {
                const recent = prefs.recent.flatMap((r) => all.filter((e) => e.category === r.category && e.w.index === r.index));
                shown = [...recent, ...all.filter((e) => !recent.includes(e))].slice(0, 40);
            } else {
                const widgets = all.map((e) => ({ e, s: score(e, q) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).map((x) => x.e).slice(0, 24);
                const sect = (items: Command[], section: string) => items.map((c) => ({ ...c, section }));
                shown = [...widgets, ...sect(rank(hooks.objects(), q, 5), 'Objects in this form'), ...sect(rank(hooks.commands(), q, 8), 'Commands')];
            }
        }
        active = Math.min(active, Math.max(0, shown.length - 1));
        let lastHead = '';
        const hasMixed = !commandMode && q !== '';
        list.replaceChildren(...shown.flatMap((e, i) => {
            let row: HTMLElement;
            if (isCommand(e)) {
                row = el('div', { className: `qa-item${i === active ? ' active' : ''}${e.enabled === false ? ' off' : ''}`, role: 'option' },
                    icon(e.icon), el('span', { className: 'qa-name' }, e.label), e.detail ? el('span', { className: 'dim' }, e.detail) : '', el('span', { className: 'spacer' }), e.shortcut ? el('kbd', {}, e.shortcut) : '');
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
            const head = isCommand(e) ? (e.section ?? '') : (hasMixed ? 'Add a widget' : '');
            if (head !== '' && head !== lastHead) {
                lastHead = head;
                return [el('div', { className: 'qa-head dim' }, head), row];
            }
            return [row];
        }));
        if (shown.length === 0) {
            list.append(el('div', { className: 'hint' }, commandMode ? 'Nothing matches.' : 'Nothing matches.'));
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
