import { $, el } from './dom';
import { primarySelection } from './geometry';
import { prefs, S, send } from './state';

const stage = $<HTMLDivElement>('stage');
let editor: HTMLElement | null = null;

/** Properties that carry the visible text of a widget, in order of preference. */
const TEXT_PROPERTIES = ['text', 'title', 'plainText', 'placeholderText', 'windowTitle'];

export function textProperty(): { name: string; value: string } | undefined {
    const props = S.properties?.properties;
    if (!props || !S.propertiesFor) {
        return undefined;
    }
    for (const name of TEXT_PROPERTIES) {
        const p = props.find((x) => x.name === name && x.kind === 'string' && x.enabled);
        if (p) {
            return { name, value: String(p.value) };
        }
    }
    return undefined;
}

export function editableText(): boolean {
    const o = primarySelection();
    return !!o && o.parent !== null && S.snapshot?.selection.length === 1 && textProperty() !== undefined;
}

export function closeInplace(): void {
    // Detach first: removing a focused input fires blur, whose handler closes the editor again.
    const e = editor;
    editor = null;
    document.body.classList.remove('inplace-open');
    e?.remove();
}

export function inplaceOpen(): boolean {
    return editor !== null;
}

let pendingEdit: string | null = null;

/** Double-clicking an unselected widget selects it first; the edit opens once its properties have arrived. */
export function editTextWhenReady(name: string): void {
    pendingEdit = name;
    send({ type: 'selectNames', names: [name] });
}

export function runPendingEdit(): void {
    if (pendingEdit && S.propertiesFor === pendingEdit) {
        pendingEdit = null;
        if (editableText()) {
            editText();
        }
    }
}

/** An input right over the widget, like Designer's in-place edit; Enter applies, Escape cancels. */
export function editText(): void {
    const o = primarySelection();
    const tp = textProperty();
    if (!o || !tp || !S.propertiesFor) {
        return;
    }
    openEditor(S.propertiesFor, tp, o, `Edit ${tp.name} of ${o.name}`, tp.name === 'plainText' || tp.value.includes('\n'));
}

/** The title of the current tab, edited right over its header. */
export function editTabTitle(rect: { x: number; y: number; w: number; h: number }, property = 'currentTabText'): void {
    const p = S.properties?.properties.find((x) => x.name === property && x.kind === 'string' && x.enabled);
    if (!p || !S.propertiesFor) {
        return;
    }
    openEditor(S.propertiesFor, { name: property, value: String(p.value) }, rect, `Edit the tab title of ${S.propertiesFor}`, false);
}

function openEditor(target: string, tp: { name: string; value: string }, at: { x: number; y: number; w: number; h: number }, label: string, multi: boolean): void {
    closeInplace();
    const z = prefs.zoom;
    const input = multi ? el('textarea', { value: tp.value }) : el('input', { type: 'text', value: tp.value });
    input.className = 'inplace';
    input.setAttribute('aria-label', label);
    const box = { left: at.x * z, top: at.y * z, width: Math.max(at.w * z, 80), height: Math.max(at.h * z, 24) };
    // Exactly over the widget (its size, its zoom), with the floating toolbar out of the way.
    Object.assign(input.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: multi ? `${Math.max(box.height, 60)}px` : `${box.height}px`, fontSize: `${Math.min(24, Math.max(11, 13 * z))}px` });
    editor = input;
    document.body.classList.add('inplace-open');
    stage.append(input);
    let done = false;
    const finish = (apply: boolean) => {
        if (done) {
            return;
        }
        done = true;
        const v = input.value;
        closeInplace();
        if (apply && v !== tp.value) {
            send({ type: 'setProperty', name: target, property: tp.name, value: v });
        }
    };
    input.addEventListener('keydown', (ev) => {
        const e = ev as KeyboardEvent;
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
        } else if (e.key === 'Enter' && (!multi || e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            finish(true);
        }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    input.addEventListener('dblclick', (ev) => ev.stopPropagation());
    input.focus();
    (input as HTMLInputElement).select();
}
