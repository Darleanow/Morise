import type { SceneLayout, SceneObject } from '../protocol';
import { S } from './state';

export interface Rect { x: number; y: number; w: number; h: number }

export function contains(o: Rect, x: number, y: number): boolean {
    return x >= o.x && y >= o.y && x < o.x + o.w && y < o.y + o.h;
}

export function byName(name: string | null | undefined): SceneObject | undefined {
    return name ? S.snapshot?.objects.find((o) => o.name === name) : undefined;
}

export function rootObject(): SceneObject | undefined {
    return S.snapshot?.objects.find((o) => o.parent === null);
}

/** Smallest managed widget under the point (the engine confirms on click via hitTest). */
export function objectAt(x: number, y: number): SceneObject | undefined {
    let best: SceneObject | undefined;
    for (const o of S.snapshot?.objects ?? []) {
        if (contains(o, x, y) && (!best || o.w * o.h <= best.w * best.h)) {
            best = o;
        }
    }
    return best;
}

/** The single selected object, if exactly one is selected. */
export function selectedObject(): SceneObject | undefined {
    const s = S.snapshot;
    return s && s.selection.length === 1 ? byName(s.selection[0]) : undefined;
}

export function primarySelection(): SceneObject | undefined {
    return byName(S.snapshot?.selection[0]);
}

export function layoutsOf(name: string): SceneLayout[] {
    return S.snapshot?.layouts.filter((l) => l.owner === name) ?? [];
}

/** Free widgets and the form can be given a geometry; layout-managed widgets cannot. */
export function isFree(o: SceneObject | undefined): o is SceneObject {
    return !!o && o.parent !== null && !o.laidOut;
}

export function canResize(o: SceneObject | undefined): o is SceneObject {
    return !!o && (o.parent === null || !o.laidOut);
}

export function onlyFormSelected(): boolean {
    const s = S.snapshot;
    return !s || s.selection.length === 0 || (s.selection.length === 1 && byName(s.selection[0])?.parent === null);
}

export function snap(v: number, grid: number): number {
    return grid > 1 ? Math.round(v / grid) * grid : v;
}

/** Container classes the engine can drop into. Indicative only: the engine makes the final decision. */
const CONTAINERS = new Set(['QDesignerWidget', 'QWidget', 'QGroupBox', 'QFrame', 'QTabWidget', 'QStackedWidget', 'QToolBox', 'QScrollArea', 'QMainWindow', 'QDockWidget', 'QMdiArea', 'QSplitter', 'QDialog', 'QDesignerDockWidget']);

export function isContainer(o: SceneObject | undefined): boolean {
    return !!o && CONTAINERS.has(o.class);
}

export function containerAt(x: number, y: number): SceneObject | undefined {
    let best: SceneObject | undefined;
    for (const o of S.snapshot?.objects ?? []) {
        if (isContainer(o) && contains(o, x, y) && (!best || o.w * o.h <= best.w * best.h)) {
            best = o;
        }
    }
    return best ?? rootObject();
}
