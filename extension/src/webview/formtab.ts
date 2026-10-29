import type { ActionInfo } from '../protocol';
import { $, button, el, icon } from './dom';
import { byName } from './geometry';
import { classGlyph } from './canvas';
import { openMenu } from './menu';
import { S, send } from './state';

const root = $<HTMLDivElement>('form-settings');

function numberField(label: string, value: number | null, onChange: (v: number | null) => void, min = 0, max = 1000, placeholder = ''): HTMLElement {
    const input = el('input', { type: 'number', value: value === null ? '' : String(value), placeholder });
    input.min = String(min);
    input.max = String(max);
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange(input.value === '' ? null : Math.trunc(Number(input.value))));
    return el('label', { className: 'field' }, el('span', {}, label), input);
}

function textField(label: string, value: string, onChange: (v: string) => void, multiline = false): HTMLElement {
    const input = multiline ? el('textarea', { rows: 2, value }) : el('input', { type: 'text', value });
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange(input.value));
    return el('label', { className: 'field wide' }, el('span', {}, label), input);
}

function move(order: string[], from: number, to: number): string[] {
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item as string);
    return next;
}

let dragFrom = -1;

function tabOrderList(order: string[]): HTMLElement {
    const list = el('div', { className: 'order-list', role: 'listbox' });
    order.forEach((name, i) => {
        const o = byName(name);
        const row = el('div', { className: 'order-row', draggable: true, role: 'option', tabIndex: 0 },
            icon('gripper'), el('span', { className: 'badge-num inline' }, String(i + 1)), o ? classGlyph(o) : icon('symbol-field'), el('span', { className: 'order-name' }, name),
            button(`Move ${name} up`, icon('arrow-up'), () => send({ type: 'setTabOrder', order: move(order, i, Math.max(0, i - 1)) }), 'icon-btn'),
            button(`Move ${name} down`, icon('arrow-down'), () => send({ type: 'setTabOrder', order: move(order, i, Math.min(order.length - 1, i + 1)) }), 'icon-btn'));
        row.addEventListener('click', () => send({ type: 'selectNames', names: [name] }));
        row.addEventListener('dragstart', (ev) => {
            dragFrom = i;
            ev.dataTransfer?.setData('text/plain', name);
        });
        row.addEventListener('dragover', (ev) => ev.preventDefault());
        row.addEventListener('drop', (ev) => {
            ev.preventDefault();
            if (dragFrom >= 0 && dragFrom !== i) {
                send({ type: 'setTabOrder', order: move(order, dragFrom, i) });
            }
            dragFrom = -1;
        });
        row.addEventListener('keydown', (ev) => {
            if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
                ev.preventDefault();
                send({ type: 'setTabOrder', order: move(order, i, ev.key === 'ArrowUp' ? Math.max(0, i - 1) : Math.min(order.length - 1, i + 1)) });
            }
        });
        list.append(row);
    });
    return list;
}

