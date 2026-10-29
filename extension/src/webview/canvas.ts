import type { SceneObject } from '../protocol';
import * as actions from './actions';
import { ALIGNMENTS, alignable, canAlign, runAlignment } from './align';
import { connectionArrows, SVG, tabOrderBadges } from './arrows';
import { button, dims, el, icon } from './dom';
import { byName, canResize, containerAt, contains, isContainer, isFree, layoutsOf, objectAt, rootObject, selectedObject, snap, type Rect } from './geometry';
import { guideNodes, measureNodes, snapToSiblings } from './guides';
import { hooks } from './hooks';
import { descendantOf, layoutSlot, type LayoutSlot } from './layoutslot';
import { classIcons, prefs, S, savePrefs, send } from './state';
import { requestTab } from './tabs';
import { attach, classGlyph, placedTags, resetTags, tag } from './tags';
import { box, form, geomLabel, ghost, hint, overlay, placed, stage, toImage, viewport, zoom, fitZoom, layoutStage, onZoomChange, requestScale, resetRender, setZoom, stepZoom } from './view';

// Re-exported: the rest of the page imports the stage helpers from here.
export { classGlyph, fitZoom, onZoomChange, requestScale, resetRender, setZoom, stepZoom, toImage };

// ---- overlay indicators ----------------------------------------------------------------

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const CURSORS: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
const GRAB = 6; // screen px around an edge that grab it

