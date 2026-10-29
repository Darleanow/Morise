export function $<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) {
        throw new Error(`missing #${id}`);
    }
    return node as T;
}

/** All dynamic text goes through textContent; names come from the .ui file and are untrusted. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
}

/** Icons the codicon font lacks (alignment, distribution, text alignment), drawn as 16x16 strokes. */
const CUSTOM_ICONS: Record<string, string> = {
    cut: 'C4,12,2 C12,12,2 M5.4,10.4 L11.2,2 M10.6,10.4 L4.8,2',
    'align-left': 'M2,2 V14 M4,4 H13 V7 H4 Z M4,9 H9 V12 H4 Z',
    'align-hcenter': 'M8,2 V14 M3,4 H13 V7 H3 Z M5,9 H11 V12 H5 Z',
    'align-right': 'M14,2 V14 M3,4 H12 V7 H3 Z M7,9 H12 V12 H7 Z',
    'align-top': 'M2,2 H14 M4,4 V13 H7 V4 Z M9,4 V9 H12 V4 Z',
    'align-vcenter': 'M2,8 H14 M4,3 V13 H7 V3 Z M9,5 V11 H12 V5 Z',
    'align-bottom': 'M2,14 H14 M4,4 V12 H7 V4 Z M9,7 V12 H12 V7 Z',
    'distribute-h': 'M2,2 V14 M14,2 V14 M6,4 H10 V12 H6 Z',
    'distribute-v': 'M2,2 H14 M2,14 H14 M4,6 H12 V10 H4 Z',
    'same-width': 'M2,3 H14 V6 H2 Z M2,10 H14 V13 H2 Z M2,8 H14',
    'same-height': 'M3,2 V14 H6 V2 Z M10,2 V14 H13 V2 Z M8,2 V14',
    'same-size': 'M2,2 H7 V7 H2 Z M9,9 H14 V14 H9 Z M9,2 H14 V7 H9 Z',
    'text-left': 'M2,3 H14 M2,6 H9 M2,9 H14 M2,12 H9',
    'text-center': 'M2,3 H14 M4.5,6 H11.5 M2,9 H14 M4.5,12 H11.5',
    'text-right': 'M2,3 H14 M7,6 H14 M2,9 H14 M7,12 H14',
    'text-justify': 'M2,3 H14 M2,6 H14 M2,9 H14 M2,12 H10',
    'v-top': 'M2,2 H14 M5,4 V12 M8,4 V9 M11,4 V7',
    'v-middle': 'M2,8 H14 M5,3 V13 M8,5 V11 M11,6 V10',
    'v-bottom': 'M2,14 H14 M5,4 V12 M8,7 V12 M11,9 V12',
    'v-baseline': 'M2,10 H14 M5,3 V10 M8,6 V10 M11,4 V10',
    'connect-tool': 'M3,13 C3,13 3,6 8,6 H13 M11,3 L14,6 L11,9',
};

function svgIcon(name: string, spec: string): HTMLElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    for (const part of spec.split(/(?=[CM])/)) {
        const t = part.trim();
        if (!t) {
            continue;
        }
        if (t.startsWith('C')) {
            // C cx,cy,r : a circle
            const [cx, cy, r] = t.slice(1).trim().split(',');
            const c = document.createElementNS(ns, 'circle');
            c.setAttribute('cx', cx ?? '0'); c.setAttribute('cy', cy ?? '0'); c.setAttribute('r', (r ?? '2').split(' ')[0] ?? '2');
            svg.append(c);
            if ((r ?? '').includes(' ')) {
                const rest = (r ?? '').split(' ').slice(1).join(' ');
                if (rest.trim()) {
                    const path = document.createElementNS(ns, 'path');
                    path.setAttribute('d', rest);
                    svg.append(path);
                }
            }
        } else {
            const path = document.createElementNS(ns, 'path');
            path.setAttribute('d', t);
            svg.append(path);
        }
    }
    const wrap = el('span', { className: `codicon svg-icon svg-${name}` });
    wrap.setAttribute('aria-hidden', 'true');
    wrap.append(svg);
    return wrap;
}

/** A VS Code codicon (the icon font is loaded by the page), or one of the drawn icons above. */
export function icon(name: string): HTMLElement {
    const custom = CUSTOM_ICONS[name];
    if (custom !== undefined) {
        return name === 'cut' ? scissors() : svgIcon(name, custom);
    }
    const i = el('span', { className: `codicon codicon-${name}` });
    i.setAttribute('aria-hidden', 'true');
    return i;
}

export function button(label: string, glyph: Node | string, onClick: () => void, className = ''): HTMLButtonElement {
    const b = el('button', { type: 'button', title: label, className }, typeof glyph === 'string' ? glyph : glyph);
    b.setAttribute('aria-label', label);
    b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onClick();
    });
    return b;
}

export function dims(w: number, h: number): string {
    return `${Math.round(w)} × ${Math.round(h)}`;
}

function scissors(): HTMLElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    for (const [cx, cy] of [[4, 12], [12, 12]] as const) {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', String(cx)); c.setAttribute('cy', String(cy)); c.setAttribute('r', '2');
        svg.append(c);
    }
    for (const d of ['M5.4 10.4 L11.2 2', 'M10.6 10.4 L4.8 2']) {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', d);
        svg.append(path);
    }
    const wrap = el('span', { className: 'codicon svg-icon' });
    wrap.setAttribute('aria-hidden', 'true');
    wrap.append(svg);
    return wrap;
}
