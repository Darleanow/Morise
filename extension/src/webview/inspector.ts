import type { ConnectionInfo, MenuEntry, MenuInfo, MethodInfo, PropertyInfo } from '../protocol';
import { $, button, dims, el, icon } from './dom';
import { classGlyph, renderOverlay } from './canvas';
import { openConnectDialog } from './connectdialog';
import { openMenu } from './menu';
import { openAddDynamicProperty, openPrompt, openTextEditor } from './dialogs';
import { openGridEditor } from './gridedit';
import { editorFor, isBlock, type EditorContext } from './editors';
import { renderFormTab } from './formtab';
import { byName, onlyFormSelected, primarySelection, rootObject } from './geometry';
import { copyText, prefs, S, savePrefs, send, type RightTab } from './state';

const headEl = $<HTMLElement>('inspector-head');
const tabsEl = $<HTMLDivElement>('tabs');
const propsEl = $<HTMLDivElement>('props');
const filterEl = $<HTMLInputElement>('filter');
const changedBtn = $<HTMLButtonElement>('changed-only');
const codeEl = $<HTMLDivElement>('code');
const connEl = $<HTMLDivElement>('connections');
const panels: Record<RightTab, HTMLElement> = {
    properties: $('panel-properties'),
    code: $('panel-code'),
    connections: $('panel-connections'),
    form: $('panel-form'),
};

const collapsedGroups = new Set<string>();
const openOwners = new Set<string>();
let connectionsOfSelection = true;

// ---- header and tabs --------------------------------------------------------------------

function inspected(): { name: string; isLayout: boolean } | undefined {
    const name = S.propertiesFor;
    return name ? { name, isLayout: S.properties?.isLayout === true } : undefined;
}

function renderHeader(): void {
    const target = inspected();
    const o = target && !target.isLayout ? byName(target.name) : primarySelection();
    if (!target || !S.snapshot) {
        headEl.replaceChildren(el('div', { className: 'head-empty' }, 'Nothing selected'));
        return;
    }
    if (target.isLayout) {
        headEl.replaceChildren(
            icon('layout'),
            el('div', { className: 'head-text' }, el('b', { title: target.name }, target.name), el('span', { className: 'dim' }, `${S.properties?.class ?? 'Layout'} · layout`)),
            el('span', { className: 'spacer' }),
            button('Back to the selected widget', icon('close'), () => send({ type: 'inspect', name: null }), 'icon-btn'));
        return;
    }
    if (!o) {
        // An object that is not a widget of the form, such as the action behind a menu entry.
        headEl.replaceChildren(
            icon('symbol-event'),
            el('div', { className: 'head-text' }, el('b', { title: target.name }, target.name), el('span', { className: 'dim' }, S.properties?.class ?? 'Object')),
            el('span', { className: 'spacer' }),
            button('Back to the selected widget', icon('close'), () => send({ type: 'inspect', name: null }), 'icon-btn'));
        return;
    }
    const count = S.snapshot.selection.length;
    headEl.replaceChildren(
        classGlyph(o),
        el('div', { className: 'head-text' }, el('b', { title: o.name }, o.name), el('span', { className: 'dim', title: S.code?.class ?? o.class }, S.code?.class ?? o.class)),
        count > 1 ? el('span', { className: 'chip static', title: 'Edits apply to every selected widget' }, `+${count - 1} more`) : '',
        el('span', { className: 'spacer' }),
        el('span', { className: 'dim size' }, dims(o.w, o.h)));
}

function renderTabs(): void {
    const defs: { id: RightTab; label: string; icon: string; badge?: number }[] = [
        { id: 'properties', label: 'Properties', icon: 'settings-gear', badge: S.properties?.properties.filter((p) => p.changed).length },
        { id: 'code', label: 'Code', icon: 'code' },
        { id: 'connections', label: 'Connections', icon: 'plug', badge: S.connections.length },
        { id: 'form', label: 'Form', icon: 'symbol-ruler' },
    ];
    tabsEl.replaceChildren(...defs.map((d) => {
        const t = el('button', { type: 'button', className: `tab${prefs.rightTab === d.id ? ' active' : ''}`, role: 'tab', title: d.label }, icon(d.icon), el('span', { className: 'label' }, d.label));
        if (d.badge) {
            t.append(el('span', { className: 'badge' }, String(d.badge)));
        }
        t.setAttribute('aria-selected', String(prefs.rightTab === d.id));
        t.addEventListener('click', () => setTab(d.id));
        return t;
    }));
    for (const id of Object.keys(panels) as RightTab[]) {
        panels[id].hidden = id !== prefs.rightTab;
    }
}

