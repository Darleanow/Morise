import type { FontValue, PropertyInfo, SizePolicyValue } from '../protocol';
import { button, el, icon } from './dom';
import { S } from './state';

/** What an editor can ask the inspector to do. */
export interface EditorContext {
    commit(p: PropertyInfo, value: unknown): void;
    pickFile(p: PropertyInfo): void;
    multiline(p: PropertyInfo, current: string): void;
    rerender(): void;
    menu(anchor: HTMLElement, items: { label: string; run: () => void }[]): void;
}

const openFlagLists = new Set<string>();

const MULTILINE_NAMES = new Set(['styleSheet', 'toolTip', 'whatsThis', 'statusTip', 'plainText', 'html', 'accessibleDescription']);

/** Properties that need a block (label above, editor below) instead of a label/editor pair. */
export function isBlock(p: PropertyInfo): boolean {
    return ['rect', 'size', 'point', 'rectf', 'sizef', 'pointf', 'sizePolicy', 'font', 'flags', 'stringlist'].includes(p.kind);
}

function numberInput(value: number, step: string, onChange: (v: number) => void, enabled: boolean, label?: string): HTMLInputElement {
    const input = el('input', { type: 'number', value: String(value), disabled: !enabled });
    input.step = step;
    if (label) {
        input.setAttribute('aria-label', label);
    }
    input.addEventListener('change', () => {
        const v = Number(input.value);
        if (Number.isFinite(v)) {
            onChange(v);
        }
    });
    return input;
}

function labelled(label: string, input: HTMLElement): HTMLElement {
    return el('label', {}, el('span', {}, label), input);
}

export function multiEditor(p: PropertyInfo, ctx: EditorContext): HTMLElement {
    const values = Array.isArray(p.value) ? [...(p.value as number[])] : [];
    const isF = p.kind === 'rectf' || p.kind === 'sizef' || p.kind === 'pointf';
    const labels = p.kind === 'rect' || p.kind === 'rectf' ? ['x', 'y', 'w', 'h'] : p.kind === 'size' || p.kind === 'sizef' ? ['w', 'h'] : ['x', 'y'];
    const wrap = el('div', { className: `multi${labels.length === 2 ? ' two' : ''}` });
    labels.forEach((label, i) => {
        const input = numberInput(values[i] ?? 0, isF ? 'any' : '1', (v) => {
            values[i] = isF ? v : Math.trunc(v);
            ctx.commit(p, values);
        }, p.enabled, `${p.name} ${label}`);
        wrap.append(labelled(label, input));
    });
    return wrap;
}

function segmented(items: { key: string; label: string; icon: string }[], active: (k: string) => boolean, onPick: (k: string) => void, enabled: boolean): HTMLElement {
    const group = el('div', { className: 'segmented', role: 'group' });
    for (const it of items) {
        const b = button(it.label, icon(it.icon), () => onPick(it.key), 'seg');
        b.setAttribute('aria-pressed', String(active(it.key)));
        b.disabled = !enabled;
        group.append(b);
    }
    return group;
}

const H_FLAGS = ['AlignLeft', 'AlignLeading', 'AlignHCenter', 'AlignRight', 'AlignTrailing', 'AlignJustify'];
const V_FLAGS = ['AlignTop', 'AlignVCenter', 'AlignBottom', 'AlignBaseline'];

