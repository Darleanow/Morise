import type { GridContents, TreeItem } from '../protocol';
import { button, el, icon } from './dom';
import { footer, header, openPopup, primaryButton, secondaryButton } from './popup';
import { send } from './state';

interface Flat { depth: number; cells: string[] }

function flatten(items: TreeItem[], depth = 0, out: Flat[] = []): Flat[] {
    for (const i of items) {
        out.push({ depth, cells: [...i.cells] });
        flatten(i.children, depth + 1, out);
    }
    return out;
}

function nest(flat: Flat[]): TreeItem[] {
    const root: TreeItem[] = [];
    const stack: TreeItem[][] = [root];
    for (const f of flat) {
        const d = Math.min(f.depth, stack.length - 1);
        const item: TreeItem = { cells: f.cells, children: [] };
        (stack[d] as TreeItem[]).push(item);
        stack.length = d + 1;
        stack.push(item.children);
    }
    return root;
}

function labelled(text: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', { type: 'button', className: 'btn' }, icon('add'), text);
    b.addEventListener('click', onClick);
    return b;
}

function textInput(value: string, label: string, onChange: (v: string) => void): HTMLInputElement {
    const input = el('input', { type: 'text', value });
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange(input.value));
    return input;
}

/** Editor for the captions of a table or tree widget: headers, rows and cells, applied as one undo step. */
export function openGridEditor(name: string, start: GridContents): void {
    const data: GridContents = JSON.parse(JSON.stringify(start));
    const flat = data.kind === 'tree' ? flatten(data.items) : [];
    const body = el('div', { className: 'grid-body' });

    const normalise = () => {
        flat.forEach((f, i) => {
            f.depth = Math.max(0, Math.min(f.depth, i === 0 ? 0 : (flat[i - 1] as Flat).depth + 1));
        });
    };
    const addColumn = () => {
        const n = data.columns.length + 1;
        data.columns.push(data.kind === 'table' ? `Column ${n}` : `${n}`);
        if (data.kind === 'table') {
            data.cells.forEach((r) => r.push(''));
        } else {
            flat.forEach((f) => f.cells.push(''));
        }
        paint();
    };
    const removeColumn = (c: number) => {
        data.columns.splice(c, 1);
        if (data.kind === 'table') {
            data.cells.forEach((r) => r.splice(c, 1));
        } else {
            flat.forEach((f) => f.cells.splice(c, 1));
        }
        paint();
    };
    const columnHeads = (lead: number): HTMLElement[] =>
        data.columns.map((col, c) => el('th', {}, el('div', { className: 'grid-head' },
            textInput(col, `Column ${c + 1}`, (v) => { data.columns[c] = v; }),
            data.columns.length > (data.kind === 'tree' ? 1 : 0) ? button('Remove column', icon('close'), () => removeColumn(c), 'icon-btn') : '')));

    const paintTable = (d: Extract<GridContents, { kind: 'table' }>) => {
        const head = el('tr', {}, el('th', {}), ...columnHeads(1), el('th', {}));
        const rows = d.rows.map((rh, r) => el('tr', {},
            el('th', {}, textInput(rh, `Row ${r + 1} header`, (v) => { d.rows[r] = v; })),
            ...d.columns.map((_, c) => el('td', {}, textInput((d.cells[r] as string[])[c] ?? '', `Row ${r + 1}, column ${c + 1}`, (v) => { (d.cells[r] as string[])[c] = v; }))),
            el('td', {}, button('Remove row', icon('trash'), () => { d.rows.splice(r, 1); d.cells.splice(r, 1); paint(); }, 'icon-btn'))));
        const add = el('div', { className: 'grid-actions' },
            labelled('Add row', () => { d.rows.push(''); d.cells.push(d.columns.map(() => '')); paint(); }),
            labelled('Add column', addColumn));
        body.replaceChildren(el('table', { className: 'grid' }, el('thead', {}, head), el('tbody', {}, ...rows)), add);
    };

    const paintTree = (d: Extract<GridContents, { kind: 'tree' }>) => {
        const head = el('tr', {}, el('th', {}), ...columnHeads(0), el('th', {}));
        const rows = flat.map((f, i) => {
            const move = (to: number) => {
                const [x] = flat.splice(i, 1);
                flat.splice(to, 0, x as Flat);
                normalise();
                paint();
            };
            const left = button('Outdent', icon('arrow-left'), () => { f.depth--; normalise(); paint(); }, 'icon-btn');
            left.disabled = f.depth === 0;
            const right = button('Indent (make a child of the item above)', icon('arrow-right'), () => { f.depth++; normalise(); paint(); }, 'icon-btn');
            right.disabled = i === 0 || f.depth > (flat[i - 1] as Flat).depth;
            const up = button('Move up', icon('arrow-up'), () => move(i - 1), 'icon-btn');
            up.disabled = i === 0;
            const down = button('Move down', icon('arrow-down'), () => move(i + 1), 'icon-btn');
            down.disabled = i === flat.length - 1;
            const first = d.columns.map((_, c) => {
                const cell = el('td', {}, textInput(f.cells[c] ?? '', `Item ${i + 1}, column ${c + 1}`, (v) => { f.cells[c] = v; }));
                if (c === 0) {
                    cell.style.paddingLeft = `${f.depth * 18}px`;
                }
                return cell;
            });
            return el('tr', {}, el('th', {}, String(i + 1)), ...first,
                el('td', { className: 'grid-row-actions' }, left, right, up, down, button('Remove item (and its children)', icon('trash'), () => {
                    let end = i + 1;
                    while (end < flat.length && (flat[end] as Flat).depth > f.depth) {
                        end++;
                    }
                    flat.splice(i, end - i);
                    paint();
                }, 'icon-btn')));
        });
        const add = el('div', { className: 'grid-actions' },
            labelled('Add item', () => { flat.push({ depth: 0, cells: d.columns.map((_, c) => (c === 0 ? 'Item' : '')) }); paint(); }),
            labelled('Add column', addColumn));
        body.replaceChildren(el('table', { className: 'grid' }, el('thead', {}, head), el('tbody', {}, ...rows)), add);
    };

    const paint = () => (data.kind === 'table' ? paintTable(data) : paintTree(data));
    const apply = () => {
        popup.close();
        if (data.kind === 'tree') {
            data.items = nest(flat);
        }
        send({ type: 'setContents', name, contents: data });
    };
    const popup = openPopup([
        header(data.kind === 'table' ? 'Edit table' : 'Edit tree', name),
        body,
        footer(el('span', { className: 'spacer' }), secondaryButton('Cancel', () => popup.close()), primaryButton('Apply', apply)),
    ], 'grid-editor');
    paint();
}