function resourceList(info: NonNullable<typeof S.formInfo>): HTMLElement {
    const box = el('div', { className: 'resource-list' });
    for (const f of info.resources) {
        box.append(el('div', { className: 'resource-file' }, icon(f.exists ? 'package' : 'warning'), el('span', { className: 'order-name', title: f.path }, f.path),
            f.exists ? '' : el('span', { className: 'dim' }, 'missing'),
            button(`Remove ${f.path}`, icon('trash'), () => send({ type: 'removeResource', path: f.path }), 'icon-btn')));
        for (const pre of f.prefixes) {
            box.append(el('div', { className: 'resource-prefix dim' }, `:${pre.prefix}  ·  ${pre.files.length} files`));
            const grid = el('div', { className: 'thumb-grid' });
            pre.files.forEach((file, i) => {
                const path = `:${pre.prefix.endsWith('/') ? pre.prefix : pre.prefix + '/'}${file}`.replace(/^:\/\//, ':/');
                const cell = el('button', { type: 'button', className: 'thumb-cell', title: `${path} (click to copy)` },
                    pre.thumbs[i] ? el('img', { src: pre.thumbs[i], alt: '', draggable: false }) : icon('file'));
                cell.addEventListener('click', () => send({ type: 'copyText', text: path }));
                grid.append(cell);
            });
            box.append(grid);
        }
    }
    const add = el('button', { type: 'button', className: 'add-dynamic' }, icon('add'), 'Add a resource file (.qrc)…');
    add.addEventListener('click', () => send({ type: 'pickResource' }));
    box.append(add, el('p', { className: 'note' }, 'Icons chosen from a resource are saved as :/prefix/file and the form includes the .qrc.'));
    return box;
}

/** A menu of the menus and tool bars an action can go in (those holding it offer to take it out). */
function placeButton(a: ActionInfo, info: NonNullable<typeof S.formInfo>): HTMLElement {
    const b = button(`Place ${a.name} in a menu or tool bar`, icon('layout-menubar'), () => {
        const r = b.getBoundingClientRect();
        const items = info.actionTargets.map((t) => {
            const has = a.usedIn.includes(t.name);
            return {
                label: `${has ? 'Remove from' : 'Add to'} ${t.title || t.name}`,
                icon: has ? 'close' : t.kind === 'menu' ? 'list-flat' : 'tools',
                run: () => send({ type: 'useAction', target: t.name, action: a.name, ...(has ? { remove: true } : {}) }),
            };
        });
        const groups = (info.actionGroups ?? []).map((g) => {
            const has = g.actions.includes(a.name);
            return { label: `${has ? 'Take out of' : 'Put in'} group ${g.name}`, icon: has ? 'close' : 'symbol-namespace', run: () => send({ type: 'actionGroup', action: a.name, group: has ? '' : g.name }) };
        });
        const all = [...items, ...groups];
        openMenu(r.left, r.bottom, all.length > 0 ? all : [{ label: 'No menu, tool bar or action group in this form', disabled: true }]);
    }, 'icon-btn');
    return b;
}

/** Action groups (QActionGroup: exclusive choices such as left/centre/right): a row per group with its members, and a field to create one. */
function groupList(info: NonNullable<typeof S.formInfo>): HTMLElement {
    const box = el('div', { className: 'action-list' });
    for (const g of info.actionGroups ?? []) {
        box.append(el('div', { className: 'action-row', title: g.actions.join(', ') },
            icon('symbol-namespace'), el('span', { className: 'action-text' }, g.name),
            el('span', { className: 'dim action-meta' }, g.actions.length > 0 ? g.actions.join(', ') : 'empty'),
            button(`Remove the group ${g.name}`, icon('trash'), () => send({ type: 'actionGroup', name: g.name, remove: true }), 'icon-btn')));
    }
    const name = el('input', { type: 'text', placeholder: 'New group name…' });
    name.setAttribute('aria-label', 'Name of the new action group');
    const create = () => {
        if (name.value.trim() !== '') {
            send({ type: 'actionGroup', name: name.value.trim() });
            name.value = '';
        }
    };
    name.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            create();
        }
    });
    box.append(el('div', { className: 'action-new' }, name, button('Add the group', icon('add'), create, 'icon-btn')),
        el('p', { className: 'note' }, 'Checkable actions in one group are mutually exclusive. Use the place button of an action to put it in a group.'));
    return box;
}

/** One list of signatures with a field to add one; every change sends the whole pair of lists. */
function methodList(label: string, list: string[], apply: (next: string[]) => void): HTMLElement {
    const box = el('div', { className: 'method-list' });
    for (const sig of list) {
        box.append(el('div', { className: 'method-row' }, icon('symbol-method'), el('code', {}, sig),
            button(`Remove ${sig}`, icon('trash'), () => apply(list.filter((x) => x !== sig)), 'icon-btn')));
    }
    const input = el('input', { type: 'text', placeholder: `New ${label}, e.g. save(bool)` });
    input.setAttribute('aria-label', `Signature of the new ${label}`);
    const error = el('div', { className: 'rename-error' });
    const add = () => {
        const v = input.value.trim().replace(/\s+/g, '');
        if (v === '') {
            return;
        }
        if (!/^[\w+_]+\(([\w+:]\*?,?)*\)$/.test(v)) {
            error.textContent = 'Use a name followed by its argument types, e.g. save(bool).';
            return;
        }
        if (list.includes(v)) {
            error.textContent = `${v} already exists.`;
            return;
        }
        error.textContent = '';
        apply([...list, v]);
        input.value = '';
    };
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            add();
        }
    });
    box.append(el('div', { className: 'action-new' }, input, button(`Add the ${label}`, icon('add'), add, 'icon-btn')), error);
    return box;
}

