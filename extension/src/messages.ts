import type { ActionName, WebviewToHost } from './protocol';

const ACTIONS: readonly string[] = ['cut', 'copy', 'paste', 'delete', 'selectAll', 'lower', 'raise', 'layoutHorizontal',
    'layoutVertical', 'layoutSplitHorizontal', 'layoutSplitVertical', 'layoutGrid', 'layoutForm', 'breakLayout', 'adjustSize', 'simplifyLayout'];

function isItem(v: unknown): boolean {
    if (typeof v !== 'object' || v === null) {
        return false;
    }
    const o = v as Record<string, unknown>;
    return typeof o.name === 'string' && Array.isArray(o.rect) && o.rect.length === 4 && o.rect.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isStringArray(v: unknown): v is string[] {
    return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** The webview is our own page, but its messages are still validated at the boundary. */
const side = (m: Record<string, unknown>): { side?: 'before' | 'after' } => (m.side === 'before' || m.side === 'after' ? { side: m.side } : {});

export function parseWebviewMessage(raw: unknown): WebviewToHost | undefined {
    if (typeof raw !== 'object' || raw === null) {
        return undefined;
    }
    const m = raw as Record<string, unknown>;
    switch (m.type) {
        case 'ready':
            return { type: 'ready' };
        case 'findInCode':
            return typeof m.query === 'string' && m.query.length > 0 && m.query.length <= 300 ? { type: 'findInCode', query: m.query } : undefined;
        case 'copyText':
            return typeof m.text === 'string' && m.text.length <= 20000 ? { type: 'copyText', text: m.text } : undefined;
        case 'gesture':
            return (m.phase === 'begin' || m.phase === 'end') && typeof m.label === 'string' && m.label.length <= 80 ? { type: 'gesture', phase: m.phase, label: m.label } : undefined;
        case 'cancelGesture':
            return { type: 'cancelGesture' };
        case 'setGeometries':
            return Array.isArray(m.items) && m.items.length <= 1000 && m.items.every(isItem) ? { type: 'setGeometries', items: m.items as { name: string; rect: number[] }[] } : undefined;
        case 'pickResource':
            return { type: 'pickResource' };
        case 'removeResource':
            return typeof m.path === 'string' && m.path.length > 0 && m.path.length < 1000 ? { type: 'removeResource', path: m.path } : undefined;
        case 'makeSubmenu':
            return typeof m.menu === 'string' && Number.isInteger(m.index) && (m.index as number) >= 0 ? { type: 'makeSubmenu', menu: m.menu, index: m.index as number } : undefined;
        case 'addMenu':
            return typeof m.title === 'string' && m.title.trim() !== '' && m.title.length < 200 ? { type: 'addMenu', title: m.title } : undefined;
        case 'addMenuEntry':
            return typeof m.menu === 'string' && (m.separator === true || (typeof m.text === 'string' && m.text.trim() !== '' && m.text.length < 200))
                ? { type: 'addMenuEntry', menu: m.menu, ...(m.separator === true ? { separator: true } : { text: m.text as string }) } : undefined;
        case 'addAction':
            return typeof m.text === 'string' && m.text.trim() !== '' && m.text.length < 200 && (m.shortcut === undefined || (typeof m.shortcut === 'string' && m.shortcut.length < 100))
                ? { type: 'addAction', text: m.text, ...(m.checkable === true ? { checkable: true } : {}), ...(typeof m.shortcut === 'string' && m.shortcut !== '' ? { shortcut: m.shortcut } : {}) } : undefined;
        case 'removeAction':
            return typeof m.name === 'string' && m.name.length > 0 && m.name.length < 200 ? { type: 'removeAction', name: m.name } : undefined;
        case 'removeMenuEntry':
            return typeof m.menu === 'string' && (m.index === undefined || Number.isInteger(m.index)) ? { type: 'removeMenuEntry', menu: m.menu, ...(m.index !== undefined ? { index: m.index as number } : {}) } : undefined;
        case 'taskAction':
            if (typeof m.name !== 'string') {
                return undefined;
            }
            if (Array.isArray(m.path)) {
                return m.path.length > 0 && m.path.length <= 6 && m.path.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 500) ? { type: 'taskAction', name: m.name, path: m.path as number[] } : undefined;
            }
            return typeof m.text === 'string' && m.text.length > 0 && m.text.length < 80 ? { type: 'taskAction', name: m.name, text: m.text } : undefined;
        case 'setContents': {
            const c = m.contents as Record<string, unknown> | undefined;
            const strs = (a: unknown) => Array.isArray(a) && a.length <= 5000 && a.every((x) => typeof x === 'string');
            const tree = (a: unknown, depth: number): boolean => Array.isArray(a) && a.length <= 5000 && depth < 32 && a.every((i) => !!i && typeof i === 'object' && strs((i as { cells?: unknown }).cells) && tree((i as { children?: unknown }).children, depth + 1));
            const ok = typeof m.name === 'string' && !!c && strs(c.columns)
                && ((c.kind === 'table' && strs(c.rows) && Array.isArray(c.cells) && c.cells.length <= 5000 && c.cells.every(strs)) || (c.kind === 'tree' && tree(c.items, 0)));
            return ok ? { type: 'setContents', name: m.name as string, contents: c as never } : undefined;
        }
        case 'setItems':
            return typeof m.name === 'string' && Array.isArray(m.items) && m.items.length <= 2000 && m.items.every((i) => typeof i === 'string') ? { type: 'setItems', name: m.name, items: m.items as string[] } : undefined;
        case 'moveWidget':
            return typeof m.name === 'string' && Number.isFinite(m.x) && Number.isFinite(m.y) ? { type: 'moveWidget', name: m.name, x: m.x as number, y: m.y as number, ...side(m), ...(Number.isFinite(m.grabX) ? { grabX: m.grabX as number } : {}), ...(Number.isFinite(m.grabY) ? { grabY: m.grabY as number } : {}) } : undefined;
        case 'reparent':
            return typeof m.parent === 'string' && Array.isArray(m.items) && m.items.length <= 1000 && m.items.every(isItem) ? { type: 'reparent', parent: m.parent, items: m.items as { name: string; rect: number[] }[] } : undefined;
        case 'previewStop':
            return { type: 'previewStop' };
        case 'previewEvent': {
            const kinds = ['press', 'release', 'dblclick', 'move', 'wheel', 'keydown', 'keyup'];
            const num = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isFinite(v));
            if (typeof m.kind !== 'string' || !kinds.includes(m.kind) || !num(m.x) || !num(m.y) || !num(m.button) || !num(m.mods) || !num(m.dx) || !num(m.dy)
                || (m.key !== undefined && (typeof m.key !== 'string' || m.key.length > 20))) {
                return undefined;
            }
            return { type: 'previewEvent', kind: m.kind as never, x: m.x as number | undefined, y: m.y as number | undefined, button: m.button as number | undefined,
                mods: m.mods as number | undefined, dx: m.dx as number | undefined, dy: m.dy as number | undefined, key: m.key as string | undefined };
        }
        case 'preview':
            return typeof m.style === 'string' && m.style.length <= 60 && typeof m.dark === 'boolean' && Number.isFinite(m.scale) ? { type: 'preview', style: m.style, dark: m.dark, scale: Math.min(4, Math.max(1, m.scale as number)) } : undefined;
        case 'pageOp':
            return typeof m.name === 'string' && (m.op === 'add' || m.op === 'addAfter' || m.op === 'remove') ? { type: 'pageOp', name: m.name, op: m.op } : undefined;
        case 'setCurrentPage':
            return typeof m.name === 'string' && Number.isInteger(m.index) ? { type: 'setCurrentPage', name: m.name, index: m.index as number } : undefined;
        case 'setTabOrder':
            return isStringArray(m.order) && m.order.length <= 5000 ? { type: 'setTabOrder', order: m.order } : undefined;
        case 'promote':
            return isStringArray(m.names) && typeof m.className === 'string' && typeof m.include === 'string' && m.className.length <= 120 && m.include.length <= 300
                ? { type: 'promote', names: m.names, className: m.className, include: m.include } : undefined;
        case 'demote':
            return typeof m.name === 'string' ? { type: 'demote', name: m.name } : undefined;
        case 'setFormInfo':
            return typeof m.info === 'object' && m.info !== null ? { type: 'setFormInfo', info: m.info as Record<string, never> } : undefined;
        case 'addDynamicProperty':
            return typeof m.name === 'string' && typeof m.property === 'string' && typeof m.kind === 'string' ? { type: 'addDynamicProperty', name: m.name, property: m.property, kind: m.kind, value: m.value } : undefined;
        case 'removeDynamicProperty':
            return typeof m.name === 'string' && typeof m.property === 'string' ? { type: 'removeDynamicProperty', name: m.name, property: m.property } : undefined;
        case 'connect':
        case 'disconnect':
            return typeof m.sender === 'string' && typeof m.signal === 'string' && typeof m.receiver === 'string' && typeof m.slot === 'string'
                ? { type: m.type, sender: m.sender, signal: m.signal, receiver: m.receiver, slot: m.slot } : undefined;
        case 'describe':
            return typeof m.name === 'string' ? { type: 'describe', name: m.name } : undefined;
        case 'pickFile':
            return typeof m.name === 'string' && typeof m.property === 'string' ? { type: 'pickFile', name: m.name, property: m.property } : undefined;
        case 'inspect':
            return m.name === null || typeof m.name === 'string' ? { type: 'inspect', name: m.name as string | null } : undefined;
        case 'undo':
        case 'redo':
            if (m.steps === undefined) {
                return { type: m.type };
            }
            return Number.isInteger(m.steps) && (m.steps as number) >= 1 && (m.steps as number) <= 500 ? { type: m.type, steps: m.steps as number } : undefined;
        case 'history':
            return { type: 'history' };
        case 'restartBackend':
            return { type: 'restartBackend' };
        case 'want':
            return typeof m.tabOrder === 'boolean' && typeof m.formInfo === 'boolean' ? { type: 'want', tabOrder: m.tabOrder, formInfo: m.formInfo } : undefined;
        case 'view':
            return typeof m.scale === 'number' && Number.isFinite(m.scale) ? { type: 'view', scale: Math.min(4, Math.max(1, m.scale)) } : undefined;
        case 'hitSelect':
            return Number.isFinite(m.x) && Number.isFinite(m.y) ? { type: 'hitSelect', x: m.x as number, y: m.y as number } : undefined;
        case 'selectNames':
            return isStringArray(m.names) && m.names.length <= 1000 ? { type: 'selectNames', names: m.names } : undefined;
        case 'setProperty':
            if (typeof m.name !== 'string' || typeof m.property !== 'string') {
                return undefined;
            }
            if (m.names !== undefined && !(isStringArray(m.names) && m.names.length <= 1000)) {
                return undefined;
            }
            return { type: 'setProperty', name: m.name, ...(m.names ? { names: m.names as string[] } : {}), property: m.property, value: m.value };
        case 'resetProperty':
            return typeof m.name === 'string' && typeof m.property === 'string' ? { type: 'resetProperty', name: m.name, property: m.property } : undefined;
        case 'addWidget':
            return Number.isInteger(m.category) && Number.isInteger(m.index) && Number.isFinite(m.x) && Number.isFinite(m.y)
                ? { type: 'addWidget', category: m.category as number, index: m.index as number, x: m.x as number, y: m.y as number, ...side(m) }
                : undefined;
        case 'action':
            return typeof m.action === 'string' && ACTIONS.includes(m.action) ? { type: 'action', action: m.action as ActionName } : undefined;
        default:
            return undefined;
    }
}
