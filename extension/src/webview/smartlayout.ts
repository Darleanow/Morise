import type { SceneObject } from '../protocol';
import * as actions from './actions';
import { byName, primarySelection } from './geometry';
import { S } from './state';
import { toast } from './toast';

export type LayoutAction = 'layoutHorizontal' | 'layoutVertical' | 'layoutGrid' | 'layoutForm';
export interface Suggestion { action: LayoutAction; label: string; reason: string }
interface Box { x: number; y: number; w: number; h: number; cls: string }

/** Groups boxes into visual rows: a box joins the row whose vertical span holds its centre. */
export function rowsOf(boxes: Box[]): Box[][] {
    const rows: { top: number; bottom: number; items: Box[] }[] = [];
    for (const b of [...boxes].sort((p, q) => p.y + p.h / 2 - (q.y + q.h / 2))) {
        const mid = b.y + b.h / 2;
        const row = rows.find((r) => mid >= r.top && mid <= r.bottom);
        if (row) {
            row.items.push(b);
            row.top = Math.min(row.top, b.y);
            row.bottom = Math.max(row.bottom, b.y + b.h);
        } else {
            rows.push({ top: b.y, bottom: b.y + b.h, items: [b] });
        }
    }
    return rows.map((r) => r.items.sort((p, q) => p.x - q.x));
}

/** The layout a person would draw by hand for these boxes: a row, a column, label/field pairs or a table. */
export function suggestLayout(boxes: Box[]): Suggestion | undefined {
    if (boxes.length < 2) {
        return undefined;
    }
    const rows = rowsOf(boxes);
    if (rows.length === 1) {
        return { action: 'layoutHorizontal', label: 'horizontally', reason: 'all the widgets sit on one line' };
    }
    if (rows.every((r) => r.length === 1)) {
        return { action: 'layoutVertical', label: 'vertically', reason: 'the widgets are stacked in one column' };
    }
    if (rows.every((r) => r.length === 2 && r[0]?.cls.endsWith('Label') && !r[1]?.cls.endsWith('Label'))) {
        return { action: 'layoutForm', label: 'as a form', reason: 'every row is a label followed by its field' };
    }
    return { action: 'layoutGrid', label: 'in a grid', reason: 'the widgets form rows and columns' };
}

/** What a layout would apply to: the selected container's free children, or several selected siblings. */
export function layoutTargets(): SceneObject[] {
    const s = S.snapshot;
    if (!s) {
        return [];
    }
    if (s.selection.length > 1) {
        const picked = s.selection.map((n) => byName(n)).filter((o): o is SceneObject => !!o && o.parent !== null && !o.laidOut);
        return picked.filter((o) => o.parent === picked[0]?.parent);
    }
    const sel = primarySelection();
    return sel ? s.objects.filter((o) => o.parent === sel.name && !o.laidOut && !o.part) : [];
}

export function currentSuggestion(): Suggestion | undefined {
    const targets = layoutTargets();
    const found = suggestLayout(targets.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h, cls: o.class })));
    return found && actions.isEnabled(found.action) ? found : undefined;
}

export function runSmartLayout(): void {
    const found = currentSuggestion();
    if (!found) {
        toast('Select a container with free widgets, or several widgets, to lay them out');
        return;
    }
    actions.run(found.action);
    toast(`Laid out ${found.label}: ${found.reason}`);
}