/** Horizontal and vertical alignment as two rows of buttons instead of a flags list. */
function alignmentEditor(p: PropertyInfo, ctx: EditorContext): HTMLElement {
    const value = new Set((p.value as string[]).map((f) => f.replace(/^Qt::(AlignmentFlag::)?/, '')));
    const has = (k: string) => value.has(k) || (k === 'AlignLeft' && value.has('AlignLeading') && !value.has('AlignRight') && !value.has('AlignHCenter') && !value.has('AlignJustify'))
        || (k === 'AlignRight' && value.has('AlignTrailing'));
    const set = (group: string[], key: string, active: boolean) => {
        const next = [...value].filter((f) => !group.includes(f));
        // Clicking the button that is already on clears that axis.
        if (!active) {
            next.push(key);
        }
        ctx.commit(p, next);
    };
    const enabled = p.enabled;
    return el('div', { className: 'align-editor' },
        segmented([
            { key: 'AlignLeft', label: 'Align left', icon: 'text-left' }, { key: 'AlignHCenter', label: 'Center horizontally', icon: 'text-center' },
            { key: 'AlignRight', label: 'Align right', icon: 'text-right' }, { key: 'AlignJustify', label: 'Justify', icon: 'text-justify' },
        ], has, (k) => set(H_FLAGS, k, has(k)), enabled),
        segmented([
            { key: 'AlignTop', label: 'Align top', icon: 'v-top' }, { key: 'AlignVCenter', label: 'Center vertically', icon: 'v-middle' },
            { key: 'AlignBottom', label: 'Align bottom', icon: 'v-bottom' }, { key: 'AlignBaseline', label: 'Align to baseline', icon: 'v-baseline' },
        ], (k) => value.has(k), (k) => set(V_FLAGS, k, value.has(k)), enabled));
}

function flagsEditor(p: PropertyInfo, ctx: EditorContext): HTMLElement {
    if (p.name === 'alignment') {
        return alignmentEditor(p, ctx);
    }
    const value = new Set((p.value as string[]).map((f) => f.replace(/^Qt::(\w+Flag::)?/, '')));
    const choices = (p.choices ?? []).filter((c) => !/Mask$/.test(c));
    const open = openFlagLists.has(p.name);
    const summary = [...value].join(' | ') || 'none';
    const head = el('button', { type: 'button', className: 'flags-head', title: summary, disabled: !p.enabled }, icon(open ? 'chevron-down' : 'chevron-right'), el('span', {}, summary));
    head.addEventListener('click', () => {
        if (openFlagLists.has(p.name)) {
            openFlagLists.delete(p.name);
        } else {
            openFlagLists.add(p.name);
        }
        ctx.rerender();
    });
    const wrap = el('div', { className: 'flags' }, head);
    if (open) {
        for (const c of choices) {
            const cb = el('input', { type: 'checkbox', checked: value.has(c), disabled: !p.enabled });
            cb.addEventListener('change', () => {
                const next = new Set(value);
                if (cb.checked) {
                    next.add(c);
                } else {
                    next.delete(c);
                }
                ctx.commit(p, [...next]);
            });
            wrap.append(el('label', { className: 'flag' }, cb, c));
        }
    }
    return wrap;
}

function sizePolicyEditor(p: PropertyInfo, ctx: EditorContext): HTMLElement {
    const v = p.value as SizePolicyValue;
    const make = (key: 'h' | 'v') => {
        const sel = el('select', { disabled: !p.enabled });
        for (const c of p.choices ?? []) {
            sel.append(el('option', { value: c, selected: c === v[key] }, c));
        }
        sel.setAttribute('aria-label', `${p.name} ${key === 'h' ? 'horizontal' : 'vertical'} policy`);
        sel.addEventListener('change', () => ctx.commit(p, { ...v, [key]: sel.value }));
        return sel;
    };
    const stretch = (key: 'hs' | 'vs') => numberInput(v[key], '1', (n) => ctx.commit(p, { ...v, [key]: Math.max(0, Math.min(255, Math.trunc(n))) }), p.enabled, `${p.name} ${key === 'hs' ? 'horizontal' : 'vertical'} stretch`);
    return el('div', { className: 'sizepolicy' },
        labelled('H', make('h')), labelled('V', make('v')), labelled('hStretch', stretch('hs')), labelled('vStretch', stretch('vs')));
}

