import type { SceneLayout, SceneObject } from '../protocol';
import { $, el, icon } from './dom';
import { classGlyph, menuAfterSelect, renderOverlay } from './canvas';
import { byName, layoutsOf } from './geometry';
import { S, send } from './state';

const tree = $<HTMLDivElement>('tree');
const filterEl = $<HTMLInputElement>('outline-filter');
const collapseBtn = $<HTMLButtonElement>('outline-collapse');

interface Node {
    key: string;
    kind: 'widget' | 'layout' | 'action' | 'group';
    obj?: SceneObject;
    layout?: SceneLayout;
    /** Label and class for the rows that are not widgets (the actions group and its entries). */
    text?: string;
    meta?: string;
    children: Node[];
    parent: Node | null;
}

const collapsed = new Set<string>();
let lastSelection = '';
let flat: { node: Node; depth: number }[] = [];

function build(): Node[] {
    const s = S.snapshot;
    if (!s) {
        return [];
    }
    const kids = new Map<string | null, SceneObject[]>();
    for (const o of s.objects) {
        kids.set(o.parent, [...(kids.get(o.parent) ?? []), o]);
    }
    const widgetNode = (o: SceneObject, parent: Node | null): Node => {
        const node: Node = { key: `w:${o.name}`, kind: 'widget', obj: o, children: [], parent };
        const layouts = layoutsOf(o.name);
        const emitLayout = (l: SceneLayout, up: Node): void => {
            const ln: Node = { key: `l:${l.owner}:${l.name}`, kind: 'layout', layout: l, children: [], parent: up };
            up.children.push(ln);
            for (const sub of s.layouts.filter((x) => x.parent === l.name && x.owner === l.owner)) {
                emitLayout(sub, ln);
            }
        };
        for (const l of layouts.filter((x) => !x.parent)) {
            emitLayout(l, node);
        }
        const own = kids.get(o.name) ?? [];
        // widgets managed by a layout are shown under it, free widgets next to it
        const host = node.children.find((c) => c.kind === 'layout') ?? node;
        for (const k of own.filter((x) => x.laidOut)) {
            host.children.push(widgetNode(k, host));
        }
        for (const k of own.filter((x) => !x.laidOut)) {
            node.children.push(widgetNode(k, node));
        }
        return node;
    };
    const roots = (kids.get(null) ?? []).map((r) => widgetNode(r, null));
    const acts = (S.formInfo?.actions ?? []).filter((a) => !a.separator);
    if (acts.length > 0) {
        const group: Node = { key: 'g:actions', kind: 'group', text: 'actions', meta: String(acts.length), children: [], parent: null };
        for (const a of acts) {
            group.children.push({ key: `a:${a.name}`, kind: 'action', text: a.name, meta: a.text || (a.usedIn.length > 0 ? '' : 'unused'), children: [], parent: group });
        }
        roots.push(group);
    }
    return roots;
}

function matches(n: Node, q: string): boolean {
    const text = n.kind === 'widget' ? `${n.obj?.name} ${n.obj?.class}` : n.kind === 'layout' ? `${n.layout?.name} ${n.layout?.kind}` : `${n.text} ${n.meta}`;
    return text.toLowerCase().includes(q);
}

function flatten(nodes: Node[], q: string): { node: Node; depth: number }[] {
    const out: { node: Node; depth: number }[] = [];
    const visit = (n: Node, depth: number): boolean => {
        const mark = out.length;
        out.push({ node: n, depth });
        let any = q === '' || matches(n, q);
        const open = q !== '' || !collapsed.has(n.key);
        for (const c of n.children) {
            if (open || q !== '') {
                if (visit(c, depth + 1)) {
                    any = true;
                }
            }
        }
        if (!any) {
            out.length = mark;
        }
        return any;
    };
    for (const n of nodes) {
        visit(n, 0);
    }
    return out;
}

