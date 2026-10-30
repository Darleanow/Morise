import { byName, isContainer, layoutsOf, rootObject } from './geometry';
import { S, send } from './state';

export interface NextStep {
    text: string;
    /** A one-click way to do it. */
    fix?: { label: string; run: () => void };
    /** Something is wrong or missing (shown in the warning colour), as opposed to a plain pointer. */
    warn?: boolean;
}

function layOut(owner: string, action: 'layoutGrid' | 'layoutVertical'): void {
    send({ type: 'selectNames', names: [owner] });
    send({ type: 'action', action });
}

/**
 * The most useful thing to do next, from what is selected: it nudges towards the layout-first way of
 * building a form (the one that survives resizing, translations and other styles) and names the key for it.
 */
export function nextStep(): NextStep | null {
    const s = S.snapshot;
    const root = rootObject();
    if (!s || !root) {
        return null;
    }
    const children = (name: string) => s.objects.filter((o) => o.parent === name);
    const sel = s.selection.map((n) => byName(n)).filter((o) => o !== undefined);
    if (sel.length > 1) {
        const free = sel.filter((o) => !o.laidOut);
        return free.length > 1
            ? { text: `${free.length} widgets outside a layout: press H, V or G to lay them out together` }
            : { text: 'Align and distribute from the toolbar; Shift+arrows resize them all' };
    }
    const one = sel[0];
    if (one && one.parent !== null && isContainer(one) && layoutsOf(one.name).length === 0 && children(one.name).length > 1) {
        return { text: `${one.name} has no layout: its children will not follow when it resizes`, warn: true, fix: { label: 'Lay out in a grid (G)', run: () => layOut(one.name, 'layoutGrid') } };
    }
    if (layoutsOf(root.name).length === 0 && children(root.name).length > 1) {
        return { text: 'The form has no layout: it will not follow a resize or a translation', warn: true, fix: { label: 'Lay out in a grid (G)', run: () => layOut(root.name, 'layoutGrid') } };
    }
    if (one && one.parent !== null) {
        return { text: one.laidOut ? 'Enter edits the text · F2 renames · F4 connects a signal · drag to move it in the layout' : 'Enter edits the text · F2 renames · arrows nudge · Alt+arrows by 1 px' };
    }
    return { text: '/ adds a widget by name · > runs any command · ? lists every shortcut' };
}