/** The form's actions: a row per action (click to edit it in the inspector), and a field to create one. */
function actionList(info: NonNullable<typeof S.formInfo>): HTMLElement {
    const box = el('div', { className: 'action-list' });
    for (const a of info.actions) {
        const row = el('div', { className: 'action-row', role: 'button', tabIndex: 0, title: `Edit ${a.name} in the inspector` },
            icon(a.checkable ? 'check' : 'symbol-event'), el('span', { className: 'action-text' }, a.text || a.name),
            el('span', { className: 'dim action-meta' }, [a.shortcut, a.usedIn.length > 0 ? `in ${a.usedIn.join(', ')}` : 'unused'].filter(Boolean).join('  ·  ')),
            placeButton(a, info),
            button(`Remove ${a.name}`, icon('trash'), () => send({ type: 'removeAction', name: a.name }), 'icon-btn'));
        const open = () => send({ type: 'inspect', name: a.name });
        row.addEventListener('click', (ev) => {
            if (!(ev.target as HTMLElement).closest('button')) {
                open();
            }
        });
        row.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                open();
            }
        });
        box.append(row);
    }
    const text = el('input', { type: 'text', placeholder: 'New action text…' });
    text.setAttribute('aria-label', 'Text of the new action');
    const checkable = el('input', { type: 'checkbox' });
    const create = () => {
        if (text.value.trim() !== '') {
            send({ type: 'addAction', text: text.value.trim(), ...(checkable.checked ? { checkable: true } : {}) });
            text.value = '';
        }
    };
    text.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            create();
        }
    });
    box.append(el('div', { className: 'action-new' }, text, el('label', { className: 'dim' }, checkable, ' checkable'), button('Add the action', icon('add'), create, 'icon-btn')),
        el('p', { className: 'note' }, 'Actions are what menu entries and tool bar buttons trigger. Click one to edit its text, icon and shortcut.'));
    return box;
}

/** Form-wide settings: grid, layout defaults, metadata, and the keyboard focus order. */
export function renderFormTab(): void {
    const info = S.formInfo;
    const frag = document.createDocumentFragment();
    if (!info) {
        root.replaceChildren(el('div', { className: 'empty' }, icon('settings'), el('p', {}, 'Loading the form settings…')));
        return;
    }
    const apply = (partial: Record<string, unknown>) => send({ type: 'setFormInfo', info: partial });
    frag.append(
        el('div', { className: 'section-title' }, 'Grid'),
        el('div', { className: 'fields' },
            numberField('Grid X', info.grid[0], (v) => apply({ grid: [v ?? 10, info.grid[1]] }), 1, 100),
            numberField('Grid Y', info.grid[1], (v) => apply({ grid: [info.grid[0], v ?? 10] }), 1, 100)),
        el('p', { className: 'note' }, 'Widgets snap to this grid while you move and resize them. Hold Alt to bypass it.'),
        el('div', { className: 'section-title' }, 'Layout defaults'),
        el('div', { className: 'fields' },
            numberField('Margin', info.layoutDefault[0], (v) => apply({ layoutDefault: [v, info.layoutDefault[1]] }), -1, 100, 'style'),
            numberField('Spacing', info.layoutDefault[1], (v) => apply({ layoutDefault: [info.layoutDefault[0], v] }), -1, 100, 'style')),
        el('p', { className: 'note' }, 'Leave empty to use the style’s values. Applied to layouts created afterwards.'),
        el('div', { className: 'section-title' }, 'Document'),
        el('div', { className: 'fields col' },
            textField('Author', info.author, (v) => apply({ author: v })),
            textField('Comment', info.comment, (v) => apply({ comment: v }), true),
            textField('Export macro', info.exportMacro, (v) => apply({ exportMacro: v })),
            textField('Include hints (one per line)', info.includeHints.join('\n'), (v) => apply({ includeHints: v.split('\n').map((l) => l.trim()).filter(Boolean) }), true)),
        el('div', { className: 'section-title' }, 'Resources', el('span', { className: 'dim count' }, String(info.resources.length))),
        resourceList(info),
        el('div', { className: 'section-title' }, 'Custom slots', el('span', { className: 'dim count' }, String(info.customSlots.length))),
        methodList('slot', info.customSlots, (next) => send({ type: 'setCustomMethods', slots: next, signals: info.customSignals })),
        el('div', { className: 'section-title' }, 'Custom signals', el('span', { className: 'dim count' }, String(info.customSignals.length))),
        methodList('signal', info.customSignals, (next) => send({ type: 'setCustomMethods', slots: info.customSlots, signals: next })),
        el('p', { className: 'note' }, 'Slots and signals of the form itself, offered in the connection dialog and saved in the .ui.'),
        el('div', { className: 'section-title' }, 'Actions', el('span', { className: 'dim count' }, String(info.actions.length))),
        actionList(info),
        el('div', { className: 'section-title' }, 'Action groups', el('span', { className: 'dim count' }, String((info.actionGroups ?? []).length))),
        groupList(info),
        el('div', { className: 'section-title' }, 'Keyboard focus order', el('span', { className: 'dim count' }, String(S.tabOrder?.length ?? 0))),
        el('p', { className: 'note' }, 'The order Tab moves through the widgets, numbered on the form. Drag a row, or use the arrows.'));
    frag.append(S.tabOrder && S.tabOrder.length > 0 ? tabOrderList(S.tabOrder) : el('div', { className: 'hint' }, 'No widget takes keyboard focus.'));
    root.replaceChildren(frag);
}