function selectNode(n: Node, additive = false): void {
    if (n.kind === 'action') {
        send({ type: 'inspect', name: n.text ?? '' });
        return;
    }
    if (n.kind === 'group') {
        return;
    }
    if (n.kind === 'layout' && n.layout) {
        S.focusedLayout = n.layout.name;
        renderOverlay();
        send({ type: 'inspect', name: n.layout.name });
        return;
    }
    const name = n.obj?.name;
    if (!name) {
        return;
    }
    if (additive && S.snapshot) {
        const sel = S.snapshot.selection;
        send({ type: 'selectNames', names: sel.includes(name) ? sel.filter((x) => x !== name) : [...sel, name] });
    } else {
        send({ type: 'selectNames', names: [name] });
    }
}

function nodeName(n: Node): string {
    return n.kind === 'widget' ? (n.obj?.name ?? '') : n.kind === 'layout' ? (n.layout?.name ?? '') : (n.text ?? '');
}

function revealSelection(): void {
    // Opening the ancestors of the selected widgets keeps the selection visible in a collapsed tree.
    for (const name of S.snapshot?.selection ?? []) {
        for (let o = byName(byName(name)?.parent); o; o = byName(o.parent)) {
            collapsed.delete(`w:${o.name}`);
        }
    }
}

export function renderOutline(): void {
    const s = S.snapshot;
    if (!s) {
        return;
    }
    const selKey = s.selection.join('\u0000');
    if (selKey !== lastSelection) {
        revealSelection();
    }
    const q = filterEl.value.trim().toLowerCase();
    const roots = build();
    flat = flatten(roots, q);
    const selected = new Set(s.selection);
    const frag = document.createDocumentFragment();
    let tabStop = false;
    for (const { node, depth } of flat) {
        const isSel = node.kind === 'widget' ? selected.has(nodeName(node)) : node.kind !== 'group' && S.propertiesFor === nodeName(node);
        const hasKids = node.children.length > 0;
        const open = q !== '' || !collapsed.has(node.key);
        const glyph = node.kind === 'layout' ? icon('layout') : node.kind === 'group' ? icon('zap') : node.kind === 'action' ? icon('symbol-event') : node.obj ? classGlyph(node.obj) : icon('symbol-field');
        const chevron = hasKids
            ? el('span', { className: 'twisty' }, icon(open ? 'chevron-down' : 'chevron-right'))
            : el('span', { className: 'twisty leaf' });
        const label = nodeName(node);
        const cls = node.kind === 'widget' ? node.obj?.class ?? '' : node.kind === 'layout' ? node.layout?.kind ?? '' : node.meta ?? '';
        const row = el('div', { className: `tree-row${isSel ? ' selected' : ''}${node.kind === 'layout' ? ' layout' : ''}${nodeName(node) === S.hovered ? ' hover' : ''}`, role: 'treeitem', tabIndex: isSel && !tabStop ? 0 : -1 },
            chevron, glyph, el('span', { className: 'tree-name' }, label), el('span', { className: 'tree-class' }, cls));
        if (isSel) {
            tabStop = true;
        }
        row.dataset.name = nodeName(node);
        row.dataset.key = node.key;
        row.style.paddingLeft = `${4 + depth * 14}px`;
        row.setAttribute('aria-selected', String(isSel));
        row.setAttribute('aria-level', String(depth + 1));
        if (hasKids) {
            row.setAttribute('aria-expanded', String(open));
        }
        chevron.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (hasKids) {
                if (collapsed.has(node.key)) {
                    collapsed.delete(node.key);
                } else {
                    collapsed.add(node.key);
                }
                renderOutline();
            }
        });
        row.addEventListener('click', (ev) => selectNode(node, ev.shiftKey || ev.ctrlKey || ev.metaKey));
        if (node.kind === 'widget') {
            row.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                menuAfterSelect([nodeName(node)], ev.clientX, ev.clientY);
            });
            row.addEventListener('dblclick', () => document.dispatchEvent(new CustomEvent('qtd-edit-text', { detail: nodeName(node) })));
        }
        frag.append(row);
    }
    if (flat.length === 0) {
        frag.append(el('p', { className: 'hint' }, q ? 'No object matches the filter.' : 'The form has no objects.'));
    }
    // Rebuilding the rows must not drop the keyboard focus, or arrow-key navigation would stop after one step.
    const focused = tree.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
    tree.replaceChildren(frag);
    if (focused) {
        Array.from(tree.querySelectorAll<HTMLElement>('.tree-row')).find((r) => r.dataset.key === focused)?.focus({ preventScroll: true });
    }
    if (!tabStop) {
        tree.querySelector<HTMLElement>('.tree-row')?.setAttribute('tabindex', '0');
    }
    if (selKey !== lastSelection) {
        lastSelection = selKey;
        tree.querySelector('.tree-row.selected')?.scrollIntoView?.({ block: 'nearest' });
    }
    collapseBtn.replaceChildren(icon(collapsed.size > 0 ? 'expand-all' : 'collapse-all'));
}

