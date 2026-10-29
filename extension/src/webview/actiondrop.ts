import type { SceneObject } from '../protocol';
import { el } from './dom';
import { openMenu } from './menu';
import { S, send } from './state';
import { ghost, placed, stage, toImage } from './view';

// Dropping an action row of the Form tab on a tool bar of the canvas puts the action in it; on the menu bar it asks which menu.

export const ACTION_MIME = 'application/x-qdr-action';
export const draggedAction: { name: string | null } = { name: null };

/** The innermost tool bar or menu bar under a point of the form. */
function targetAt(x: number, y: number): SceneObject | undefined {
    return (S.snapshot?.objects ?? [])
        .filter((o) => (o.class.endsWith('ToolBar') || o.class.endsWith('MenuBar')) && x >= o.x && y >= o.y && x < o.x + o.w && y < o.y + o.h)
        .sort((a, b) => a.w * a.h - b.w * b.h)[0];
}

function mark(o: SceneObject | undefined): void {
    ghost.replaceChildren(...(o ? [placed(el('div', { className: 'ov drop-target' }), o)] : []));
    ghost.hidden = !o;
}

stage.addEventListener('dragover', (ev) => {
    if (!ev.dataTransfer?.types.includes(ACTION_MIME)) {
        return;
    }
    const p = toImage(ev);
    const target = p ? targetAt(p.x, p.y) : undefined;
    if (target) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'copy';
    }
    mark(target);
});

stage.addEventListener('dragleave', (ev) => {
    if (!stage.contains(ev.relatedTarget as Node | null)) {
        mark(undefined);
    }
});

stage.addEventListener('drop', (ev) => {
    const action = ev.dataTransfer?.getData(ACTION_MIME) || draggedAction.name;
    const p = toImage(ev);
    mark(undefined);
    const target = p ? targetAt(p.x, p.y) : undefined;
    if (!action || !target) {
        return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    const info = S.formInfo;
    if (target.class.endsWith('ToolBar')) {
        send({ type: 'useAction', target: target.name, action });
        return;
    }
    const menus = (info?.actionTargets ?? []).filter((t) => t.kind === 'menu');
    openMenu(ev.clientX, ev.clientY, menus.length > 0
        ? menus.map((m) => ({ label: `Add to ${m.title || m.name}`, icon: 'list-flat', run: () => send({ type: 'useAction', target: m.name, action }) }))
        : [{ label: 'No menu in this form', disabled: true }]);
});

document.addEventListener('dragend', () => {
    draggedAction.name = null;
    mark(undefined);
});
