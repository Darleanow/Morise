import { $, button, dims, el, icon } from './dom';
import { fitZoom, setZoom, stepZoom } from './canvas';
import { byName, primarySelection, rootObject, selectedObject } from './geometry';
import { prefs, S, send } from './state';

const crumbs = $<HTMLElement>('crumbs');
const geom = $('geom');
const zoomBar = $<HTMLDivElement>('zoom');

export function renderStatus(): void {
    const s = S.snapshot;
    crumbs.replaceChildren();
    if (!s) {
        geom.textContent = '';
        return;
    }
    const sel = selectedObject() ?? primarySelection();
    const chain = [] as NonNullable<typeof sel>[];
    for (let o = sel ?? rootObject(); o; o = byName(o.parent)) {
        chain.unshift(o);
        if (chain.length > 20) {
            break;
        }
    }
    chain.forEach((o, i) => {
        if (i > 0) {
            crumbs.append(icon('chevron-right'));
        }
        const b = el('button', { type: 'button', className: `crumb${i === chain.length - 1 ? ' current' : ''}`, title: `${o.name} (${o.class})` }, o.name);
        b.addEventListener('click', () => send({ type: 'selectNames', names: [o.name] }));
        crumbs.append(b);
    });
    if (s.selection.length > 1) {
        crumbs.append(el('span', { className: 'dim' }, `  ${s.selection.length} selected`));
    }
    geom.textContent = sel
        ? `${sel.x - sel.gx}, ${sel.y - sel.gy}  ·  ${dims(sel.w, sel.h)}${sel.laidOut ? '  ·  in layout' : ''}`
        : `Form  ·  ${dims(s.width, s.height)}`;
}

export function renderZoomBar(): void {
    const level = el('button', { type: 'button', className: 'level', title: 'Reset zoom to 100%' }, `${Math.round(prefs.zoom * 100)}%`);
    level.addEventListener('click', () => setZoom(1));
    zoomBar.replaceChildren(
        button('Zoom out', icon('zoom-out'), () => stepZoom(-1)),
        level,
        button('Zoom in', icon('zoom-in'), () => stepZoom(1)),
        button('Fit form in view', icon('screen-full'), fitZoom));
}