function fontEditor(p: PropertyInfo, ctx: EditorContext): HTMLElement {
    const f = p.value as FontValue;
    const family = el('input', { type: 'text', value: f.family, disabled: !p.enabled });
    family.setAttribute('list', 'font-families');
    family.setAttribute('aria-label', `${p.name} family`);
    family.addEventListener('change', () => ctx.commit(p, { ...f, family: family.value }));
    if (!document.getElementById('font-families')) {
        const dl = el('datalist', { id: 'font-families' });
        for (const name of S.fonts.slice(0, 600)) {
            dl.append(el('option', { value: name }));
        }
        document.body.append(dl);
    }
    const size = numberInput(f.pointSize, '1', (n) => ctx.commit(p, { ...f, pointSize: Math.max(1, Math.trunc(n)) }), p.enabled, `${p.name} size`);
    const toggle = (key: 'bold' | 'italic' | 'underline' | 'strikeOut', label: string, glyph: string) => {
        const b = el('button', { type: 'button', className: 'seg', title: label, disabled: !p.enabled }, glyph);
        b.setAttribute('aria-label', label);
        b.setAttribute('aria-pressed', String(f[key]));
        b.addEventListener('click', () => ctx.commit(p, { ...f, [key]: !f[key] }));
        return b;
    };
    const style = el('div', { className: 'segmented font-style' }, toggle('bold', 'Bold', 'B'), toggle('italic', 'Italic', 'I'), toggle('underline', 'Underline', 'U'), toggle('strikeOut', 'Strike out', 'S'));
    (style.children[0] as HTMLElement).style.fontWeight = '700';
    (style.children[1] as HTMLElement).style.fontStyle = 'italic';
    (style.children[2] as HTMLElement).style.textDecoration = 'underline';
    (style.children[3] as HTMLElement).style.textDecoration = 'line-through';
    return el('div', { className: 'font-editor' }, family, el('div', { className: 'font-row' }, size, el('span', { className: 'dim' }, 'pt'), style));
}

function imageEditor(p: PropertyInfo, ctx: EditorContext): HTMLElement {
    const path = String(p.value ?? '');
    const thumb = p.thumb ? el('img', { className: 'thumb', src: p.thumb, alt: '' }) : el('span', { className: 'thumb empty' }, icon('file-media'));
    const name = el('span', { className: 'file-name', title: path || 'No image' }, path ? (path.split(/[\\/]/).pop() ?? path) : 'None');
    const pick = button('Choose an image', icon('folder-opened'), () => ctx.pickFile(p), 'icon-btn');
    const clear = button('Remove the image', icon('close'), () => ctx.commit(p, ''), 'icon-btn');
    clear.disabled = path === '' || !p.enabled;
    pick.disabled = !p.enabled;
    const entries = (S.formInfo?.resources ?? []).flatMap((f) => f.prefixes.flatMap((pre) => pre.files.map((file) => `:${pre.prefix.replace(/\/$/, '')}/${file}`)));
    const fromRes = button('Choose from the form’s resources', icon('package'), () => {
        const menu = entries.map((e) => ({ label: e, run: () => ctx.commit(p, e) }));
        ctx.menu(fromRes, menu);
    }, 'icon-btn');
    fromRes.disabled = !p.enabled || entries.length === 0;
    return el('div', { className: 'image-editor' }, thumb, name, pick, fromRes, clear);
}

function colorEditor(p: PropertyInfo, ctx: EditorContext): HTMLElement {
    const v = String(p.value);
    const hasAlpha = /^#[0-9a-fA-F]{8}$/.test(v);
    const alpha = hasAlpha ? v.slice(1, 3) : 'ff';
    const rgb = hasAlpha ? `#${v.slice(3)}` : v;
    const input = el('input', { type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(rgb) ? rgb : '#000000', disabled: !p.enabled });
    input.addEventListener('change', () => ctx.commit(p, `#${alpha}${input.value.slice(1)}`));
    return el('div', { className: 'color-editor' }, input, el('code', {}, v));
}

