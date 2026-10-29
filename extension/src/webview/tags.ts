import { el, icon } from './dom';
import { isContainer, type Rect } from './geometry';
import { classIcons, prefs, S } from './state';
import { zoom } from './view';

/** Tag rectangles already placed in the current pass (screen px), used to avoid overlaps. */
export const placedTags: Rect[] = [];

export function resetTags(): void {
    placedTags.length = 0;
}

export function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Positions a floating label next to a rectangle. Tries above, then inside the top edge (for big
 * rectangles), then below, and takes the first spot that does not collide with an earlier label.
 */
export function attach(node: HTMLElement, r: Rect, width: number, height = 22, mode: 'tag' | 'pill' | 'form' = 'tag'): HTMLElement {
    const z = zoom();
    const margin = -height - 6 - (prefs.rulers ? 20 : 0); // the workspace around the form, above its top edge (and its ruler)
    if (mode === 'form') {
        // The form itself has no room above it inside the form: sit in the workspace margin, never over the widgets.
        const left = Math.max(0, r.x * z);
        placedTags.push({ x: left, y: margin, w: width, h: height });
        node.style.left = `${left}px`;
        node.style.top = `${margin}px`;
        return node;
    }
    const big = r.h * z > 70 && r.w * z > 140;
    const above = r.y * z - height - 4;
    const inside = r.y * z + 4;
    const below = (r.y + r.h) * z + 4;
    // A floating bar must not hide the widget's own header: next to the top edge it goes into the margin instead.
    const candidates = mode === 'pill'
        ? [above, ...(r.y * z < 70 ? [margin] : []), below, margin, inside]
        : big ? [above, inside, below] : [above, below, inside, below + height + 2];
    let top = candidates[0] as number;
    const left = Math.max(0, r.x * z);
    // The floating bar also keeps off the other widgets: it must never block a click on a neighbour.
    const sel = new Set(S.snapshot?.selection ?? []);
    const obstacles: Rect[] = mode === 'pill'
        ? (S.snapshot?.objects ?? []).filter((o) => o.parent !== null && !sel.has(o.name) && !isContainer(o)).map((o) => ({ x: o.x * z, y: o.y * z, w: o.w * z, h: o.h * z }))
        : [];
    const free = (c: number) => !placedTags.some((o) => overlaps({ x: left, y: c, w: width, h: height }, o)) && !obstacles.some((o) => overlaps({ x: left, y: c, w: width, h: height }, o));
    const ok = (c: number) => c >= 0 || (mode === 'pill' && c === margin);
    const pick = candidates.find((c) => ok(c) && free(c)) ?? candidates.find((c) => ok(c) && !placedTags.some((o) => overlaps({ x: left, y: c, w: width, h: height }, o)));
    if (pick !== undefined) {
        top = pick;
    }
    top = mode === 'pill' && top === margin ? margin : Math.max(0, top);
    placedTags.push({ x: left, y: top, w: width, h: height });
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    return node;
}

export function tag(r: Rect, className: string, ...content: (Node | string)[]): HTMLElement {
    const t = el('div', { className: `tag ${className}` }, ...content);
    const len = content.reduce<number>((n, c) => n + (typeof c === 'string' ? c.length : (c.textContent?.length ?? 2)), 0);
    return attach(t, r, len * 6.5 + 22, 18);
}

export function classGlyph(o: { class: string; parent?: string | null }): HTMLElement {
    const src = classIcons.get(o.class);
    if (src) {
        const img = el('img', { className: 'wicon', src, alt: '', draggable: false });
        img.draggable = false;
        return img;
    }
    return icon(o.parent === null ? 'window' : 'symbol-field');
}
