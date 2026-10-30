import { el } from './dom';
import { byName, type Rect } from './geometry';
import { userGuides } from './rulers';
import { prefs, S } from './state';
import { placed, zoom } from './view';

/** Screen distance (px) under which an edge or centre snaps to a neighbour's. */
const SNAP_PX = 5;

/** Aligns the moving edges to the edges and centres of sibling widgets that are close enough. */
export function snapToSiblings(r: Rect, exclude: Set<string>, parent: string | null, edges: { l: boolean; r: boolean; t: boolean; b: boolean; move: boolean }): Rect {
    const pulled = prefs.rulers ? userGuides : { x: [], y: [] };
    if (!prefs.snapToWidgets && pulled.x.length + pulled.y.length === 0) {
        return r;
    }
    const thr = SNAP_PX / zoom();
    const sibs = !prefs.snapToWidgets ? [] : (S.snapshot?.objects ?? []).filter((o) => o.parent === parent && o.parent !== null && !exclude.has(o.name));
    let { x, y, w, h } = r;
    const near = (v: number, cands: number[]): number | undefined => {
        let best: number | undefined;
        for (const c of cands) {
            if (Math.abs(c - v) <= thr && (best === undefined || Math.abs(c - v) < Math.abs(best - v))) {
                best = c;
            }
        }
        return best;
    };
    const xs = [...sibs.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w]), ...pulled.x];
    const ys = [...sibs.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h]), ...pulled.y];
    if (edges.move) {
        const dxs = [near(x, xs), near(x + w / 2, xs), near(x + w, xs)].map((c, i) => (c === undefined ? undefined : c - (x + (w / 2) * i)));
        const dys = [near(y, ys), near(y + h / 2, ys), near(y + h, ys)].map((c, i) => (c === undefined ? undefined : c - (y + (h / 2) * i)));
        const bx = dxs.filter((d): d is number => d !== undefined).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
        const by = dys.filter((d): d is number => d !== undefined).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
        if (bx !== undefined) x += bx;
        if (by !== undefined) y += by;
        return { x, y, w, h };
    }
    if (edges.l) { const c = near(x, xs); if (c !== undefined) { w += x - c; x = c; } }
    if (edges.r) { const c = near(x + w, xs); if (c !== undefined) w = c - x; }
    if (edges.t) { const c = near(y, ys); if (c !== undefined) { h += y - c; y = c; } }
    if (edges.b) { const c = near(y + h, ys); if (c !== undefined) h = c - y; }
    return { x, y, w, h };
}

/** Alignment guides: lines where an edge or centre of the moved rectangle meets a sibling's. */
function guidesFor(r: Rect, exclude: Set<string>, parent: string | null): Rect[] {
    const out: Rect[] = [];
    const xs = [r.x, r.x + r.w / 2, r.x + r.w];
    const ys = [r.y, r.y + r.h / 2, r.y + r.h];
    for (const o of S.snapshot?.objects ?? []) {
        if (exclude.has(o.name) || o.parent === null || o.parent !== parent) {
            continue;
        }
        const oxs = [o.x, o.x + o.w / 2, o.x + o.w];
        const oys = [o.y, o.y + o.h / 2, o.y + o.h];
        for (const x of xs) {
            if (oxs.some((v) => Math.abs(v - x) < 0.5)) {
                const top = Math.min(r.y, o.y), bottom = Math.max(r.y + r.h, o.y + o.h);
                out.push({ x, y: top, w: 0, h: bottom - top });
            }
        }
        for (const y of ys) {
            if (oys.some((v) => Math.abs(v - y) < 0.5)) {
                const left = Math.min(r.x, o.x), right = Math.max(r.x + r.w, o.x + o.w);
                out.push({ x: left, y, w: right - left, h: 0 });
            }
        }
    }
    return out;
}

/** Distances to the nearest neighbours (or the parent's edge) on each side, like a measuring tape. */
export function measureNodes(r: Rect, exclude: Set<string>, parent: string | null): HTMLElement[] {
    const s = S.snapshot;
    const par = byName(parent);
    if (!s || !par) {
        return [];
    }
    const z = zoom();
    const sibs = s.objects.filter((o) => o.parent === parent && !exclude.has(o.name));
    const overlapY = (o: Rect) => o.y < r.y + r.h && r.y < o.y + o.h;
    const overlapX = (o: Rect) => o.x < r.x + r.w && r.x < o.x + o.w;
    const nodes: HTMLElement[] = [];
    const line = (x1: number, y1: number, x2: number, y2: number, gap: number) => {
        if (gap <= 0) {
            return;
        }
        const horizontal = y1 === y2;
        const l = placed(el('div', { className: `ov measure ${horizontal ? 'h' : 'v'}` }), {
            x: Math.min(x1, x2), y: Math.min(y1, y2), w: horizontal ? Math.abs(x2 - x1) : 1 / z, h: horizontal ? 1 / z : Math.abs(y2 - y1),
        });
        nodes.push(l);
        const t = el('div', { className: 'tag measure' }, String(Math.round(gap)));
        t.style.left = `${((x1 + x2) / 2) * z - 10}px`;
        t.style.top = `${((y1 + y2) / 2) * z - 9}px`;
        nodes.push(t);
    };
    const my = r.y + r.h / 2, mx = r.x + r.w / 2;
    const left = Math.max(par.x, ...sibs.filter((o) => overlapY(o) && o.x + o.w <= r.x).map((o) => o.x + o.w));
    const right = Math.min(par.x + par.w, ...sibs.filter((o) => overlapY(o) && o.x >= r.x + r.w).map((o) => o.x));
    const top = Math.max(par.y, ...sibs.filter((o) => overlapX(o) && o.y + o.h <= r.y).map((o) => o.y + o.h));
    const bottom = Math.min(par.y + par.h, ...sibs.filter((o) => overlapX(o) && o.y >= r.y + r.h).map((o) => o.y));
    if (r.x >= left) line(left, my, r.x, my, r.x - left);
    if (right >= r.x + r.w) line(r.x + r.w, my, right, my, right - (r.x + r.w));
    if (r.y >= top) line(mx, top, mx, r.y, r.y - top);
    if (bottom >= r.y + r.h) line(mx, r.y + r.h, mx, bottom, bottom - (r.y + r.h));
    return nodes;
}

export function guideNodes(rect: Rect, exclude: Set<string>, parent: string | null): HTMLElement[] {
    const z = zoom();
    return guidesFor(rect, exclude, parent).map((gd) => placed(el('div', { className: `ov guide ${gd.w === 0 ? 'v' : 'h'}` }), { x: gd.x, y: gd.y, w: gd.w === 0 ? 1 / z : gd.w, h: gd.h === 0 ? 1 / z : gd.h }));
}
