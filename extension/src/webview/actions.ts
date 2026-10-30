import type { ActionName } from '../protocol';
import { onlyFormSelected } from './geometry';
import { toast } from './toast';
import { S, send } from './state';

export interface ActionDef {
    action: ActionName;
    icon: string;
    label: string;
    shortcut?: string;
}

/** Engine actions (QDesignerFormWindowManagerInterface). Enabled state comes from the engine. */
export const ACTIONS: Record<ActionName, ActionDef> = {
    delete: { action: 'delete', icon: 'trash', label: 'Delete', shortcut: 'Del' },
    cut: { action: 'cut', icon: 'cut', label: 'Cut', shortcut: 'Ctrl+X' },
    copy: { action: 'copy', icon: 'copy', label: 'Copy', shortcut: 'Ctrl+C' },
    paste: { action: 'paste', icon: 'clippy', label: 'Paste', shortcut: 'Ctrl+V' },
    selectAll: { action: 'selectAll', icon: 'list-selection', label: 'Select All', shortcut: 'Ctrl+A' },
    raise: { action: 'raise', icon: 'arrow-up', label: 'Bring to Front', shortcut: ']' },
    lower: { action: 'lower', icon: 'arrow-down', label: 'Send to Back', shortcut: '[' },
    layoutHorizontal: { action: 'layoutHorizontal', icon: 'split-horizontal', label: 'Lay Out Horizontally', shortcut: 'H' },
    layoutVertical: { action: 'layoutVertical', icon: 'split-vertical', label: 'Lay Out Vertically', shortcut: 'V' },
    layoutGrid: { action: 'layoutGrid', icon: 'table', label: 'Lay Out in a Grid', shortcut: 'G' },
    layoutForm: { action: 'layoutForm', icon: 'list-flat', label: 'Lay Out in a Form Layout', shortcut: 'F' },
    layoutSplitHorizontal: { action: 'layoutSplitHorizontal', icon: 'split-horizontal', label: 'Lay Out Horizontally in a Splitter' },
    layoutSplitVertical: { action: 'layoutSplitVertical', icon: 'split-vertical', label: 'Lay Out Vertically in a Splitter' },
    breakLayout: { action: 'breakLayout', icon: 'debug-disconnect', label: 'Break Layout', shortcut: 'B' },
    adjustSize: { action: 'adjustSize', icon: 'screen-full', label: 'Adjust Size', shortcut: 'J' },
    simplifyLayout: { action: 'simplifyLayout', icon: 'wand', label: 'Simplify Layout' },
};

export function isEnabled(a: ActionName): boolean {
    const s = S.snapshot;
    if (!s || !s.actions[a]) {
        return false;
    }
    // Deleting the form itself is never what the user means.
    return !(a === 'delete' && onlyFormSelected());
}

const coached = new Set<ActionName>();

/** A mouse click on something that has a key: say the key once, so the mouse is needed less each time. */
function coach(a: ActionName): void {
    const d = ACTIONS[a];
    if (d.shortcut && !coached.has(a)) {
        coached.add(a);
        toast(`Tip: press ${d.shortcut} for “${d.label}”`, { ms: 2600 });
    }
}

export function run(a: ActionName, fromKeyboard = false): void {
    if (!isEnabled(a)) {
        return;
    }
    if (!fromKeyboard) {
        coach(a);
    }
    const count = S.snapshot?.selection.length ?? 0;
    send({ type: 'action', action: a });
    if (a === 'delete' || a === 'cut') {
        toast(`${a === 'cut' ? 'Cut' : 'Deleted'} ${count > 1 ? `${count} widgets` : (S.snapshot?.selection[0] ?? 'widget')}`, { action: { label: 'Undo', run: () => send({ type: 'undo' }) } });
    }
}

export function title(a: ActionName): string {
    const d = ACTIONS[a];
    return d.shortcut ? `${d.label} (${d.shortcut})` : d.label;
}

/** Copy then paste: the engine pastes next to the original, inside the same container. */
export function duplicate(): void {
    if (isEnabled('copy')) {
        send({ type: 'action', action: 'copy' });
        send({ type: 'action', action: 'paste' });
    }
}
