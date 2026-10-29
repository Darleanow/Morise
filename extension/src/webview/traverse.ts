import { byName, primarySelection } from './geometry';
import { S, send } from './state';

/** Moves the selection to the next or previous widget in the form's order (Tab / Shift+Tab). */
export function selectSibling(direction: 1 | -1): void {
    const all = (S.snapshot?.objects ?? []).filter((o) => o.parent !== null);
    if (all.length === 0) {
        return;
    }
    const cur = primarySelection();
    const i = cur ? all.findIndex((o) => o.name === cur.name) : -1;
    const next = all[(i + direction + all.length) % all.length];
    if (next) {
        send({ type: 'selectNames', names: [next.name] });
    }
}

export function selectParent(): void {
    const parent = byName(primarySelection()?.parent);
    if (parent) {
        send({ type: 'selectNames', names: [parent.name] });
    }
}

export function selectFirstChild(): void {
    const cur = primarySelection();
    const child = cur ? S.snapshot?.objects.find((o) => o.parent === cur.name) : undefined;
    if (child) {
        send({ type: 'selectNames', names: [child.name] });
    }
}
