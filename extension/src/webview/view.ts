import { $ } from './dom';
import type { Rect } from './geometry';
import { prefs, S, savePrefs, send } from './state';

// The stage: the form image, its overlay layers, the zoom and the pixel density it is drawn at.

export const form = $<HTMLImageElement>('form');
export const box = $<HTMLDivElement>('box');
export const stage = $<HTMLDivElement>('stage');
export const viewport = $<HTMLDivElement>('viewport');
export const overlay = $<HTMLDivElement>('overlay');
export const ghost = $<HTMLDivElement>('ghost');
export const geomLabel = $('geom');
export const hint = $('hint');

// ---- zoom and pixel density ------------------------------------------------------------

const ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
let pendingScale = 0;
let scaleTimer: number | undefined;
const zoomListeners: (() => void)[] = [];

/** While true the form follows the window: resizing a panel or the editor refits it. Any manual zoom clears it. */
let autoFit = false;

export function onZoomChange(fn: () => void): void {
    zoomListeners.push(fn);
}

/** Ask the engine for a render at devicePixelRatio * zoom, so text stays crisp at any zoom or screen density. */
export function requestScale(): void {
    const scale = Math.min(4, Math.max(0.25, Math.round(window.devicePixelRatio * prefs.zoom * 100) / 100));
    if (scale === pendingScale) {
        return;
    }
    pendingScale = scale;
    send({ type: 'view', scale });
}

export function setZoom(next: number): void {
    autoFit = false;
    prefs.zoom = Math.min(4, Math.max(0.25, Math.round(next * 100) / 100));
    savePrefs();
    layoutStage();
    for (const fn of zoomListeners) {
        fn();
    }
    window.clearTimeout(scaleTimer);
    scaleTimer = window.setTimeout(requestScale, 60);
}

export function stepZoom(direction: 1 | -1): void {
    const z = prefs.zoom;
    if (direction > 0) {
        setZoom(ZOOMS.find((v) => v > z + 0.001) ?? z);
    } else {
        setZoom([...ZOOMS].reverse().find((v) => v < z - 0.001) ?? z);
    }
}

export function fitZoom(): void {
    const s = S.snapshot;
    // A hidden or collapsed editor has no size to fit into: keep the zoom rather than shrink the form to the minimum.
    if (s && viewport.clientWidth > 120 && viewport.clientHeight > 120) {
        setZoom(Math.min((viewport.clientWidth - 96) / s.width, (viewport.clientHeight - 96) / s.height, 4));
        autoFit = true;
    }
}

export function resetRender(): void {
    pendingScale = 0;
    requestScale();
}

export function zoom(): number {
    return prefs.zoom;
}

export function layoutStage(): void {
    const s = S.snapshot;
    if (!s) {
        return;
    }
    const w = s.width * zoom();
    const h = s.height * zoom();
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
    form.style.width = `${w}px`;
    form.style.height = `${h}px`;
}

/** Pointer position in snapshot (logical) pixels; may lie outside the form. */
export function toImage(ev: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const r = form.getBoundingClientRect();
    if (!S.snapshot || r.width === 0 || r.height === 0) {
        return null;
    }
    return { x: Math.round(((ev.clientX - r.left) / r.width) * S.snapshot.width), y: Math.round(((ev.clientY - r.top) / r.height) * S.snapshot.height) };
}

export function placed(node: HTMLElement, r: Rect): HTMLElement {
    const z = zoom();
    Object.assign(node.style, { left: `${r.x * z}px`, top: `${r.y * z}px`, width: `${r.w * z}px`, height: `${r.h * z}px` });
    return node;
}

if (typeof ResizeObserver === 'function') {
    let frame = 0;
    new ResizeObserver(() => {
        if (autoFit && !frame) {
            frame = requestAnimationFrame(() => {
                frame = 0;
                if (autoFit) {
                    fitZoom();
                }
            });
        }
    }).observe(viewport);
}
