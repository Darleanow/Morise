import type { SceneObject } from '../protocol';
import { byName } from './geometry';
import { S, send } from './state';

export type AlignOp =
    | 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
    | 'distributeH' | 'distributeV' | 'sameWidth' | 'sameHeight' | 'sameSize';

export interface AlignDef { op: AlignOp; label: string; icon: string; needs: number }

export const ALIGNMENTS: AlignDef[] = [
    { op: 'left', label: 'Align Left', icon: 'align-left', needs: 1 },
    { op: 'hcenter', label: 'Align Horizontal Centers', icon: 'align-hcenter', needs: 1 },
    { op: 'right', label: 'Align Right', icon: 'align-right', needs: 1 },
    { op: 'top', label: 'Align Top', icon: 'align-top', needs: 1 },
    { op: 'vcenter', label: 'Align Vertical Centers', icon: 'align-vcenter', needs: 1 },
    { op: 'bottom', label: 'Align Bottom', icon: 'align-bottom', needs: 1 },
    { op: 'distributeH', label: 'Distribute Horizontally', icon: 'distribute-h', needs: 3 },
    { op: 'distributeV', label: 'Distribute Vertically', icon: 'distribute-v', needs: 3 },
    { op: 'sameWidth', label: 'Same Width', icon: 'same-width', needs: 2 },
    { op: 'sameHeight', label: 'Same Height', icon: 'same-height', needs: 2 },
    { op: 'sameSize', label: 'Same Size', icon: 'same-size', needs: 2 },
];

/** Widgets whose geometry can be set: selected, not the form, not owned by a layout, and sharing one parent. */
export function alignable(): SceneObject[] {
    const s = S.snapshot;
    if (!s) {
        return [];
    }
    const picked = s.selection.map((n) => byName(n)).filter((o): o is SceneObject => !!o && o.parent !== null && !o.laidOut);
    const parent = picked[0]?.parent;
    return picked.filter((o) => o.parent === parent);
}

export function canAlign(def: AlignDef): boolean {
    return alignable().length >= def.needs;
}

interface Box { x: number; y: number; w: number; h: number }

/** Where each widget goes, in its parent's coordinates. The first selected widget is the reference for sizes. */
export function planAlignment(op: AlignOp, targets: SceneObject[], parentSize: { w: number; h: number }): { name: string; rect: number[] }[] {
    const local = (o: SceneObject): Box => ({ x: o.x - o.gx, y: o.y - o.gy, w: o.w, h: o.h });
    const boxes = targets.map(local);
    // One widget aligns to its parent; several align to the bounds of the selection.
    const bounds: Box = targets.length === 1
        ? { x: 0, y: 0, w: parentSize.w, h: parentSize.h }
        : (() => {
            const x1 = Math.min(...boxes.map((b) => b.x)), y1 = Math.min(...boxes.map((b) => b.y));
            const x2 = Math.max(...boxes.map((b) => b.x + b.w)), y2 = Math.max(...boxes.map((b) => b.y + b.h));
            return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        })();
    const ref = boxes[0] as Box;
    const out = boxes.map((b) => ({ ...b }));

    switch (op) {
        case 'left': out.forEach((b) => { b.x = bounds.x; }); break;
        case 'right': out.forEach((b) => { b.x = bounds.x + bounds.w - b.w; }); break;
        case 'hcenter': out.forEach((b) => { b.x = Math.round(bounds.x + (bounds.w - b.w) / 2); }); break;
        case 'top': out.forEach((b) => { b.y = bounds.y; }); break;
        case 'bottom': out.forEach((b) => { b.y = bounds.y + bounds.h - b.h; }); break;
        case 'vcenter': out.forEach((b) => { b.y = Math.round(bounds.y + (bounds.h - b.h) / 2); }); break;
        case 'sameWidth': out.forEach((b) => { b.w = ref.w; }); break;
        case 'sameHeight': out.forEach((b) => { b.h = ref.h; }); break;
        case 'sameSize': out.forEach((b) => { b.w = ref.w; b.h = ref.h; }); break;
        case 'distributeH':
        case 'distributeV': {
            const horizontal = op === 'distributeH';
            const key = horizontal ? 'x' : 'y';
            const size = horizontal ? 'w' : 'h';
            const order = out.map((b, i) => ({ b, i })).sort((p, q) => p.b[key] - q.b[key]);
            const first = order[0]?.b as Box, last = order[order.length - 1]?.b as Box;
            const total = last[key] + last[size] - first[key];
            const used = order.reduce((n, e) => n + e.b[size], 0);
            const gap = (total - used) / (order.length - 1);
            let at = first[key];
            for (const e of order) {
                e.b[key] = Math.round(at);
                at += e.b[size] + gap;
            }
            break;
        }
    }
    return targets.map((t, i) => ({ name: t.name, rect: [(out[i] as Box).x, (out[i] as Box).y, (out[i] as Box).w, (out[i] as Box).h] }))
        .filter((item, i) => {
            const b = boxes[i] as Box;
            return item.rect[0] !== b.x || item.rect[1] !== b.y || item.rect[2] !== b.w || item.rect[3] !== b.h;
        });
}

/** Runs an alignment as one undo step. */
export function runAlignment(op: AlignOp): void {
    const targets = alignable();
    const def = ALIGNMENTS.find((a) => a.op === op);
    if (!def || targets.length < def.needs) {
        return;
    }
    const parent = byName(targets[0]?.parent);
    const items = planAlignment(op, targets, { w: parent?.w ?? 0, h: parent?.h ?? 0 });
    if (items.length === 0) {
        return;
    }
    send({ type: 'gesture', phase: 'begin', label: def.label });
    send({ type: 'setGeometries', items });
    send({ type: 'gesture', phase: 'end', label: '' });
}