export function setTab(tab: RightTab): void {
    prefs.rightTab = tab;
    savePrefs();
    renderTabs();
    syncWants();
    renderOverlay();
    if (tab === 'form') {
        renderFormTab();
    }
}

/** The form tab needs data the other tabs do not: tell the host to include it. */
let lastWants = '';

export function syncWants(): void {
    // The icon editor offers the form's resources, so it needs the form info as well.
    const images = !!S.properties?.properties.some((p) => p.kind === 'icon' || p.kind === 'pixmap');
    const wants = { tabOrder: prefs.rightTab === 'form', formInfo: prefs.rightTab === 'form' || images };
    const key = JSON.stringify(wants);
    if (key !== lastWants) {
        lastWants = key;
        send({ type: 'want', ...wants });
    }
}

// ---- properties -------------------------------------------------------------------------

/** Edits go to every selected widget when the inspected one is part of a multi-selection. */
function targetNames(): string[] {
    const sel = S.snapshot?.selection ?? [];
    return S.propertiesFor && sel.length > 1 && sel.includes(S.propertiesFor) ? sel : S.propertiesFor ? [S.propertiesFor] : [];
}

const context: EditorContext = {
    commit(p, value) {
        const names = targetNames();
        if (!S.propertiesFor) {
            return;
        }
        send(names.length > 1
            ? { type: 'setProperty', name: S.propertiesFor, names, property: p.name, value }
            : { type: 'setProperty', name: S.propertiesFor, property: p.name, value });
    },
    pickFile(p) {
        if (S.propertiesFor) {
            send({ type: 'pickFile', name: S.propertiesFor, property: p.name });
        }
    },
    multiline(p, current) {
        openTextEditor(`${S.propertiesFor ?? ''} · ${p.name}`, current, (v) => context.commit(p, v));
    },
    rerender: () => renderProperties(),
    menu(anchor, items) {
        const r = anchor.getBoundingClientRect();
        openMenu(r.left, r.bottom + 2, items);
    },
};

function resetButton(p: PropertyInfo): HTMLElement {
    if (p.dynamic) {
        return button(`Remove dynamic property ${p.name}`, icon('trash'), () => {
            if (S.propertiesFor) {
                send({ type: 'removeDynamicProperty', name: S.propertiesFor, property: p.name });
            }
        }, 'reset');
    }
    // Alignment keeps its reset button even when the engine calls the value unchanged: it is also the way back
    // to the default after clearing an axis.
    if (!(p.resettable && (p.changed || p.name === 'alignment'))) {
        return el('span');
    }
    return button(`Reset ${p.name}`, icon('discard'), () => {
        if (S.propertiesFor) {
            send({ type: 'resetProperty', name: S.propertiesFor, property: p.name });
        }
    }, 'reset');
}

function groupHeader(key: string, open: boolean, count: number): HTMLElement {
    const head = el('div', { className: 'group', role: 'button', tabIndex: 0 }, icon(open ? 'chevron-down' : 'chevron-right'), key, el('span', { className: 'dim count' }, String(count)));
    head.setAttribute('aria-expanded', String(open));
    const toggle = () => {
        if (collapsedGroups.has(key)) {
            collapsedGroups.delete(key);
        } else {
            collapsedGroups.add(key);
        }
        renderProperties();
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            toggle();
        }
    });
    return head;
}

