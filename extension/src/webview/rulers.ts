import { el } from './dom';
import { prefs, S } from './state';
import { box, form, toImage, viewport, zoom } from './view';

// Rulers along the top and left edges of the form, in the form's own (logical) pixels, with a marker that follows the pointer.

const SIZE = 18;
const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const NS = 'http://www.w3.org/2000/svg';

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
    }
    const key = `${s.width}x${s.height}@${z}`;
    if (top.dataset.key !== key) {
        top.dataset.key = key;
        top.replaceChildren(ruler(true, s.width, z), markTop as HTMLElement);
        left.replaceChildren(ruler(false, s.height, z), markLeft as HTMLElement);
    }
}

form.addEventListener('pointermove', (ev) => {
    const p = toImage(ev);
    if (p && markTop && markLeft) {
        markTop.style.left = `${p.x * zoom()}px`;
        markLeft.style.top = `${p.y * zoom()}px`;
    }
});
