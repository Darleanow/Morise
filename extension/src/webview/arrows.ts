import { el } from './dom';
import { byName } from './geometry';
import { prefs, S } from './state';
import { zoom } from './view';

export const SVG = 'http://www.w3.org/2000/svg';

/** Signal/slot connections as arrows between the widgets, like Designer's connection mode. */
export function connectionArrows(): SVGElement | null {
    const s = S.snapshot;
    if (!s || !(S.mode === 'connect' || prefs.rightTab === 'connections') || S.connections.length === 0) {
        return null;
    }
    const z = zoom();
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'arrows');
    svg.setAttribute('width', String(s.width * z));
    svg.setAttribute('height', String(s.height * z));
    const marker = document.createElementNS(SVG, 'defs');
    marker.innerHTML = '';
    const mk = document.createElementNS(SVG, 'marker');
    mk.setAttribute('id', 'arrow'); mk.setAttribute('viewBox', '0 0 10 10'); mk.setAttribute('refX', '9'); mk.setAttribute('refY', '5');
    mk.setAttribute('markerWidth', '7'); mk.setAttribute('markerHeight', '7'); mk.setAttribute('orient', 'auto-start-reverse');
    const head = document.createElementNS(SVG, 'path');
    head.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    head.setAttribute('class', 'arrow-head');
    mk.append(head);
    marker.append(mk);
    svg.append(marker);
    const selected = new Set(s.selection);
    S.connections.forEach((c, i) => {
        const a = byName(c.sender), b = byName(c.receiver);
        if (!a || !b) {
            return;
        }
        const involved = selected.has(c.sender) || selected.has(c.receiver);
        const ax = (a.x + a.w / 2) * z, ay = (a.y + a.h / 2) * z;
        const bx = (b.x + b.w / 2) * z, by = (b.y + b.h / 2) * z;
        const path = document.createElementNS(SVG, 'path');
        const lift = 18 + (i % 4) * 8;
        const mx = (ax + bx) / 2, my = (ay + by) / 2 - lift;
        path.setAttribute('d', c.sender === c.receiver ? `M${ax},${ay} c ${-24},${-34} ${24},${-34} 0,0` : `M${ax},${ay} Q${mx},${my} ${bx},${by}`);
        path.setAttribute('class', `arrow${involved ? ' involved' : ''}`);
        path.setAttribute('marker-end', 'url(#arrow)');
        svg.append(path);
        const dot = document.createElementNS(SVG, 'circle');
        dot.setAttribute('cx', String(ax)); dot.setAttribute('cy', String(ay)); dot.setAttribute('r', '3');
        dot.setAttribute('class', 'arrow-dot');
        svg.append(dot);
        const text = document.createElementNS(SVG, 'text');
        text.setAttribute('x', String(mx)); text.setAttribute('y', String(my / 2 + (ay + by) / 4 - 2));
        text.setAttribute('class', `arrow-label${involved ? ' involved' : ''}`);
        text.setAttribute('text-anchor', 'middle');
        text.textContent = `${c.signal} → ${c.slot}`;
        svg.append(text);
    });
    return svg;
}

/** Numbers on the widgets in keyboard focus order (shown while the Form tab is open). */
export function tabOrderBadges(frag: DocumentFragment): void {
    if (!S.tabOrder || prefs.rightTab !== 'form') {
        return;
    }
    S.tabOrder.forEach((name, i) => {
        const o = byName(name);
        if (!o) {
            return;
        }
        const b = el('div', { className: 'badge-num' }, String(i + 1));
        b.style.left = `${o.x * zoom() - 6}px`;
        b.style.top = `${o.y * zoom() - 6}px`;
        frag.append(b);
    });
}