/** Captions of a combo box or list widget: edit, add, remove and reorder, as one undo step per change. */
function itemsEditor(items: string[]): HTMLElement {
    const target = S.propertiesFor;
    const commit = (next: string[]) => {
        if (target) {
            send({ type: 'setItems', name: target, items: next });
        }
    };
    const box = el('div', { className: 'items-editor' });
    items.forEach((text, i) => {
        const input = el('input', { type: 'text', value: text });
        input.setAttribute('aria-label', `Item ${i + 1}`);
        input.addEventListener('change', () => commit(items.map((t, j) => (j === i ? input.value : t))));
        const move = (d: number) => {
            const next = [...items];
            const [x] = next.splice(i, 1);
            next.splice(i + d, 0, x as string);
            commit(next);
        };
        const up = button('Move up', icon('arrow-up'), () => move(-1), 'icon-btn');
        up.disabled = i === 0;
        const down = button('Move down', icon('arrow-down'), () => move(1), 'icon-btn');
        down.disabled = i === items.length - 1;
        box.append(el('div', { className: 'item-row' }, input, up, down, button('Remove item', icon('trash'), () => commit(items.filter((_, j) => j !== i)), 'icon-btn')));
    });
    const add = el('button', { type: 'button', className: 'add-dynamic' }, icon('add'), 'Add item');
    add.addEventListener('click', () => commit([...items, `Item ${items.length + 1}`]));
    box.append(add);
    return box;
}

function flatCount(items: { children: unknown[] }[]): number {
    return items.reduce((n, i) => n + 1 + flatCount(i.children as { children: unknown[] }[]), 0);
}

/** The menus of a menu bar: add, remove and open the entries (their action opens in the inspector). */
function menusEditor(menus: MenuInfo[]): HTMLElement {
    const box = el('div', { className: 'items-editor menus-editor' });
    const entryRow = (menu: string, e: MenuEntry, index: number, depth: number): HTMLElement[] => {
        const label = e.separator ? el('span', { className: 'dim' }, '— separator —') : el('button', { type: 'button', className: 'link-btn', title: `Edit the properties of ${e.name}` }, e.text || e.name);
        if (!e.separator) {
            label.addEventListener('click', () => send({ type: 'inspect', name: e.name }));
        }
        const row = el('div', { className: 'item-row', style: undefined }, label, el('span', { className: 'spacer' }), depth === 0
            ? button('Remove entry', icon('trash'), () => send({ type: 'removeMenuEntry', menu, index }), 'icon-btn') : '');
        row.style.paddingLeft = `${depth * 14}px`;
        return [row, ...(e.entries ?? []).flatMap((c, i) => entryRow(e.menu ?? menu, c, i, depth + 1))];
    };
    for (const m of menus) {
        box.append(el('div', { className: 'menu-head' }, icon('menu'), el('b', {}, m.title || m.name),
            el('span', { className: 'spacer' }),
            button('Add an entry', icon('add'), () => openPrompt('Add a menu entry', m.title || m.name, 'Text', 'New action', (text) => send({ type: 'addMenuEntry', menu: m.name, text })), 'icon-btn'),
            button('Add a separator', icon('horizontal-rule'), () => send({ type: 'addMenuEntry', menu: m.name, separator: true }), 'icon-btn'),
            button('Remove the menu', icon('trash'), () => send({ type: 'removeMenuEntry', menu: m.name }), 'icon-btn')));
        m.entries.forEach((e, i) => box.append(...entryRow(m.name, e, i, 0)));
    }
    const add = el('button', { type: 'button', className: 'add-dynamic' }, icon('add'), 'Add a menu');
    add.addEventListener('click', () => openPrompt('Add a menu', 'Menu bar', 'Title', 'New menu', (title) => send({ type: 'addMenu', title })));
    box.append(add);
    return box;
}

