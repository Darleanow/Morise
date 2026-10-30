import type { SceneObject } from '../protocol';
import * as actions from './actions';
import { ALIGNMENTS, canAlign, runAlignment } from './align';
import { connectionArrows, tabOrderBadges } from './arrows';
import { button, dims, el, icon } from './dom';
import { byName, canResize, type Rect } from './geometry';
import { hooks } from './hooks';
import { prefs, S, send } from './state';
import { attach, classGlyph, resetTags, tag } from './tags';
import { form, hint, overlay, placed, zoom } from './view';

import { gestureActive } from './canvas';

// ---- overlay indicators ----------------------------------------------------------------

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const CURSORS: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
export const GRAB = 6; // screen px around an edge that grab it

export function handlePoints(o: SceneObject): [Handle, number, number][] {
    const { x, y, w, h } = o;
    if (o.parent === null) {
        return [['e', x + w, y + h / 2], ['s', x + w / 2, y + h], ['se', x + w, y + h]];
    }
    return [['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y], ['e', x + w, y + h / 2], ['se', x + w, y + h], ['s', x + w / 2, y + h], ['sw', x, y + h], ['w', x, y + h / 2]];
}

/** Edge bands and corners both grab, so a handle is never hard to hit. The form can only grow from its right and bottom. */
export function handleAt(o: SceneObject, p: { x: number; y: number }): Handle | null {
    const z = zoom();
    const t = GRAB / z;
    const inX = p.x >= o.x - t && p.x <= o.x + o.w + t;
    const inY = p.y >= o.y - t && p.y <= o.y + o.h + t;
    const L = inY && Math.abs(p.x - o.x) <= t;
    const R = inY && Math.abs(p.x - (o.x + o.w)) <= t;
    const T = inX && Math.abs(p.y - o.y) <= t;
    const B = inX && Math.abs(p.y - (o.y + o.h)) <= t;
    if (o.parent === null) {
        return R && B ? 'se' : R ? 'e' : B ? 's' : null;
    }
    if (T && L) return 'nw';
    if (T && R) return 'ne';
    if (B && L) return 'sw';
    if (B && R) return 'se';
    if (T) return 'n';
    if (B) return 's';
    if (L) return 'w';
    if (R) return 'e';
    return null;
}

function pageControls(o: SceneObject): HTMLElement[] {
    const c = S.container;
    if (!c || c.pages.length === 0) {
        return [];
    }
    const go = (i: number) => send({ type: 'setCurrentPage', name: o.name, index: (i + c.pages.length) % c.pages.length });
    return [
        el('span', { className: 'pill-sep' }),
        button('Previous page', icon('chevron-left'), () => go(c.current - 1), 'pill-btn'),
        el('span', { className: 'dim pages', title: c.pages[c.current] ?? '' }, `${c.current + 1}/${c.pages.length}`),
        button('Next page', icon('chevron-right'), () => go(c.current + 1), 'pill-btn'),
        button('Add a page after this one', icon('add'), () => send({ type: 'pageOp', name: o.name, op: 'addAfter' }), 'pill-btn'),
        button('Delete this page', icon('remove'), () => send({ type: 'pageOp', name: o.name, op: 'remove' }), 'pill-btn'),
    ];
}

function pill(first: SceneObject): HTMLElement {
    const z = zoom();
    const sel = S.snapshot?.selection ?? [];
    const multi = sel.length > 1;
    const parts: (Node | string)[] = multi
        ? [icon('multiple-windows'), el('b', {}, `${sel.length} widgets`)]
        : [classGlyph(first), el('b', {}, first.name), el('span', { className: 'dim' }, dims(first.w, first.h))];
    if (!multi && first.laidOut) {
        const lock = icon('lock');
        lock.title = 'Position and size are managed by a layout';
        parts.push(lock);
    }
    const buttons: HTMLElement[] = [];
    if (multi) {
        for (const def of ALIGNMENTS.slice(0, 6)) {
            if (canAlign(def)) {
                buttons.push(button(def.label, icon(def.icon), () => runAlignment(def.op), 'pill-btn'));
            }
        }
        if (buttons.length > 0) {
            buttons.push(el('span', { className: 'pill-sep' }));
        }
        for (const a of ['layoutVertical', 'layoutHorizontal', 'layoutGrid', 'delete'] as const) {
            if (actions.isEnabled(a)) {
                buttons.push(button(actions.title(a), icon(actions.ACTIONS[a].icon), () => actions.run(a), 'pill-btn'));
            }
        }
    } else {
        const quick = first.parent === null
            ? (['layoutVertical', 'layoutHorizontal', 'layoutGrid', 'breakLayout'] as const)
            : (['delete', 'layoutVertical', 'layoutHorizontal', 'layoutGrid', 'breakLayout', 'raise', 'lower'] as const);
        if (first.parent !== null && hooks.editableText()) {
            buttons.push(button('Edit text (Enter)', icon('edit'), () => hooks.editText(), 'pill-btn'));
        }
        for (const a of quick) {
            if (actions.isEnabled(a)) {
                buttons.push(button(actions.title(a), icon(actions.ACTIONS[a].icon), () => actions.run(a), 'pill-btn'));
            }
        }
        buttons.push(...pageControls(first));
    }
    buttons.push(button('More actions (right-click)', icon('ellipsis'), () => {
        const r = form.getBoundingClientRect();
        hooks.openContextMenu(r.left + (first.x + first.w) * z, r.top + (first.y + first.h) * z);
    }, 'pill-btn'));
    const p = el('div', { className: 'pill' }, ...parts, el('span', { className: 'pill-sep' }), ...buttons);
    return attach(p, bounds(multi ? sel : [first.name]) ?? first, 170 + (multi ? 40 : first.name.length * 7) + buttons.length * 24, 28, !multi && first.parent === null ? 'form' : 'pill');
}

export function bounds(names: string[]): Rect | undefined {
    const os = names.map((n) => byName(n)).filter((o): o is SceneObject => !!o);
    if (os.length === 0) {
        return undefined;
    }
    const x1 = Math.min(...os.map((o) => o.x)), y1 = Math.min(...os.map((o) => o.y));
    const x2 = Math.max(...os.map((o) => o.x + o.w)), y2 = Math.max(...os.map((o) => o.y + o.h));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}




export function renderOverlay(): void {
    resetTags();
    const s = S.snapshot;
    if (!s) {
        overlay.replaceChildren();
        return;
    }
    const z = zoom();
    const frag = document.createDocumentFragment();
    const selected = new Set(s.selection);
    const emphasised = new Set<string>([...selected, ...(S.hovered ? [S.hovered] : [])]);
    const dragging = gestureActive();

    if (prefs.showLayouts) {
        for (const l of s.layouts) {
            const focus = l.name === S.focusedLayout || emphasised.has(l.owner);
            frag.append(placed(el('div', { className: `ov layout${focus ? ' focus' : ''}${l.parent ? ' nested' : ''}` }), l));
        }
    }

    const arrows = connectionArrows();
    if (arrows) {
        frag.append(arrows as unknown as Node);
    }

    const first = byName(s.selection[0]);
    if (first && S.mode === 'select') {
        for (const name of s.selection) {
            const o = byName(name);
            if (o && o.parent !== null) {
                frag.append(placed(el('div', { className: `ov selected${name === s.selection[0] && s.selection.length > 1 ? ' key' : ''}` }), o));
            }
        }
        if (canResize(first) && s.selection.length === 1) {
            for (const [name, hx, hy] of handlePoints(first)) {
                const hd = el('div', { className: `handle ${name}` });
                hd.style.left = `${hx * z - 4}px`;
                hd.style.top = `${hy * z - 4}px`;
                frag.append(hd);
            }
        }
        if (!dragging) {
            frag.append(pill(first));
        }
    }

    if (prefs.showLayouts) {
        for (const l of s.layouts) {
            if (l.name === S.focusedLayout || emphasised.has(l.owner)) {
                frag.append(tag(l, 'layout', icon('layout'), l.kind, el('span', { className: 'dim' }, l.name)));
            }
        }
    }

    const hover = byName(S.hovered);
    if (hover && !selected.has(hover.name) && !dragging) {
        frag.append(placed(el('div', { className: S.mode === 'connect' ? 'ov hover connect' : 'ov hover' }), hover));
        frag.append(tag(hover, '', hover.name, el('span', { className: 'dim' }, hover.class)));
    }
    tabOrderBadges(frag);
    if (s.objects.length <= 1 && s.layouts.length === 0 && S.mode === 'select') {
        frag.append(el('div', { className: 'empty-hint' }, icon('add'), el('b', {}, 'This form is empty'),
            el('span', {}, 'Drag a widget from the list, press / to search for one, or double-click here.')));
    }
    overlay.replaceChildren(frag);
}