function handlePoints(o: SceneObject): [Handle, number, number][] {
    const { x, y, w, h } = o;
    if (o.parent === null) {
        return [['e', x + w, y + h / 2], ['s', x + w / 2, y + h], ['se', x + w, y + h]];
    }
    return [['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y], ['e', x + w, y + h / 2], ['se', x + w, y + h], ['s', x + w / 2, y + h], ['sw', x, y + h], ['w', x, y + h / 2]];
}

/** Edge bands and corners both grab, so a handle is never hard to hit. The form can only grow from its right and bottom. */
function handleAt(o: SceneObject, p: { x: number; y: number }): Handle | null {
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

function bounds(names: string[]): Rect | undefined {
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

// The overlay follows the zoom first; later listeners (the status bar, the inspector) see it already redrawn.
onZoomChange(renderOverlay);

// ---- panning: Space+drag or the middle button ---------------------------------------------

let spaceDown = false;
let pan: { x: number; y: number; left: number; top: number } | null = null;

export function setSpaceDown(down: boolean): void {
    spaceDown = down;
    viewport.classList.toggle('pan-ready', down);
}

viewport.addEventListener('auxclick', (ev) => ev.preventDefault());

// ---- gestures: select, band, move, resize, connect (live) ---------------------------------

interface Origin { obj: SceneObject; rect: Rect }
interface Common { clientX: number; clientY: number; startX: number; startY: number }

type Gesture =
    | (Common & { kind: 'pending'; additive: boolean; moved?: false })
    | (Common & { kind: 'band'; additive: boolean; base: string[]; container: SceneObject | undefined; rect: Rect; moved: boolean })
    | (Common & { kind: 'move'; targets: Origin[]; primary: Origin; delta: { dx: number; dy: number }; moved: boolean; sent: boolean; drop: SceneObject | undefined; slot?: LayoutSlot })
    | (Common & { kind: 'resize'; target: SceneObject; handle: Handle; origin: Rect; rect: Rect; moved: boolean; sent: boolean })
    | (Common & { kind: 'relayout'; from: SceneObject; moved: boolean; slot: LayoutSlot | undefined })
    | (Common & { kind: 'connect'; from: SceneObject; to: SceneObject | undefined; moved: boolean; point: { x: number; y: number } });



const DRAG_THRESHOLD = 4;
let gesture: Gesture | null = null;
let inFlight = false;
let queued: (() => void) | null = null;

export function gestureActive(): boolean {
    return gesture !== null && gesture.kind !== 'pending' && gesture.moved;
}


/** The container a drag would drop into, when it is not the current parent. Layout-managed containers are refused. */
function dropTargetFor(g: Extract<Gesture, { kind: 'move' }>, p: { x: number; y: number }): SceneObject | undefined {
    const names = new Set(g.targets.map((t) => t.obj.name));
    let best: SceneObject | undefined;
    for (const o of S.snapshot?.objects ?? []) {
        if (isContainer(o) && contains(o, p.x, p.y) && !descendantOf(o, names) && (!best || o.w * o.h <= best.w * best.h)) {
            best = o;
        }
    }
    if (!best || best.name === g.primary.obj.parent || layoutsOf(best.name).length > 0) {
        return undefined;
    }
    return best;
}


/**
 * Deltas come from screen pixels, never from image coordinates: while the form grows it is re-centred in
 * the workspace, which would shift the image under the pointer and make the gesture run away.
 */
function screenDelta(g: Common, clientX: number, clientY: number): { dx: number; dy: number } {
    return { dx: Math.round((clientX - g.clientX) / zoom()), dy: Math.round((clientY - g.clientY) / zoom()) };
}

function moveDelta(g: Extract<Gesture, { kind: 'move' }>, clientX: number, clientY: number, precise: boolean): { dx: number; dy: number } {
    const [gx, gy] = precise ? [1, 1] : (S.snapshot?.grid ?? [1, 1]);
    const { dx, dy } = screenDelta(g, clientX, clientY);
    const o = g.primary.rect, t = g.primary.obj;
    // Snap in the parent's coordinates, which is where Designer's grid lives, then to sibling edges.
    let r: Rect = { x: snap(o.x - t.gx + dx, gx) + t.gx, y: snap(o.y - t.gy + dy, gy) + t.gy, w: o.w, h: o.h };
    if (!precise) {
        const exclude = new Set(g.targets.map((x) => x.obj.name));
        r = snapToSiblings(r, exclude, t.parent, { l: true, r: true, t: true, b: true, move: true });
    }
    return { dx: r.x - o.x, dy: r.y - o.y };
}

function resizeRect(g: Extract<Gesture, { kind: 'resize' }>, clientX: number, clientY: number, precise: boolean): Rect {
    const [gx, gy] = precise ? [1, 1] : (S.snapshot?.grid ?? [1, 1]);
    const { dx, dy } = screenDelta(g, clientX, clientY);
    const o = g.origin, t = g.target;
    let left = o.x, top = o.y, right = o.x + o.w, bottom = o.y + o.h;
    const h = g.handle;
    const root = t.parent === null;
    if (h.includes('w')) left = snap(o.x - t.gx + dx, gx) + t.gx;
    if (h.includes('e')) right = snap(o.x + o.w - t.gx + dx, gx) + t.gx;
    if (h.includes('n')) top = snap(o.y - t.gy + dy, gy) + t.gy;
    if (h.includes('s')) bottom = snap(o.y + o.h - t.gy + dy, gy) + t.gy;
    const min = root ? 40 : 4;
    let r: Rect = { x: left, y: top, w: Math.max(min, right - left), h: Math.max(min, bottom - top) };
    if (!precise && !root) {
        r = snapToSiblings(r, new Set([t.name]), t.parent, { l: h.includes('w'), r: h.includes('e'), t: h.includes('n'), b: h.includes('s'), move: false });
    }
    return r;
}

function relRect(o: SceneObject, r: Rect): number[] {
    return [r.x - o.gx, r.y - o.gy, r.w, r.h];
}

function geometryValue(t: SceneObject, r: Rect): number[] {
    if (t.parent === null) {
        const [fx, fy] = S.snapshot?.formGeometry ?? [0, 0, 0, 0];
        return [fx, fy, r.w, r.h];
    }
    return relRect(t, r);
}

function frame(g: Extract<Gesture, { kind: 'move' | 'resize' }>): void {
    inFlight = true;
    if (!g.sent) {
        // One undo step for the whole drag, opened only once something really changes.
        const what = g.kind === 'move' ? 'Move' : 'Resize';
        const who = g.kind === 'move' ? (g.targets.length > 1 ? `${g.targets.length} widgets` : g.primary.obj.name) : g.target.name;
        send({ type: 'gesture', phase: 'begin', label: `${what} ${who}` });
    }
    g.sent = true;
    if (g.kind === 'resize') {
        send({ type: 'setProperty', name: g.target.name, property: 'geometry', value: geometryValue(g.target, g.rect) });
    } else if (g.targets.length === 1) {
        const t = g.primary;
        send({ type: 'setProperty', name: t.obj.name, property: 'geometry', value: relRect(t.obj, { ...t.rect, x: t.rect.x + g.delta.dx, y: t.rect.y + g.delta.dy }) });
    } else {
        send({ type: 'setGeometries', items: g.targets.map((t) => ({ name: t.obj.name, rect: relRect(t.obj, { ...t.rect, x: t.rect.x + g.delta.dx, y: t.rect.y + g.delta.dy }) })) });
    }
}

/** Called when a new state arrives: lets the next queued live frame go out. */
export function frameArrived(): void {
    inFlight = false;
    const next = queued;
    queued = null;
    next?.();
}

function pushFrame(g: Extract<Gesture, { kind: 'move' | 'resize' }>): void {
    if (inFlight) {
        queued = () => {
            if (gesture === g) {
                frame(g);
            }
        };
    } else {
        frame(g);
    }
}



function showGhost(content: Node[] | null): void {
    ghost.hidden = content === null;
    ghost.replaceChildren(...(content ?? []));
}


/** The dashed intent outline, guides and live numbers shown while a gesture is running. */
export function renderGhost(): void {
    const g = gesture;
    if (!g || g.kind === 'pending' || !g.moved) {
        return;
    }
    resetTags();
    const nodes: Node[] = [];
    if (g.kind === 'band') {
        nodes.push(placed(el('div', { className: 'ov band' }), g.rect));
        if (g.container && g.container.parent !== null) {
            nodes.push(placed(el('div', { className: 'ov drop-target soft' }), g.container));
        }
        showGhost(nodes);
        hint.textContent = 'Shift: add to selection';
        return;
    }
    if (g.kind === 'relayout') {
        nodes.push(placed(el('div', { className: 'ov move' }), g.from));
        const slot = g.slot;
        if (slot) {
            nodes.push(placed(el('div', { className: slot.axis === 'cell' ? 'ov drop-target' : 'ov insert-line' }), slot.line));
            if (!slot.noop) {
                const what = slot.axis === 'cell' ? `Drop on ${slot.sibling.name}` : `Insert ${slot.before ? 'before' : 'after'} ${slot.sibling.name}`;
                nodes.push(tag(slot.sibling, 'good', icon('arrow-down'), what));
            }
        }
        showGhost(nodes);
        hint.textContent = slot ? (slot.noop ? 'Already here' : 'Release to move it in the layout') : 'Drop inside a layout to reorder';
        return;
    }
    if (g.kind === 'connect') {
        const z = zoom();
        const ax = (g.from.x + g.from.w / 2) * z, ay = (g.from.y + g.from.h / 2) * z;
        const bx = g.point.x * z, by = g.point.y * z;
        const svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('class', 'arrows');
        svg.setAttribute('width', String((S.snapshot?.width ?? 0) * z));
        svg.setAttribute('height', String((S.snapshot?.height ?? 0) * z));
        const line = document.createElementNS(SVG, 'line');
        line.setAttribute('x1', String(ax)); line.setAttribute('y1', String(ay)); line.setAttribute('x2', String(bx)); line.setAttribute('y2', String(by));
        line.setAttribute('class', 'arrow live');
        svg.append(line);
        nodes.push(placed(el('div', { className: 'ov hover connect' }), g.from), svg as unknown as Node);
        if (g.to) {
            nodes.push(placed(el('div', { className: 'ov drop-target' }), g.to));
            nodes.push(tag(g.to, 'good', icon('plug'), `${g.from.name} → ${g.to.name}`));
        }
        showGhost(nodes);
        hint.textContent = 'Release on a widget to choose the signal and slot';
        return;
    }
    const z = zoom();
    if (g.kind === 'resize') {
        const r = g.rect, t = g.target;
        nodes.push(placed(el('div', { className: 'ov resize' }), r));
        if (t.parent !== null) {
            nodes.push(...guideNodes(r, new Set([t.name]), t.parent), ...measureNodes(r, new Set([t.name]), t.parent));
        }
        nodes.push(tag(r, 'accent', t.parent === null ? dims(r.w, r.h) : dims(r.w, r.h), t.parent === null ? '' : el('span', { className: 'dim' }, `${r.x - t.gx}, ${r.y - t.gy}`)));
        geomLabel.textContent = `${t.parent === null ? '' : `${r.x - t.gx}, ${r.y - t.gy}  ·  `}${dims(r.w, r.h)}`;
    } else {
        const p = g.primary;
        const exclude = new Set(g.targets.map((x) => x.obj.name));
        let union: Rect | undefined;
        for (const t of g.targets) {
            const r = { ...t.rect, x: t.rect.x + g.delta.dx, y: t.rect.y + g.delta.dy };
            nodes.push(placed(el('div', { className: 'ov move' }), r));
            union = union ? { x: Math.min(union.x, r.x), y: Math.min(union.y, r.y), w: Math.max(union.x + union.w, r.x + r.w) - Math.min(union.x, r.x), h: Math.max(union.y + union.h, r.y + r.h) - Math.min(union.y, r.y) } : r;
        }
        const pr = { ...p.rect, x: p.rect.x + g.delta.dx, y: p.rect.y + g.delta.dy };
        nodes.push(...guideNodes(pr, exclude, p.obj.parent), ...(g.targets.length === 1 ? measureNodes(pr, exclude, p.obj.parent) : []));
        if (g.slot) {
            nodes.push(placed(el('div', { className: g.slot.axis === 'cell' ? 'ov drop-target' : 'ov insert-line' }), g.slot.line));
            nodes.push(tag(g.slot.sibling, 'good', icon('arrow-down'), g.slot.axis === 'cell' ? `Drop on ${g.slot.sibling.name}` : `Insert ${g.slot.before ? 'before' : 'after'} ${g.slot.sibling.name} in the layout`));
        }
        if (g.drop) {
            nodes.push(placed(el('div', { className: 'ov drop-target' }), g.drop));
            nodes.push(tag(g.drop, 'good', icon('arrow-down'), `Move into ${g.drop.name}`));
        }
        if (union) {
            nodes.push(tag(union, 'accent', `${pr.x - p.obj.gx}, ${pr.y - p.obj.gy}`, el('span', { className: 'dim' }, g.targets.length > 1 ? `${g.targets.length} widgets` : dims(pr.w, pr.h))));
        }
        geomLabel.textContent = `${pr.x - p.obj.gx}, ${pr.y - p.obj.gy}  ·  ${dims(pr.w, pr.h)}`;
    }
    void z;
    showGhost(nodes);
    hint.textContent = 'Alt: no snapping  ·  Esc: cancel';
}

/** Freezes the form where it is while a gesture runs, so it does not slide around as it changes size. */
function pinForm(): void {
    // Measure where the form is, drop the auto-centring margins, then offset by what moved: no visual jump.
    const before = box.getBoundingClientRect();
    box.style.margin = '0';
    const after = box.getBoundingClientRect();
    box.style.marginLeft = `${before.left - after.left}px`;
    box.style.marginTop = `${before.top - after.top}px`;
}

function unpinForm(): void {
    box.style.margin = '';
}

function endGesture(): void {
    unpinForm();
    gesture = null;
    queued = null;
    showGhost(null);
    hint.textContent = '';
}

export function cancelGesture(): void {
    const g = gesture;
    if (g && (g.kind === 'move' || g.kind === 'resize') && g.sent) {
        send({ type: 'cancelGesture' }); // the host closes the gesture and reverts it
    }
    endGesture();
    renderOverlay();
}

function insideImage(p: { x: number; y: number }): boolean {
    return !!S.snapshot && p.x >= 0 && p.y >= 0 && p.x < S.snapshot.width && p.y < S.snapshot.height;
}

function isUi(ev: Event): boolean {
    return (ev.target as HTMLElement | null)?.closest('.pill, .menu, .popup, .inplace') !== null;
}

function movableTargets(hit: SceneObject): Origin[] {
    const s = S.snapshot;
    const sel = s?.selection ?? [];
    if (s && sel.includes(hit.name) && sel.length > 1) {
        const group = sel.map((n) => byName(n)).filter((o): o is SceneObject => isFree(o) && o.parent === hit.parent);
        if (group.length > 1) {
            return group.map((o) => ({ obj: o, rect: { x: o.x, y: o.y, w: o.w, h: o.h } }));
        }
    }
    return [{ obj: hit, rect: { x: hit.x, y: hit.y, w: hit.w, h: hit.h } }];
}

viewport.addEventListener('pointerdown', (ev) => {
    if (!isUi(ev) && (ev.button === 1 || (ev.button === 0 && spaceDown))) {
        ev.preventDefault();
        pan = { x: ev.clientX, y: ev.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        viewport.classList.add('panning');
        if (typeof viewport.setPointerCapture === 'function' && ev.pointerId !== undefined) {
            viewport.setPointerCapture(ev.pointerId);
        }
        return;
    }
    if (isUi(ev) || ev.button !== 0) {
        return;
    }
    const p = toImage(ev);
    if (!p) {
        return;
    }
    if (typeof viewport.setPointerCapture === 'function' && ev.pointerId !== undefined) {
        viewport.setPointerCapture(ev.pointerId);
    }
    const common: Common = { clientX: ev.clientX, clientY: ev.clientY, startX: p.x, startY: p.y };
    const hit = insideImage(p) ? objectAt(p.x, p.y) : undefined;

    if (S.mode === 'connect') {
        if (hit) {
            gesture = { ...common, kind: 'connect', from: hit, to: undefined, moved: false, point: p };
        }
        return;
    }
    const sel = selectedObject();
    if (canResize(sel) && !(sel.parent !== null && sel.laidOut)) {
        const handle = handleAt(sel, p);
        if (handle) {
            const origin = { x: sel.x, y: sel.y, w: sel.w, h: sel.h };
            gesture = { ...common, kind: 'resize', target: sel, handle, origin, rect: origin, moved: false, sent: false };
            return;
        }
    }
    const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    if (isFree(hit) && !additive) {
        const targets = movableTargets(hit);
        const primary = targets.find((t) => t.obj.name === hit.name) ?? (targets[0] as Origin);
        gesture = { ...common, kind: 'move', targets, primary, delta: { dx: 0, dy: 0 }, moved: false, sent: false, drop: undefined };
        return;
    }
    if (hit && hit.laidOut && hit.parent !== null && !additive && S.mode === 'select') {
        gesture = { ...common, kind: 'relayout', from: hit, moved: false, slot: undefined };
        return;
    }
    gesture = { ...common, kind: 'pending', additive };
});

viewport.addEventListener('pointermove', (ev) => {
    if (pan) {
        viewport.scrollLeft = pan.left - (ev.clientX - pan.x);
        viewport.scrollTop = pan.top - (ev.clientY - pan.y);
        return;
    }
    const p = toImage(ev);
    if (!p) {
        return;
    }
    const g = gesture;
    if (!g) {
        const sel = selectedObject();
        const h = S.mode === 'select' && canResize(sel) && !(sel.parent !== null && sel.laidOut) ? handleAt(sel, p) : null;
        const over = insideImage(p) ? objectAt(p.x, p.y) : undefined;
        viewport.style.cursor = S.mode === 'connect' ? 'crosshair' : h ? CURSORS[h] : isFree(over) ? 'move' : 'default';
        const name = over?.name ?? null;
        if (name !== S.hovered) {
            S.hovered = name;
            renderOverlay();
            document.dispatchEvent(new CustomEvent('qtd-hover'));
        }
        return;
    }
    if (!g.moved && Math.hypot(ev.clientX - g.clientX, ev.clientY - g.clientY) < DRAG_THRESHOLD) {
        return;
    }
    if (g.kind === 'pending') {
        // Dragging from empty space (or from a widget a layout owns) draws a selection band.
        const container = containerAt(g.startX, g.startY);
        const band: Extract<Gesture, { kind: 'band' }> = { ...g, kind: 'band', base: g.additive ? [...(S.snapshot?.selection ?? [])] : [], container, rect: { x: g.startX, y: g.startY, w: 0, h: 0 }, moved: true };
        gesture = band;
        renderOverlay();
        updateBand(band, p);
        return;
    }
    if (g.kind === 'band') {
        updateBand(g, p);
        return;
    }
    if (g.kind === 'connect') {
        if (!g.moved) {
            g.moved = true;
            renderOverlay();
        }
        g.point = p;
        const over = insideImage(p) ? objectAt(p.x, p.y) : undefined;
        g.to = over;
        renderGhost();
        return;
    }
    if (g.kind === 'relayout') {
        if (!g.moved) {
            g.moved = true;
            send({ type: 'selectNames', names: [g.from.name] });
            renderOverlay();
        }
        g.slot = layoutSlot(g.from, p);
        renderGhost();
        return;
    }
    if (!g.moved) {
        g.moved = true;
        pinForm();
        // The dragged widget becomes the selection first, so handles and inspector follow it.
        const names = g.kind === 'move' ? g.targets.map((t) => t.obj.name) : [g.target.name];
        const sel = S.snapshot?.selection ?? [];
        if (names.length !== sel.length || names.some((n) => !sel.includes(n))) {
            send({ type: 'selectNames', names });
        }
        renderOverlay();
    }
    if (g.kind === 'move') {
        g.delta = moveDelta(g, ev.clientX, ev.clientY, ev.altKey);
        g.drop = dropTargetFor(g, p);
        // Over a container a layout manages: the widget will be inserted in the layout instead.
        const slot = g.targets.length === 1 && !g.drop ? layoutSlot(g.primary.obj, p) : undefined;
        g.slot = slot && slot.parent !== g.primary.obj.parent ? slot : undefined;
    } else {
        g.rect = resizeRect(g, ev.clientX, ev.clientY, ev.altKey);
    }
    renderGhost();
    const changed = g.kind === 'move' ? g.delta.dx !== 0 || g.delta.dy !== 0 : g.rect.x !== g.origin.x || g.rect.y !== g.origin.y || g.rect.w !== g.origin.w || g.rect.h !== g.origin.h;
    if (changed || g.sent) {
        pushFrame(g);
    }
});

viewport.addEventListener('pointerleave', () => {
    if (!gesture && S.hovered !== null) {
        S.hovered = null;
        renderOverlay();
        document.dispatchEvent(new CustomEvent('qtd-hover'));
    }
});

function updateBand(b: Extract<Gesture, { kind: 'band' }>, p: { x: number; y: number }): void {
    b.rect = { x: Math.min(b.startX, p.x), y: Math.min(b.startY, p.y), w: Math.abs(p.x - b.startX), h: Math.abs(p.y - b.startY) };
    renderGhost();
}

function finishBand(g: Extract<Gesture, { kind: 'band' }>): void {
    const container = g.container;
    const r = g.rect;
    const picked = (S.snapshot?.objects ?? [])
        .filter((o) => o.parent !== null && o.parent === container?.name && o.x < r.x + r.w && r.x < o.x + o.w && o.y < r.y + r.h && r.y < o.y + o.h)
        .map((o) => o.name);
    const names = g.additive ? [...new Set([...g.base, ...picked])] : picked;
    send({ type: 'selectNames', names });
}

viewport.addEventListener('pointerup', (ev) => {
    if (pan) {
        pan = null;
        viewport.classList.remove('panning');
        return;
    }
    const g = gesture;
    if (!g) {
        return;
    }
    const p = toImage(ev);
    if (g.kind === 'band') {
        endGesture();
        finishBand(g);
        renderOverlay();
        return;
    }
    if (g.kind === 'connect') {
        endGesture();
        renderOverlay();
        if (g.moved && g.to) {
            hooks.openConnect({ sender: g.from.name, receiver: g.to.name, at: { x: ev.clientX, y: ev.clientY } });
        } else if (!g.moved) {
            send({ type: 'selectNames', names: [g.from.name] });
        }
        return;
    }
    if (g.kind === 'relayout') {
        endGesture();
        renderOverlay();
        if (!g.moved) {
            send({ type: 'hitSelect', x: g.startX, y: g.startY });
        } else if (g.slot && !g.slot.noop) {
            send({ type: 'moveWidget', name: g.from.name, x: g.slot.point.x, y: g.slot.point.y, ...(g.slot.axis === 'cell' ? {} : { side: g.slot.before ? 'before' : 'after' }) });
        }
        return;
    }
    if ((g.kind === 'move' || g.kind === 'resize') && g.moved) {
        // Consecutive geometry commands merge in Designer's undo stack: the whole gesture is one undo step.
        const flush = queued;
        queued = null;
        if (g.kind === 'move' && g.slot) {
            // The live frames only previewed a position: put the widget back, then let the layout take it.
            if (g.sent) {
                send({ type: 'cancelGesture' });
            }
            send({ type: 'moveWidget', name: g.primary.obj.name, x: g.slot.point.x, y: g.slot.point.y, ...(g.slot.axis === 'cell' ? {} : { side: g.slot.before ? 'before' : 'after' }) });
            unpinForm();
            gesture = null;
            showGhost(null);
            hint.textContent = '';
            renderOverlay();
            return;
        }
        if (g.kind === 'move' && g.sent && g.drop) {
            // Dropped on another container: the live frames moved the widgets where the pointer is,
            // reparenting then puts them in the container at the same place on screen.
            const drop = g.drop;
            const items = g.targets.map((t) => ({ name: t.obj.name, rect: [t.rect.x + g.delta.dx, t.rect.y + g.delta.dy, t.rect.w, t.rect.h] }));
            send({ type: 'reparent', parent: drop.name, items });
        } else {
            flush?.();
        }
        if (g.sent) {
            send({ type: 'gesture', phase: 'end', label: '' });
        }
        unpinForm();
        gesture = null;
        showGhost(null);
        hint.textContent = '';
        renderOverlay();
        return;
    }
    endGesture();
    renderOverlay();
    if (!p) {
        return;
    }
    if (g.kind === 'move') {
        // a click on a widget: plain click selects only it, even inside a multi-selection
        const sel = S.snapshot?.selection ?? [];
        if (sel.length !== 1 || sel[0] !== g.primary.obj.name) {
            send({ type: 'selectNames', names: [g.primary.obj.name] });
        }
        if (g.primary.obj.class === 'QTabWidget') {
            requestTab(g.primary.obj.name, p, false);
        }
    } else if (g.kind === 'pending') {
        if (g.additive) {
            const hit = objectAt(p.x, p.y);
            if (hit && S.snapshot) {
                const names = S.snapshot.selection.includes(hit.name) ? S.snapshot.selection.filter((n) => n !== hit.name) : [...S.snapshot.selection, hit.name];
                send({ type: 'selectNames', names });
            }
        } else if (insideImage(p)) {
            send({ type: 'hitSelect', x: p.x, y: p.y });
            const hit = objectAt(p.x, p.y);
            if (hit?.class === 'QTabWidget') {
                requestTab(hit.name, p, false);
            }
        } else {
            const root = rootObject();
            if (root) {
                send({ type: 'selectNames', names: [root.name] });
            }
        }
    }
});

viewport.addEventListener('pointercancel', cancelGesture);

viewport.addEventListener('dblclick', (ev) => {
    if (isUi(ev) || S.mode !== 'select') {
        return;
    }
    const p = toImage(ev);
    if (!p || !insideImage(p)) {
        return;
    }
    const hit = objectAt(p.x, p.y);
    if (hit?.class === 'QTabWidget') {
        requestTab(hit.name, p, true);
        return;
    }
    const isBox = hit?.class === 'QGroupBox';
    const onTitle = isBox && hit !== undefined && p.y - hit.y < 26;
    const leafLike = !!hit && hit.parent !== null && (!isContainer(hit) || onTitle || hit.class === 'QLabel');
    if (hit && leafLike) {
        // The first click of the double-click selected it; the properties may not have arrived yet.
        if (S.snapshot?.selection.length === 1 && S.snapshot.selection[0] === hit.name && hooks.editableText()) {
            hooks.editText();
        } else {
            hooks.editTextWhenReady(hit.name);
        }
    } else {
        hooks.openQuickAdd(p);
    }
});

viewport.addEventListener('contextmenu', (ev) => {
    if (isUi(ev)) {
        return;
    }
    ev.preventDefault();
    const p = toImage(ev);
    if (p && insideImage(p)) {
        const hit = objectAt(p.x, p.y);
        if (hit && !S.snapshot?.selection.includes(hit.name)) {
            send({ type: 'selectNames', names: [hit.name] });
            pendingMenu = { x: ev.clientX, y: ev.clientY };
            return;
        }
    }
    hooks.openContextMenu(ev.clientX, ev.clientY);
});

let pendingMenu: { x: number; y: number } | null = null;

/** Selects, then opens the context menu once the engine confirms the new selection. */
export function menuAfterSelect(names: string[], x: number, y: number): void {
    if (names.length === 1 && S.snapshot?.selection.length === 1 && S.snapshot.selection[0] === names[0]) {
        hooks.openContextMenu(x, y);
        return;
    }
    pendingMenu = { x, y };
    send({ type: 'selectNames', names });
}

/** Opens the context menu that was waiting for the selection change it triggered. */
export function flushPendingMenu(): void {
    if (pendingMenu) {
        const m = pendingMenu;
        pendingMenu = null;
        hooks.openContextMenu(m.x, m.y);
    }
}

viewport.addEventListener('wheel', (ev) => {
    if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        // Zoom around the pointer: the point under it stays under it.
        const p = toImage(ev);
        stepZoom(ev.deltaY < 0 ? 1 : -1);
        if (p) {
            const r = form.getBoundingClientRect();
            viewport.scrollLeft += r.left + p.x * zoom() - ev.clientX;
            viewport.scrollTop += r.top + p.y * zoom() - ev.clientY;
        }
    }
}, { passive: false });

// ---- palette drop target ---------------------------------------------------------------

export const PALETTE_MIME = 'application/x-qt-designer-widget';
export const dragged: { entry: { name: string; category: number; index: number } | null } = { entry: null };

stage.addEventListener('dragover', (ev) => {
    if (!ev.dataTransfer?.types.includes(PALETTE_MIME)) {
        return;
    }
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    const p = toImage(ev);
    if (!p) {
        return;
    }
    resetTags();
    const target = containerAt(p.x, p.y);
    const nodes: HTMLElement[] = [];
    if (target) {
        nodes.push(placed(el('div', { className: 'ov drop-target' }), target));
        nodes.push(tag(target, 'good', icon('arrow-down'), `Drop into ${target.name}`));
    }
    const at: Rect = { x: p.x, y: p.y, w: 80, h: 24 };
    nodes.push(placed(el('div', { className: 'ov drop-ghost' }), at));
    if (dragged.entry) {
        const t = el('div', { className: 'tag good' }, `+ ${dragged.entry.name}`);
        t.style.left = `${at.x * zoom()}px`;
        t.style.top = `${(at.y + at.h) * zoom() + 4}px`;
        nodes.push(t);
    }
    showGhost(nodes);
});
stage.addEventListener('dragleave', (ev) => {
    if (!stage.contains(ev.relatedTarget as Node | null)) {
        showGhost(null);
    }
});
stage.addEventListener('drop', (ev) => {
    showGhost(null);
    const data = ev.dataTransfer?.getData(PALETTE_MIME);
    const p = toImage(ev);
    if (!data || !p) {
        return;
    }
    ev.preventDefault();
    const [category, index] = data.split(',').map(Number);
    if (Number.isInteger(category) && Number.isInteger(index)) {
        send({ type: 'addWidget', category: category as number, index: index as number, x: p.x, y: p.y });
    }
});
document.addEventListener('dragend', () => {
    dragged.entry = null;
    showGhost(null);
});

// ---- entry points ----------------------------------------------------------------------

/** Re-render after a new state. A running gesture keeps its ghost; the engine's live frame is the real preview. */
export function renderCanvas(): void {
    const s = S.snapshot;
    if (!s) {
        return;
    }
    form.src = `data:image/png;base64,${s.png}`;
    layoutStage();
    if (!gestureActive()) {
        showGhost(null);
    }
    renderOverlay();
    renderGhost();
}

export function containsPoint(o: Rect, x: number, y: number): boolean {
    return contains(o, x, y);
}

/** Window-level hooks: the pixel density changes when the window moves between screens. */
export function initGlobalCanvas(): void {
    document.addEventListener('qtd-redraw', renderOverlay);
    if (typeof window.matchMedia === 'function') {
        window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', resetRender);
    }
}

export function setMode(mode: 'select' | 'connect'): void {
    S.mode = mode;
    viewport.classList.toggle('connect-mode', mode === 'connect');
    cancelGesture();
    renderOverlay();
}

export { alignable, layoutsOf };
