import type { SceneObject } from '../protocol';
import { cancelGesture } from './canvas';
import { el } from './dom';
import { S, send } from './state';
import { ghost, placed, stage, toImage, zoom } from './view';

// Dragging an entry of a tool bar along the bar reorders it (one undo step, through moveEntry).

interface Drag { bar: SceneObject; from: number; startX: number; startY: number; active: boolean; to: number }
let drag: Drag | undefined;

const horizontal = (bar: SceneObject): boolean => bar.w >= bar.h;

function entryAt(x: number, y: number): { bar: SceneObject; index: number } | undefined {
    for (const bar of S.snapshot?.objects ?? []) {
        const entries = bar.entries ?? [];
        const index = entries.findIndex((e) => e.w > 0 && e.h > 0 && x >= e.x && y >= e.y && x < e.x + e.w && y < e.y + e.h);
        if (index >= 0) {
            return { bar, index };
        }
    }
    return undefined;
}

/** Where the entry would land: the number of other entries that lie before the pointer along the bar. */
function slot(bar: SceneObject, from: number, x: number, y: number): number {
    const h = horizontal(bar);
    let n = 0;
    (bar.entries ?? []).forEach((e, i) => {
        if (i !== from && e.w > 0 && (h ? e.x + e.w / 2 : e.y + e.h / 2) < (h ? x : y)) {
            n++;
        }
    });
    return Math.min(n, (bar.entries?.length ?? 1) - 1);
}

function indicator(d: Drag): void {
    const others = (d.bar.entries ?? []).filter((e, i) => i !== d.from && e.w > 0);
    const h = horizontal(d.bar);
    const next = others[d.to];
    const prev = others[d.to - 1];
    const at = next ? (h ? next.x : next.y) : prev ? (h ? prev.x + prev.w : prev.y + prev.h) : (h ? d.bar.x : d.bar.y);
    const line = el('div', { className: 'ov entry-drop' });
    const z = zoom();
    Object.assign(line.style, h
        ? { left: `${at * z - 1}px`, top: `${d.bar.y * z}px`, width: '2px', height: `${d.bar.h * z}px` }
        : { left: `${d.bar.x * z}px`, top: `${at * z - 1}px`, width: `${d.bar.w * z}px`, height: '2px' });
    ghost.replaceChildren(placed(el('div', { className: 'ov drop-target' }), d.bar), line);
    ghost.hidden = false;
}

stage.addEventListener('pointerdown', (ev) => {
    const p = toImage(ev);
    const hit = p && ev.button === 0 ? entryAt(p.x, p.y) : undefined;
    if (hit && p && (hit.bar.entries?.length ?? 0) > 1) {
        drag = { bar: hit.bar, from: hit.index, startX: ev.clientX, startY: ev.clientY, active: false, to: hit.index };
    }
}, true);

window.addEventListener('pointermove', (ev) => {
    if (!drag) {
        return;
    }
    if (!drag.active) {
        if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 5) {
            return;
        }
        drag.active = true;
        cancelGesture();
    }
    const p = toImage(ev);
    if (p) {
        drag.to = slot(drag.bar, drag.from, p.x, p.y);
        indicator(drag);
    }
    ev.stopImmediatePropagation();
}, true);

window.addEventListener('pointerup', (ev) => {
    const d = drag;
    drag = undefined;
    if (!d?.active) {
        return;
    }
    ev.stopImmediatePropagation();
    ghost.replaceChildren();
    ghost.hidden = true;
    if (d.to !== d.from) {
        send({ type: 'moveEntry', target: d.bar.name, from: d.from, to: d.to });
    }
}, true);

window.addEventListener('keydown', (ev) => {
    if (drag?.active && ev.key === 'Escape') {
        drag = undefined;
        ghost.replaceChildren();
        ghost.hidden = true;
        ev.stopImmediatePropagation();
    }
}, true);