/** A label's buddy is another widget of the form: pick it from a list instead of typing its name. */
function buddyEditor(p: PropertyInfo, ctx: EditorContext): HTMLElement {
    const current = String(p.value);
    const select = el('select', { disabled: !p.enabled });
    const names = (S.snapshot?.objects ?? []).filter((o) => o.parent !== null && o.name !== S.propertiesFor).map((o) => o.name);
    for (const n of ['', ...(current && !names.includes(current) ? [current] : []), ...names]) {
        select.append(el('option', { value: n, selected: n === current }, n === '' ? '(none)' : n));
    }
    select.setAttribute('aria-label', 'Buddy widget');
    select.addEventListener('change', () => ctx.commit(p, select.value));
    return select;
}

export function editorFor(p: PropertyInfo, ctx: EditorContext): HTMLElement {
    const enabled = p.enabled;
    switch (p.kind) {
        case 'string': {
            if (p.name === 'buddy') {
                return buddyEditor(p, ctx);
            }
            const text = String(p.value);
            const input = el('input', { type: 'text', value: text.includes('\n') ? text.split('\n')[0] + ' ↵…' : text, disabled: !enabled || text.includes('\n') });
            input.addEventListener('change', () => ctx.commit(p, input.value));
            if (!(MULTILINE_NAMES.has(p.name) || text.includes('\n'))) {
                return input;
            }
            const expand = button(`Edit ${p.name} in a larger editor`, icon('edit'), () => ctx.multiline(p, text), 'icon-btn');
            expand.disabled = !p.enabled;
            return el('div', { className: 'with-button' }, input, expand);
        }
        case 'bool': {
            const input = el('input', { type: 'checkbox', checked: p.value === true, disabled: !enabled });
            input.addEventListener('change', () => ctx.commit(p, input.checked));
            return input;
        }
        case 'int':
            return numberInput(Number(p.value), '1', (v) => ctx.commit(p, Math.trunc(v)), enabled);
        case 'double':
            return numberInput(Number(p.value), 'any', (v) => ctx.commit(p, v), enabled);
        case 'enum': {
            const select = el('select', { disabled: !enabled });
            for (const c of p.choices ?? []) {
                select.append(el('option', { value: c, selected: c === p.value }, c));
            }
            select.addEventListener('change', () => ctx.commit(p, select.value));
            return select;
        }
        case 'flags': return flagsEditor(p, ctx);
        case 'sizePolicy': return sizePolicyEditor(p, ctx);
        case 'font': return fontEditor(p, ctx);
        case 'icon':
        case 'pixmap': return imageEditor(p, ctx);
        case 'color': return colorEditor(p, ctx);
        case 'rect': case 'size': case 'point': case 'rectf': case 'sizef': case 'pointf': return multiEditor(p, ctx);
        case 'stringlist': {
            const ta = el('textarea', { rows: 3, value: (p.value as string[]).join('\n'), disabled: !enabled });
            ta.setAttribute('aria-label', `${p.name}, one entry per line`);
            ta.addEventListener('change', () => ctx.commit(p, ta.value.split('\n').filter((l) => l.length > 0)));
            return ta;
        }
        case 'keysequence': {
            const input = el('input', { type: 'text', value: String(p.value), placeholder: 'Ctrl+S', disabled: !enabled });
            input.addEventListener('change', () => ctx.commit(p, input.value));
            return input;
        }
        case 'date': case 'time': case 'datetime': {
            const type = p.kind === 'date' ? 'date' : p.kind === 'time' ? 'time' : 'datetime-local';
            const input = el('input', { type, value: String(p.value), disabled: !enabled });
            if (p.kind !== 'date') {
                input.step = '1';
            }
            input.addEventListener('change', () => ctx.commit(p, input.value));
            return input;
        }
        case 'url': {
            const input = el('input', { type: 'text', value: String(p.value), disabled: !enabled });
            input.addEventListener('change', () => ctx.commit(p, input.value));
            return input;
        }
        default: {
            const text = String(Array.isArray(p.value) ? (p.value as unknown[]).join(', ') : p.value);
            return el('span', { className: 'readonly', title: p.typeName ? `Type ${p.typeName}: not editable yet` : 'not editable here' }, text || '—');
        }
    }
}
