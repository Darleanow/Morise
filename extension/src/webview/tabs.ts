import { editTabTitle } from './inplace';
import { S, send } from './state';

/**
 * Tab headers are drawn by Qt in the form image: a click on one switches the page, a double-click renames it.
 * The tab positions come with the container info of the selected tab widget, so a click on a tab widget that is
 * not selected yet is remembered and resolved when its info arrives.
 */
interface Pending { name: string; x: number; y: number; edit: boolean; switched: number }

let pending: Pending | null = null;

export function requestTab(name: string, at: { x: number; y: number }, edit: boolean): void {
    pending = { name, x: at.x, y: at.y, edit, switched: -1 };
    runPendingTab();
}

/** Called whenever new state arrived. */
export function runPendingTab(): void {
    const p = pending;
    const c = S.container;
    if (!p || S.propertiesFor !== p.name || !c?.tabs) {
        return;
    }
    const index = c.tabs.findIndex((r) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h);
    if (index < 0) {
        pending = null;
        return;
    }
    if (c.current !== index) {
        if (p.switched !== index) {
            p.switched = index;
            send({ type: 'setCurrentPage', name: p.name, index });
        }
        return; // the edit waits for the page to be current
    }
    pending = null;
    if (p.edit) {
        editTabTitle(c.tabs[index] as { x: number; y: number; w: number; h: number }, c.titleProperty);
    }
}
