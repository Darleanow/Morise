import type { ActionName } from '../protocol';
import * as actions from './actions';
import { $, el, icon } from './dom';
import { byName, primarySelection, rootObject } from './geometry';
import { copyText, S, send } from './state';
import { setTab } from './inspector';
import { ALIGNMENTS, alignable, runAlignment } from './align';
import { openPromote } from './dialogs';
import { mainWindowParts } from './commands';
import { hooks } from './hooks';

const popups = $<HTMLDivElement>('popups');

export interface MenuItem {
    label?: string;
    icon?: string;
    shortcut?: string;
    disabled?: boolean;
    separator?: boolean;
    run?: () => void;
    children?: MenuItem[];
}

let openRoot: HTMLElement | null = null;

export function closeMenu(): void {
    openRoot?.remove();
    openRoot = null;
}

export function menuOpen(): boolean {
    return openRoot !== null;
}

function build(items: MenuItem[], depth = 0): HTMLElement {
    const menu = el('div', { className: 'menu', role: 'menu' });
    for (const it of items) {
        if (it.separator) {
            menu.append(el('div', { className: 'menu-sep', role: 'separator' }));
            continue;
        }
        const row = el('div', { className: `menu-item${it.disabled ? ' disabled' : ''}`, role: 'menuitem', tabIndex: -1 },
            it.icon ? icon(it.icon) : el('span', { className: 'menu-icon' }),
            el('span', { className: 'menu-label' }, it.label ?? ''),
            it.shortcut ? el('span', { className: 'menu-shortcut' }, it.shortcut) : '',
            it.children ? icon('chevron-right') : '');
        row.setAttribute('aria-disabled', String(!!it.disabled));
        if (it.children) {
            row.setAttribute('aria-haspopup', 'true');
            let sub: HTMLElement | null = null;
            const showSub = () => {
                if (sub) {
                    return;
                }
                sub = build(it.children ?? [], depth + 1);
                popups.append(sub);
                const r = row.getBoundingClientRect();
                place(sub, r.right - 2, r.top - 4);
                sub.dataset.parentOf = String(depth);
            };
            row.addEventListener('mouseenter', showSub);
            row.addEventListener('click', (ev) => {
                ev.stopPropagation();
                showSub();
            });
            row.addEventListener('mouseleave', (ev) => {
                const to = ev.relatedTarget as Node | null;
                if (sub && !(to && sub.contains(to))) {
                    sub.remove();
                    sub = null;
                }
            });
        } else if (!it.disabled) {
            row.addEventListener('click', (ev) => {
                ev.stopPropagation();
                closeMenu();
                it.run?.();
            });
        }
        menu.append(row);
    }
    menu.addEventListener('mouseleave', (ev) => {
        // closing a submenu when the pointer leaves it towards the page
        if (depth > 0 && !(ev.relatedTarget as Node | null)?.parentElement?.closest('.menu')) {
            menu.remove();
        }
    });
    return menu;
}

function place(menu: HTMLElement, x: number, y: number): void {
    menu.style.left = '0px';
    menu.style.top = '0px';
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
}

export function openMenu(x: number, y: number, items: MenuItem[]): void {
    closeMenu();
    const menu = build(items);
    popups.append(menu);
    openRoot = menu;
    place(menu, x, y);
    menu.querySelector<HTMLElement>('.menu-item:not(.disabled)')?.focus();
}

function key(menu: HTMLElement, ev: KeyboardEvent): void {
    const rows = Array.from(menu.querySelectorAll<HTMLElement>('.menu-item:not(.disabled)'));
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        rows[(i + 1) % rows.length]?.focus();
    } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        rows[(i - 1 + rows.length) % rows.length]?.focus();
    } else if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        (document.activeElement as HTMLElement | null)?.click();
    } else if (ev.key === 'ArrowRight') {
        (document.activeElement as HTMLElement | null)?.click();
    } else if (ev.key === 'Escape') {
        ev.preventDefault();
        closeMenu();
    }
}

document.addEventListener('keydown', (ev) => {
    if (openRoot) {
        key(openRoot, ev);
    }
}, true);
document.addEventListener('pointerdown', (ev) => {
    if (openRoot && !(ev.target as HTMLElement).closest('.menu')) {
        closeMenu();
    }
}, true);
window.addEventListener('blur', closeMenu);

