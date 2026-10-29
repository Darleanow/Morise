import { $ } from './dom';
import { DEFAULT_PREFS, prefs, savePrefs } from './state';

const app = $<HTMLDivElement>('app');
const paletteSection = $<HTMLElement>('palette-section');

export const LIMITS = { left: [170, 460], right: [260, 640], palette: [90, 2000] } as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** Pushes panel sizes and visibility into CSS variables and classes. */
export function applyPanels(): void {
    app.style.setProperty('--left-w', `${prefs.leftOpen ? clamp(prefs.leftW, LIMITS.left) : 0}px`);
    app.style.setProperty('--right-w', `${prefs.rightOpen ? clamp(prefs.rightW, LIMITS.right) : 0}px`);
    app.style.setProperty('--palette-h', `${Math.max(LIMITS.palette[0], prefs.paletteH)}px`);
    app.classList.toggle('no-left', !prefs.leftOpen);
    app.classList.toggle('no-right', !prefs.rightOpen);
}

export function togglePanel(side: 'left' | 'right'): void {
    if (side === 'left') {
        prefs.leftOpen = !prefs.leftOpen;
    } else {
        prefs.rightOpen = !prefs.rightOpen;
    }
    savePrefs();
    applyPanels();
}

function makeSplitter(handle: HTMLElement, axis: 'x' | 'y', start: () => number, set: (v: number) => void, reset: () => void, invert = false): void {
    let origin = 0;
    let base = 0;
    handle.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        origin = axis === 'x' ? ev.clientX : ev.clientY;
        base = start();
        handle.setPointerCapture?.(ev.pointerId);
        handle.classList.add('active');
        document.body.classList.add(axis === 'x' ? 'resizing-x' : 'resizing-y');
    });
    handle.addEventListener('pointermove', (ev) => {
        if (!handle.classList.contains('active')) {
            return;
        }
        const d = (axis === 'x' ? ev.clientX : ev.clientY) - origin;
        set(base + (invert ? -d : d));
        applyPanels();
    });
    const end = () => {
        if (handle.classList.contains('active')) {
            handle.classList.remove('active');
            document.body.classList.remove('resizing-x', 'resizing-y');
            savePrefs();
        }
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', () => {
        reset();
        savePrefs();
        applyPanels();
    });
    handle.addEventListener('keydown', (ev) => {
        const step = ev.shiftKey ? 48 : 16;
        const dir = axis === 'x' ? (ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0) : (ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0);
        if (dir === 0) {
            return;
        }
        ev.preventDefault();
        set(start() + (invert ? -dir : dir) * step);
        savePrefs();
        applyPanels();
    });
}

export function initSplitters(): void {
    makeSplitter($('split-left'), 'x', () => prefs.leftW, (v) => { prefs.leftW = clamp(v, LIMITS.left); }, () => { prefs.leftW = DEFAULT_PREFS.leftW; });
    makeSplitter($('split-right'), 'x', () => prefs.rightW, (v) => { prefs.rightW = clamp(v, LIMITS.right); }, () => { prefs.rightW = DEFAULT_PREFS.rightW; }, true);
    makeSplitter($('split-palette'), 'y', () => paletteSection.getBoundingClientRect().height, (v) => {
        const max = ($('left').clientHeight || 600) - 120;
        prefs.paletteH = clamp(v, [LIMITS.palette[0], Math.max(LIMITS.palette[0], max)]);
    }, () => { prefs.paletteH = DEFAULT_PREFS.paletteH; });
    applyPanels();
}
