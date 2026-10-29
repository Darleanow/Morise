import { $, button, el, icon } from './dom';
import { byName } from './geometry';
import { classGlyph } from './canvas';
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
        }
    }
    const add = el('button', { type: 'button', className: 'add-dynamic' }, icon('add'), 'Add a resource file (.qrc)…');
    add.addEventListener('click', () => send({ type: 'pickResource' }));
    box.append(add, el('p', { className: 'note' }, 'Icons chosen from a resource are saved as :/prefix/file and the form includes the .qrc.'));
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
        el('div', { className: 'section-title' }, 'Keyboard focus order', el('span', { className: 'dim count' }, String(S.tabOrder?.length ?? 0))),
        el('p', { className: 'note' }, 'The order Tab moves through the widgets, numbered on the form. Drag a row, or use the arrows.'));
    frag.append(S.tabOrder && S.tabOrder.length > 0 ? tabOrderList(S.tabOrder) : el('div', { className: 'hint' }, 'No widget takes keyboard focus.'));
    root.replaceChildren(frag);
}
