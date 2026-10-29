import type { SceneObject } from '../protocol';
import { byName, contains, layoutsOf, type Rect } from './geometry';
import { S } from './state';

export function descendantOf(o: SceneObject, names: Set<string>): boolean {
    for (let p: SceneObject | undefined = byName(o.parent); p; p = byName(p.parent)) {
        if (names.has(p.name)) {
            return true;
        }
    }
    return names.has(o.name);
}

/** Where a widget dragged inside a layout would land: next to a sibling, on a given side. */
export interface LayoutSlot {
    parent: string;
    sibling: SceneObject;
    before: boolean;
    axis: 'v' | 'h' | 'cell';
    /** Point (form pixels) to hand to the engine so it picks the same cell. */
    point: { x: number; y: number };
    /** Indicator rectangle (form pixels). */
    line: Rect;
    noop: boolean;
}

export function layoutSlot(from: SceneObject, p: { x: number; y: number }): LayoutSlot | undefined {
    const objs = S.snapshot?.objects ?? [];
    const names = new Set([from.name]);
    const over = objs.filter((o) => contains(o, p.x, p.y) && !descendantOf(o, names)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    let parent: string | undefined;
    if (over?.laidOut) {
        parent = over.parent ?? undefined;
    } else if (over && layoutsOf(over.name).some((l) => !l.parent)) {
        parent = over.name;
    }
    if (!parent) {
        return undefined;
    }
    const layout = layoutsOf(parent).find((l) => !l.parent);
    const sibs = objs.filter((o) => o.parent === parent && o.laidOut && o.name !== from.name);
    if (!layout || sibs.length === 0) {
        return undefined;
    }
    const dist = (o: SceneObject) => {
        const dx = Math.max(o.x - p.x, 0, p.x - (o.x + o.w)), dy = Math.max(o.y - p.y, 0, p.y - (o.y + o.h));
        return Math.hypot(dx, dy);
    };
    const sibling = sibs.find((o) => contains(o, p.x, p.y)) ?? [...sibs].sort((a, b) => dist(a) - dist(b))[0] as SceneObject;
    const kind = layout.kind;
    const axis: LayoutSlot['axis'] = /VBox/.test(kind) ? 'v' : /HBox/.test(kind) ? 'h' : 'cell';
    if (axis === 'cell') {
        return { parent, sibling, before: true, axis, point: { x: Math.round(sibling.x + sibling.w / 2), y: Math.round(sibling.y + sibling.h / 2) }, line: sibling, noop: false };
    }
    const vertical = axis === 'v';
    const mid = vertical ? sibling.y + sibling.h / 2 : sibling.x + sibling.w / 2;
    const before = (vertical ? p.y : p.x) < mid;
    const T = 3;
    const line: Rect = vertical
        ? { x: layout.x, y: (before ? sibling.y : sibling.y + sibling.h) - T / 2, w: layout.w, h: T }
        : { x: (before ? sibling.x : sibling.x + sibling.w) - T / 2, y: layout.y, w: T, h: layout.h };
    const point = vertical
        ? { x: Math.round(sibling.x + sibling.w / 2), y: Math.round(sibling.y + sibling.h * (before ? 0.25 : 0.75)) }
        : { x: Math.round(sibling.x + sibling.w * (before ? 0.25 : 0.75)), y: Math.round(sibling.y + sibling.h / 2) };
    // Dropping where the widget already is changes nothing: its neighbour in that direction is the one we aim at.
    const order = [...sibs, from].sort((a, b) => (vertical ? a.y - b.y : a.x - b.x));
    const at = order.indexOf(from);
    const target = order.indexOf(sibling) + (before ? 0 : 1);
    return { parent, sibling, before, axis, point, line, noop: from.parent === parent && (target === at || target === at + 1) };
}