export function renderProperties(): void {
    const q = filterEl.value.trim().toLowerCase();
    const props = S.properties;
    changedBtn.replaceChildren(icon('diff-modified'), `Modified${props ? ` ${props.properties.filter((p) => p.changed).length}` : ''}`);
    changedBtn.setAttribute('aria-pressed', String(prefs.changedOnly));
    if (!props || !S.propertiesFor) {
        propsEl.replaceChildren(el('div', { className: 'empty' }, icon('inspect'), el('p', {}, 'Select a widget on the form or in the outline to edit its properties.')));
        return;
    }
    const groups = new Map<string, PropertyInfo[]>();
    for (const p of props.properties) {
        if ((q && !p.name.toLowerCase().includes(q)) || (prefs.changedOnly && !p.changed)) {
            continue;
        }
        const key = p.dynamic ? 'Dynamic properties' : (p.group || 'General');
        groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    const frag = document.createDocumentFragment();
    if (Array.isArray(props.items) && !q && !prefs.changedOnly) {
        frag.append(el('div', { className: 'group static' }, icon('list-unordered'), 'Items', el('span', { className: 'dim count' }, String(props.items.length))), itemsEditor(props.items));
    }
    if (Array.isArray(props.menus) && !q && !prefs.changedOnly) {
        frag.append(el('div', { className: 'group static' }, icon('menu'), 'Menus', el('span', { className: 'dim count' }, String(props.menus.length))), menusEditor(props.menus));
    }
    if (props.contents && !q && !prefs.changedOnly) {
        const c = props.contents;
        const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
        const summary = c.kind === 'table' ? `${plural(c.rows.length, 'row')}, ${plural(c.columns.length, 'column')}` : `${plural(c.columns.length, 'column')}, ${plural(flatCount(c.items), 'item')}`;
        const btn = el('button', { type: 'button', className: 'add-dynamic' }, icon('edit'), c.kind === 'table' ? 'Edit table…' : 'Edit tree…');
        btn.addEventListener('click', () => S.propertiesFor && openGridEditor(S.propertiesFor, c));
        frag.append(el('div', { className: 'group static' }, icon(c.kind === 'table' ? 'table' : 'list-tree'), 'Contents', el('span', { className: 'dim count' }, summary)), el('div', { className: 'items-editor' }, btn));
    }
    for (const [key, list] of groups) {
        const open = q !== '' || prefs.changedOnly || !collapsedGroups.has(key);
        frag.append(groupHeader(key, open, list.length));
        if (!open) {
            continue;
        }
        for (const p of list) {
            const name = el('label', { className: 'prop-name' + (p.changed ? ' changed' : ''), title: p.name }, p.name);
            const editor = editorFor(p, context);
            editor.dataset.prop = p.name;
            if (isBlock(p)) {
                frag.append(el('div', { className: 'prop-block' }, el('div', { className: 'prop-head' }, name, resetButton(p)), editor));
            } else {
                frag.append(el('div', { className: 'prop-row' }, name, editor, resetButton(p)));
            }
        }
    }
    if (!frag.hasChildNodes()) {
        frag.append(el('p', { className: 'hint' }, prefs.changedOnly ? 'No property differs from its default.' : 'No property matches your filter.'));
    }
    if (!S.properties?.isLayout) {
        const target = S.propertiesFor;
        const add = el('button', { type: 'button', className: 'add-dynamic' }, icon('add'), 'Add dynamic property…');
        add.addEventListener('click', () => openAddDynamicProperty(target, props.properties));
        frag.append(add);
    }
    propsEl.replaceChildren(frag);
}

/** Switches to the Properties tab and focuses an editor (used to jump to a property). */
export function focusProperty(name: string): void {
    setTab('properties');
    filterEl.value = '';
    renderProperties();
    const target = propsEl.querySelector<HTMLInputElement>(`[data-prop="${name}"]`);
    const field = target?.matches('input, textarea, select') ? target : target?.querySelector<HTMLInputElement>('input, textarea, select');
    field?.focus();
    field?.select?.();
}

// ---- code tab (what a developer needs to wire the widget up) ------------------------------

function copy(text: string): void {
    copyText(text);
}

function find(query: string): void {
    send({ type: 'findInCode', query });
}

function codeRow(label: string, value: string, extra: HTMLElement[] = []): HTMLElement {
    return el('div', { className: 'code-row' },
        el('span', { className: 'code-label' }, label),
        el('code', { title: value }, value),
        el('span', { className: 'code-actions' },
            button(`Copy ${value}`, icon('copy'), () => copy(value), 'icon-btn'),
            ...extra));
}

function signalSnippets(objName: string, m: MethodInfo, overloaded: boolean): { connect: string; slot: string; slotName: string } {
    const formClass = rootObject()?.name ?? 'MainWindow';
    const slotName = `on_${objName}_${m.name}`;
    const ptr = overloaded ? `qOverload<${m.params.map((p) => p.type).join(', ')}>(&${m.owner}::${m.name})` : `&${m.owner}::${m.name}`;
    const params = m.params.map((p, i) => `${p.type} ${p.name || `arg${i + 1}`}`.trim()).join(', ');
    return {
        connect: `connect(ui->${objName}, ${ptr}, this, &${formClass}::${slotName});`,
        slot: `void ${slotName}(${params});`,
        slotName,
    };
}

function signalRow(objName: string, m: MethodInfo, overloaded: boolean): HTMLElement {
    const sn = signalSnippets(objName, m, overloaded);
    const sig = m.params.length > 0 ? `${m.name}(${m.params.map((p) => `${p.type} ${p.name}`.trim()).join(', ')})` : `${m.name}()`;
    return el('div', { className: 'sig-row' },
        el('code', { title: m.signature }, sig),
        el('span', { className: 'code-actions' },
            button(`Copy connect() call: ${sn.connect}`, icon('plug'), () => copy(sn.connect), 'icon-btn'),
            button(`Copy slot declaration: ${sn.slot}`, icon('symbol-method'), () => copy(sn.slot), 'icon-btn'),
            button(`Find ${sn.slotName} in code`, icon('search'), () => find(sn.slotName), 'icon-btn')));
}

function renderCode(): void {
    const code = S.code;
    const o = primarySelection();
    if (!code || !o) {
        codeEl.replaceChildren(el('div', { className: 'empty' }, icon('code'), el('p', {}, 'Select a widget to get its accessors, signals and ready-to-paste connect() calls.')));
        return;
    }
    const frag = document.createDocumentFragment();
    frag.append(el('div', { className: 'section-title' }, 'Access from code'));
    frag.append(codeRow('C++', `ui->${code.name}`, [button(`Find usages of ui->${code.name}`, icon('search'), () => find(`ui->${code.name}`), 'icon-btn')]));
    frag.append(codeRow('Python', `self.ui.${code.name}`, [button(`Find usages of ui.${code.name}`, icon('search'), () => find(`ui.${code.name}`), 'icon-btn')]));
    frag.append(el('p', { className: 'note' }, 'A slot named on_', code.name, '_<signal> is connected automatically by setupUi (connectSlotsByName).'));

    const counts = new Map<string, number>();
    for (const m of code.signals) {
        counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
    }
    const owners = code.hierarchy.filter((c) => code.signals.some((m) => m.owner === c));
    frag.append(el('div', { className: 'section-title' }, 'Signals', el('span', { className: 'dim count' }, String(code.signals.length))));
    owners.forEach((owner, i) => {
        const list = code.signals.filter((m) => m.owner === owner);
        const key = `${code.class}:${owner}`;
        const open = openOwners.has(key) || (i === 0 && !openOwners.has(`${key}:closed`));
        const head = el('div', { className: 'group', role: 'button', tabIndex: 0 }, icon(open ? 'chevron-down' : 'chevron-right'), owner, el('span', { className: 'dim count' }, String(list.length)));
        head.setAttribute('aria-expanded', String(open));
        head.addEventListener('click', () => {
            if (open) {
                openOwners.delete(key);
                openOwners.add(`${key}:closed`);
            } else {
                openOwners.add(key);
                openOwners.delete(`${key}:closed`);
            }
            renderCode();
        });
        frag.append(head);
        if (open) {
            for (const m of list) {
                frag.append(signalRow(code.name, m, (counts.get(m.name) ?? 0) > 1));
            }
        }
    });
    if (code.slots.length > 0) {
        frag.append(el('div', { className: 'section-title' }, 'Slots you can call', el('span', { className: 'dim count' }, String(code.slots.length))));
        for (const m of code.slots.filter((x) => x.owner !== 'QObject').slice(0, 30)) {
            const call = `ui->${code.name}->${m.name}(${m.params.map((p, i) => p.name || `arg${i + 1}`).join(', ')});`;
            frag.append(el('div', { className: 'sig-row' }, el('code', { title: m.signature }, m.signature), el('span', { className: 'code-actions' }, button(`Copy ${call}`, icon('copy'), () => copy(call), 'icon-btn'))));
        }
    }
    codeEl.replaceChildren(frag);
}

// ---- connections tab ----------------------------------------------------------------------

function connectionRow(c: ConnectionInfo): HTMLElement {
    const name = (n: string) => {
        const target = byName(n);
        const b = el('button', { type: 'button', className: 'link', title: target ? `Select ${n}` : n }, n);
        b.addEventListener('click', () => target && send({ type: 'selectNames', names: [n] }));
        return b;
    };
    const userSlot = c.receiver === rootObject()?.name;
    const slotBase = c.slot.replace(/\(.*$/, '');
    return el('div', { className: 'conn-row' },
        el('div', { className: 'conn-line' }, name(c.sender), el('span', { className: 'dim' }, '.'), el('code', {}, c.signal),
            el('span', { className: 'spacer' }),
            button(`Delete the connection ${c.sender}.${c.signal} to ${c.receiver}.${c.slot}`, icon('trash'), () => send({ type: 'disconnect', sender: c.sender, signal: c.signal, receiver: c.receiver, slot: c.slot }), 'icon-btn')),
        el('div', { className: 'conn-line' }, icon('arrow-right'), name(c.receiver), el('span', { className: 'dim' }, '.'), el('code', {}, c.slot),
            userSlot ? button(`Find ${slotBase} in code`, icon('search'), () => find(slotBase), 'icon-btn') : el('span')));
}

function renderConnections(): void {
    const sel = new Set(S.snapshot?.selection ?? []);
    const list = S.connections.filter((c) => !connectionsOfSelection || onlyFormSelected() || sel.has(c.sender) || sel.has(c.receiver));
    const toggle = el('button', { type: 'button', className: 'chip', title: 'Only connections involving the selected widget' }, icon('filter'), 'Selection');
    toggle.setAttribute('aria-pressed', String(connectionsOfSelection));
    toggle.addEventListener('click', () => {
        connectionsOfSelection = !connectionsOfSelection;
        renderConnections();
    });
    const add = el('button', { type: 'button', className: 'chip accent', title: 'Connect a signal to a slot (or drag between widgets in connect mode, F4)' }, icon('add'), 'New');
    add.addEventListener('click', () => {
        const first = primarySelection();
        void openConnectDialog(first && first.parent !== null ? { sender: first.name } : {});
    });
    const frag = document.createDocumentFragment();
    frag.append(el('div', { className: 'filter-row' }, el('span', { className: 'dim grow' }, `${list.length} of ${S.connections.length} connections`), toggle, add));
    if (list.length === 0) {
        frag.append(el('div', { className: 'empty' }, icon('plug'), el('p', {}, S.connections.length === 0
            ? 'No signal/slot connections yet. Press New, or switch to connect mode (F4) and drag from one widget to another.'
            : 'No connection involves the selected widget.')));
    }
    for (const c of list) {
        frag.append(connectionRow(c));
    }
    connEl.replaceChildren(frag);
}

// ---- entry points -------------------------------------------------------------------------

let lastSignature = '';

/** Everything the inspector shows. A state that changes none of it must not rebuild the fields under the user's hands. */
function signature(): string {
    const sel = primarySelection();
    return JSON.stringify([
        S.propertiesFor, S.properties, S.code, S.connections, S.container, S.formInfo, S.tabOrder, S.snapshot?.selection,
        sel ? [sel.w, sel.h] : null, S.snapshot?.objects.map((o) => o.name), S.snapshot?.layouts.map((l) => l.name),
        prefs.rightTab, prefs.changedOnly, S.fonts.length,
    ]);
}

export function renderInspector(force = false): void {
    const sig = signature();
    if (!force && sig === lastSignature) {
        return;
    }
    lastSignature = sig;
    renderHeader();
    syncWants();
    renderTabs();
    renderProperties();
    renderCode();
    renderConnections();
    if (prefs.rightTab === 'form') {
        renderFormTab();
    }
}

export function initInspector(): void {
    filterEl.addEventListener('input', renderProperties);
    changedBtn.addEventListener('click', () => {
        prefs.changedOnly = !prefs.changedOnly;
        savePrefs();
        renderProperties();
    });
    syncWants();
}

export function propertiesHaveFocus(): boolean {
    return propsEl.contains(document.activeElement) && document.activeElement !== filterEl;
}

/** Commits a half-typed value (blur fires change) just before the fields are rebuilt from new data. */
export function blurProperties(): void {
    (document.activeElement as HTMLElement | null)?.blur();
}

/** True when the next render would really change what is shown. */
export function inspectorWouldChange(): boolean {
    return signature() !== lastSignature;
}