/** Cheap refresh of the hover highlight without rebuilding the tree. */
export function refreshOutlineHover(): void {
    for (const r of Array.from(tree.querySelectorAll<HTMLElement>('.tree-row'))) {
        r.classList.toggle('hover', r.dataset.name !== undefined && r.dataset.name === S.hovered);
    }
}

function focusRow(i: number): void {
    const target = flat[Math.max(0, Math.min(flat.length - 1, i))];
    if (!target) {
        return;
    }
    Array.from(tree.querySelectorAll<HTMLElement>('.tree-row')).find((r) => r.dataset.key === target.node.key)?.focus();
    selectNode(target.node);
}

export function initOutline(): void {
    filterEl.addEventListener('input', renderOutline);
    filterEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            tree.querySelector<HTMLElement>('.tree-row')?.focus();
        } else if (ev.key === 'Escape' && filterEl.value) {
            ev.stopPropagation();
            filterEl.value = '';
            renderOutline();
        }
    });
    collapseBtn.addEventListener('click', () => {
        if (collapsed.size > 0) {
            collapsed.clear();
        } else {
            const walk = (nodes: Node[]) => nodes.forEach((n) => { if (n.children.length > 0) { collapsed.add(n.key); } walk(n.children); });
            walk(build());
            // the form itself stays open so the tree is never a single closed line
            for (const r of build()) {
                collapsed.delete(r.key);
            }
        }
        renderOutline();
    });
    tree.addEventListener('keydown', (ev) => {
        const row = (ev.target as HTMLElement).closest<HTMLElement>('.tree-row');
        const i = flat.findIndex((f) => f.node.key === row?.dataset.key);
        if (!row || i < 0) {
            return;
        }
        const { node, depth } = flat[i] as { node: Node; depth: number };
        switch (ev.key) {
            case 'ArrowDown': ev.preventDefault(); focusRow(i + 1); break;
            case 'ArrowUp': ev.preventDefault(); focusRow(i - 1); break;
            case 'Home': ev.preventDefault(); focusRow(0); break;
            case 'End': ev.preventDefault(); focusRow(flat.length - 1); break;
            case 'ArrowRight':
                ev.preventDefault();
                if (node.children.length > 0 && collapsed.has(node.key)) {
                    collapsed.delete(node.key);
                    renderOutline();
                } else {
                    focusRow(i + 1);
                }
                break;
            case 'ArrowLeft':
                ev.preventDefault();
                if (node.children.length > 0 && !collapsed.has(node.key)) {
                    collapsed.add(node.key);
                    renderOutline();
                } else {
                    for (let j = i - 1; j >= 0; j--) {
                        if ((flat[j] as { depth: number }).depth < depth) {
                            focusRow(j);
                            break;
                        }
                    }
                }
                break;
            case 'Enter':
            case ' ':
                ev.preventDefault();
                selectNode(node, ev.shiftKey || ev.ctrlKey);
                break;
            default:
                break;
        }
    });
}
