import { containerAt, isContainer, byName, layoutsOf, selectedObject, rootObject } from './geometry';
import { rememberWidget, S, send } from './state';

/** Where a widget added without an explicit position goes: inside the selected container, staggered. */
export function defaultPosition(): { x: number; y: number } {
    const sel = selectedObject();
    // A widget a layout owns: the new one goes right after it, in the layout's direction.
    if (sel?.laidOut && sel.parent) {
        const kind = layoutsOf(sel.parent).find((l) => !l.parent)?.kind ?? '';
        return /HBox/.test(kind) ? { x: sel.x + sel.w * 0.75, y: sel.y + sel.h / 2 } : { x: sel.x + sel.w / 2, y: sel.y + sel.h * 0.75 };
    }
    const container = (isContainer(sel) ? sel : byName(sel?.parent)) ?? rootObject();
    if (!container) {
        return { x: 20, y: 20 };
    }
    // First free spot, scanning the container row by row, so a new widget never lands on top of another one.
    const sibs = (S.snapshot?.objects ?? []).filter((o) => o.parent === container.name);
    const W = 90, H = 26, STEP = 12;
    const hits = (x: number, y: number) => sibs.some((o) => x < o.x + o.w && o.x < x + W && y < o.y + o.h && o.y < y + H);
    for (let y = container.y + 16; y + H <= container.y + container.h - 8; y += STEP) {
        for (let x = container.x + 16; x + W <= container.x + container.w - 8; x += STEP) {
            if (!hits(x, y)) {
                return { x, y };
            }
        }
    }
    const step = (sibs.length * 14) % 112;
    return { x: container.x + 16 + step, y: container.y + 16 + step };
}

export function addWidgetAt(category: number, index: number, at?: { x: number; y: number }): void {
    rememberWidget(category, index);
    const p = at ?? defaultPosition();
    send({ type: 'addWidget', category, index, x: Math.round(p.x), y: Math.round(p.y) });
}

export function containerName(at: { x: number; y: number }): string | undefined {
    return containerAt(at.x, at.y)?.name;
}
