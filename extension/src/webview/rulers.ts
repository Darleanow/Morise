import { el } from './dom';
import { prefs, S } from './state';
import { box, form, toImage, viewport, zoom } from './view';

// Rulers along the top and left edges of the form, in the form's own (logical) pixels, with a marker that follows the pointer.

const SIZE = 18;
const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const NS = 'http://www.w3.org/2000/svg';

/** Guides pulled out of the rulers, in form pixels: `x` are vertical lines, `y` horizontal ones. Moves and resizes snap to them. */
export const userGuides: { x: number[]; y: number[] } = { x: [], y: [] };
const GRIP = 7;

let top: HTMLDivElement | undefined;
let left: HTMLDivElement | undefined;
let markTop: HTMLDivElement | undefined;
let markLeft: HTMLDivElement | undefined;

function ruler(horizontal: boolean, length: number, z: number): SVGSVGElement {
    const svg = document.createElementNS(NS, 'svg');
    const px = length * z;
    svg.setAttribute('width', String(horizontal ? px : SIZE));
    svg.setAttribute('height', String(horizontal ? SIZE : px));
    const minor = NICE.find((n) => n * z >= 6) ?? 1000;
    const major = NICE.find((n) => n * z >= 56 && n % minor === 0) ?? 1000;
    for (let v = 0; v <= length; v += minor) {
        const long = v % major === 0;
        const p = v * z + 0.5;
        const len = long ? SIZE : v % (major / 2) === 0 && major / 2 >= minor ? SIZE * 0.6 : SIZE * 0.35;
        const line = document.createElementNS(NS, 'line');
        line.setAttribute(horizontal ? 'x1' : 'y1', String(p));
        line.setAttribute(horizontal ? 'x2' : 'y2', String(p));
        line.setAttribute(horizontal ? 'y1' : 'x1', String(SIZE));
        line.setAttribute(horizontal ? 'y2' : 'x2', String(SIZE - len));
        svg.append(line);
        if (long) {
            const t = document.createElementNS(NS, 'text');
            t.textContent = String(v);
            if (horizontal) {
                t.setAttribute('x', String(p + 2));
                t.setAttribute('y', '9');
            } else {
                t.setAttribute('x', '1');
                t.setAttribute('y', String(p + 9));
                t.setAttribute('transform', `rotate(-90 1 ${p + 9})`);
                t.setAttribute('x', '1');
            }
            svg.append(t);
        }
    }
    return svg;
}

/** Builds, refreshes or removes the rulers: called when the zoom, the form size or the preference changes. */
export function renderRulers(): void {
    const s = S.snapshot;
    viewport.classList.toggle('with-rulers', prefs.rulers);
    if (!prefs.rulers || !s) {
        top?.remove();
        left?.remove();
        lines?.remove();
        lines = undefined;
        top = left = markTop = markLeft = undefined;
        return;
    }
    const z = zoom();
    if (!top || !left) {
        markTop = el('div', { className: 'ruler-mark' });
        markLeft = el('div', { className: 'ruler-mark' });
        top = el('div', { className: 'ruler ruler-top', ariaHidden: 'true' });
        left = el('div', { className: 'ruler ruler-left', ariaHidden: 'true' });
        box.append(top, left);
        top.addEventListener('pointerdown', (ev) => dragGuide(ev, 'y', undefined));
        left.addEventListener('pointerdown', (ev) => dragGuide(ev, 'x', undefined));
    }
    const key = `${s.width}x${s.height}@${z}|${userGuides.x.join(',')}|${userGuides.y.join(',')}`;
    if (top.dataset.key !== key) {
        top.dataset.key = key;
        top.replaceChildren(ruler(true, s.width, z), markTop as HTMLElement);
        left.replaceChildren(ruler(false, s.height, z), markLeft as HTMLElement);
        lines?.remove();
        lines = el('div', { className: 'user-guides' });
        for (const [axis, list] of [['x', userGuides.x], ['y', userGuides.y]] as const) {
            list.forEach((v, i) => {
                const line = el('div', { className: `user-guide ${axis}` });
                line.style[axis === 'x' ? 'left' : 'top'] = `${v * z}px`;
                lines?.append(line);
                const grip = el('div', { className: `guide-grip ${axis}`, title: 'Drag to move this guide, drag it off the ruler or double-click to remove it' });
                grip.style[axis === 'x' ? 'left' : 'top'] = `${v * z - GRIP / 2}px`;
                grip.addEventListener('pointerdown', (ev) => {
                    ev.stopPropagation();
                    dragGuide(ev, axis, i);
                });
                grip.addEventListener('dblclick', () => {
                    list.splice(i, 1);
                    renderRulers();
                    refresh();
                });
                (axis === 'x' ? top : left)?.append(grip);
            });
        }
        box.append(lines);
    }
}

let lines: HTMLDivElement | undefined;

/** Repaints what depends on the guides (the selection overlay snaps to them while it is dragged). */
function refresh(): void {
    document.dispatchEvent(new CustomEvent('qtd-guides'));
}

/** Pulls a new guide out of a ruler, or moves an existing one; letting go outside the form deletes it. */
function dragGuide(ev: PointerEvent, axis: 'x' | 'y', index: number | undefined): void {
    const s = S.snapshot;
    if (!s || ev.button !== 0) {
        return;
    }
    ev.preventDefault();
    const list = userGuides[axis];
    const limit = axis === 'x' ? s.width : s.height;
    const at = (e: PointerEvent): number => {
        const r = box.getBoundingClientRect();
        return Math.round(((axis === 'x' ? e.clientX - r.left : e.clientY - r.top) / zoom()));
    };
    let current = index ?? list.length;
    if (index === undefined) {
        list.push(at(ev));
    }
    document.body.classList.add(axis === 'x' ? 'resizing-x' : 'resizing-y');
    const move = (e: PointerEvent) => {
        list[current] = at(e);
        renderRulers();
    };
    const up = (e: PointerEvent) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing-x', 'resizing-y');
        const v = at(e);
        if (v < 0 || v > limit) {
            list.splice(current, 1);
        } else {
            list[current] = v;
        }
        current = -1;
        renderRulers();
        refresh();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    move(ev);
}

form.addEventListener('pointermove', (ev) => {
    const p = toImage(ev);
    if (p && markTop && markLeft) {
        markTop.style.left = `${p.x * zoom()}px`;
        markLeft.style.top = `${p.y * zoom()}px`;
    }
});