// ---- the object context menu -------------------------------------------------------------

function act(a: ActionName, label?: string): MenuItem {
    const d = actions.ACTIONS[a];
    return { label: label ?? d.label, icon: d.icon, shortcut: d.shortcut, disabled: !actions.isEnabled(a), run: () => actions.run(a) };
}

export function objectMenu(rename: () => void): MenuItem[] {
    const o = primarySelection();
    const items: MenuItem[] = [];
    const multi = (S.snapshot?.selection.length ?? 0) > 1;
    if (o && !multi) {
        items.push({ label: 'Rename\u2026', icon: 'edit', shortcut: 'F2', run: rename });
        if (hooks.editableText()) {
            items.push({ label: 'Edit text', icon: 'symbol-string', shortcut: 'Enter', run: () => hooks.editText() });
        }
        const parent = byName(o.parent);
        if (parent) {
            items.push({ label: `Select parent (${parent.name})`, icon: 'arrow-up', run: () => send({ type: 'selectNames', names: [parent.name] }) });
        }
        items.push({ separator: true });
    }
    if (o?.parent === null && o.class === 'QMainWindow' && !multi) {
        items.push({ label: 'Window parts', icon: 'layout', children: mainWindowParts(o.name).filter((p) => p.enabled).map((p) => ({ label: p.label, icon: p.icon, run: p.run })) }, { separator: true });
    }
    items.push(act('cut'), act('copy'), act('paste'), { label: 'Duplicate', icon: 'files', shortcut: 'Ctrl+D', disabled: !actions.isEnabled('copy'), run: () => actions.duplicate() }, act('delete'), { separator: true });
    items.push({
        label: 'Lay Out', icon: 'layout',
        children: [act('layoutHorizontal'), act('layoutVertical'), act('layoutGrid'), act('layoutForm'), act('layoutSplitHorizontal'), act('layoutSplitVertical')],
    });
    items.push(act('breakLayout'), act('adjustSize'), act('simplifyLayout'));
    const targets = alignable();
    items.push({
        label: 'Align and Size', icon: 'align-left',
        children: ALIGNMENTS.map((d) => ({ label: d.label, icon: d.icon, disabled: targets.length < d.needs, run: () => runAlignment(d.op) })),
    });
    items.push({ separator: true }, act('raise'), act('lower'), act('selectAll'));
    if (o && S.code && !multi) {
        const name = o.name;
        const cls = S.code.class;
        items.push({ separator: true });
        items.push({ label: 'Promote to custom widget\u2026', icon: 'extensions', run: () => openPromote([name], cls) });
        items.push({ label: 'Demote to standard widget', icon: 'discard', run: () => send({ type: 'demote', name }) });
        items.push({ label: 'Connect a signal from here\u2026', icon: 'plug', run: () => hooks.openConnect({ sender: name }) });
        items.push({
            label: 'Developer', icon: 'code',
            children: [
                { label: `Copy ui->${name}`, icon: 'copy', run: () => copyText(`ui->${name}`) },
                { label: `Copy self.ui.${name}`, icon: 'copy', run: () => copyText(`self.ui.${name}`) },
                { label: `Find usages of ui->${name}`, icon: 'search', run: () => send({ type: 'findInCode', query: `ui->${name}` }) },
                { separator: true },
                { label: 'Show signals and slots', icon: 'plug', run: () => setTab('code') },
                { label: 'Edit the keyboard focus order', icon: 'list-ordered', run: () => setTab('form') },
            ],
        });
    }
    return items;
}

export function formSizeMenu(apply: (w: number, h: number) => void): MenuItem[] {
    const presets: [string, number, number][] = [
        ['Small dialog', 320, 240], ['Dialog', 480, 360], ['VGA', 640, 480], ['SVGA', 800, 600],
        ['XGA', 1024, 768], ['HD 720p', 1280, 720], ['Full HD', 1920, 1080], ['Phone (portrait)', 360, 640],
    ];
    const root = rootObject();
    const items: MenuItem[] = presets.map(([label, w, h]) => ({ label: `${label}  ${w} × ${h}`, icon: root && root.w === w && root.h === h ? 'check' : undefined, run: () => apply(w, h) }));
    return items;
}
