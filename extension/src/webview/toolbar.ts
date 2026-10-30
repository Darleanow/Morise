import type { ActionName } from '../protocol';
import * as actions from './actions';
import { ALIGNMENTS, alignable, runAlignment } from './align';
import { renderOverlay, setMode } from './canvas';
import { requestAudit } from './audit';
import { requestCompare } from './compare';
import { $, button, el, icon } from './dom';
import { hooks } from './hooks';
import { formSizeMenu, openMenu } from './menu';
import { rootObject } from './geometry';
import { applyPanels, togglePanel } from './splitter';
import { prefs, S, savePrefs, send } from './state';

const toolbar = $<HTMLDivElement>('toolbar');
let widthInput: HTMLInputElement;
let heightInput: HTMLInputElement;

/** What stays one click away: the layouts are the heart of the workflow. Everything else lives in the "more" menu (and in the context menu and keyboard). */
const LAYOUTS: ActionName[] = ['layoutHorizontal', 'layoutVertical', 'layoutGrid', 'layoutForm', 'breakLayout'];
const MORE: ActionName[][] = [['cut', 'copy', 'paste', 'delete'], ['adjustSize', 'raise', 'lower']];

function applySize(w: number, h: number): void {
    const root = rootObject();
    const fg = S.snapshot?.formGeometry;
    if (root && fg && w >= 16 && h >= 16) {
        send({ type: 'setProperty', name: root.name, property: 'geometry', value: [fg[0], fg[1], Math.round(w), Math.round(h)] });
    }
}

export function buildToolbar(): void {
    const sep = () => el('span', { className: 'sep' });
    const left = button('Toggle sidebar (widgets and outline)', icon('layout-sidebar-left'), () => togglePanel('left'), 'tb');
    left.dataset.panel = 'left';
    const undo = button('Undo (Ctrl+Z)', icon('discard'), () => send({ type: 'undo' }), 'tb');
    undo.dataset.history = 'undo';
    const redo = button('Redo (Ctrl+Shift+Z)', icon('redo'), () => send({ type: 'redo' }), 'tb');
    redo.dataset.history = 'redo';
    const historyBtn = button('Undo history: go back to an earlier state', icon('chevron-down'), () => send({ type: 'history' }), 'tb small');
    historyBtn.dataset.historyMenu = '1';
    toolbar.append(left, sep(), undo, redo, historyBtn, sep());

    for (const a of LAYOUTS) {
        const b = button(actions.title(a), icon(actions.ACTIONS[a].icon), () => actions.run(a), 'tb');
        b.dataset.action = a;
        b.disabled = true;
        toolbar.append(b);
    }
    toolbar.append(sep());
    const align = button('Align, distribute and match sizes', icon('align-left'), () => {
        const r = align.getBoundingClientRect();
        const targets = alignable();
        openMenu(r.left, r.bottom + 2, ALIGNMENTS.map((d) => ({ label: d.label, icon: d.icon, disabled: targets.length < d.needs, run: () => runAlignment(d.op) })));
    }, 'tb');
    align.dataset.align = '1';
    toolbar.append(align, sep());

    const connect = button('Connect mode: drag from a widget to another to connect a signal to a slot (F4)', icon('connect-tool'), () => toggleConnectMode(), 'tb');
    connect.dataset.mode = 'connect';
    connect.setAttribute('aria-pressed', 'false');
    const previewBtn = button('Preview the form as the application will show it (Ctrl+R)', icon('open-preview'), () => hooks.openPreview(), 'tb');
    previewBtn.dataset.preview = '1';
    toolbar.append(connect, previewBtn, sep());

    const layouts = button('Show layout outlines', icon('layout'), () => {
        prefs.showLayouts = !prefs.showLayouts;
        layouts.setAttribute('aria-pressed', String(prefs.showLayouts));
        savePrefs();
        renderOverlay();
    }, 'tb');
    layouts.dataset.toggle = 'layouts';
    layouts.setAttribute('aria-pressed', String(prefs.showLayouts));
    toolbar.append(layouts);

    const add = el('button', { type: 'button', className: 'tb add', title: 'Add a widget by name (/)' }, icon('add'), el('span', { className: 'label' }, 'Add widget'), el('kbd', {}, '/'));
    add.addEventListener('click', () => hooks.openQuickAdd());
    toolbar.append(sep(), add, el('span', { className: 'spacer' }));

    widthInput = el('input', { type: 'number', className: 'size-input', min: '16', max: '8000' });
    heightInput = el('input', { type: 'number', className: 'size-input', min: '16', max: '8000' });
    widthInput.setAttribute('aria-label', 'Form width');
    heightInput.setAttribute('aria-label', 'Form height');
    const commit = () => applySize(Number(widthInput.value), Number(heightInput.value));
    widthInput.addEventListener('change', commit);
    heightInput.addEventListener('change', commit);
    const presets = button('Form size presets', icon('chevron-down'), () => {
        const r = presets.getBoundingClientRect();
        openMenu(r.left, r.bottom + 2, formSizeMenu(applySize));
    }, 'tb');
    toolbar.append(
        el('span', { className: 'size-label', title: 'Form size in pixels. Drag the form’s right and bottom edges to resize it live.' }, icon('symbol-ruler'), 'Form'),
        widthInput, el('span', { className: 'dim' }, '×'), heightInput, presets, sep());

    const commandsBtn = button('Search commands (>)', icon('terminal'), () => hooks.openCommands(), 'tb');
    const more = button('More: clipboard, order, git compare, form check, help', icon('ellipsis'), () => {
        const r = more.getBoundingClientRect();
        const entries = MORE.flatMap((group, i) => [
            ...(i > 0 ? [{ separator: true }] : []),
            ...group.map((a) => ({ label: actions.title(a), icon: actions.ACTIONS[a].icon, disabled: !actions.isEnabled(a), run: () => actions.run(a) })),
        ]);
        openMenu(r.left, r.bottom + 2, [
            ...entries,
            { separator: true },
            { label: 'Compare with the last git commit', icon: 'git-compare', run: () => requestCompare() },
            { label: 'Check the form', icon: 'checklist', run: () => requestAudit() },
            { separator: true },
            { label: 'Keyboard and mouse shortcuts', icon: 'question', shortcut: '?', run: () => hooks.openHelp() },
        ]);
    }, 'tb');
    toolbar.append(commandsBtn, more);
    const right = button('Toggle inspector', icon('layout-sidebar-right'), () => togglePanel('right'), 'tb');
    right.dataset.panel = 'right';
    toolbar.append(right);
    syncPanelButtons();
    watchOverflow();
}

/** A narrow editor cannot show every button: the wheel scrolls the bar sideways and a fade shows there is more. */
function watchOverflow(): void {
    const mark = () => {
        toolbar.classList.toggle('more-right', toolbar.scrollLeft + toolbar.clientWidth < toolbar.scrollWidth - 2);
        toolbar.classList.toggle('more-left', toolbar.scrollLeft > 2);
    };
    toolbar.addEventListener('scroll', mark, { passive: true });
    toolbar.addEventListener('wheel', (ev) => {
        if (toolbar.scrollWidth > toolbar.clientWidth && Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
            toolbar.scrollLeft += ev.deltaY;
            ev.preventDefault();
        }
    }, { passive: false });
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(mark).observe(toolbar);
    }
    mark();
}

function syncPanelButtons(): void {
    for (const b of Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button[data-panel]'))) {
        b.setAttribute('aria-pressed', String(b.dataset.panel === 'left' ? prefs.leftOpen : prefs.rightOpen));
    }
}

/** The undo stack as a menu: choosing an entry undoes or redoes as many steps as it takes to get there. */
export function openHistoryMenu(items: string[], index: number): void {
    const anchor = toolbar.querySelector<HTMLElement>('button[data-history-menu]');
    const r = anchor?.getBoundingClientRect();
    const entries = items.map((text, i) => ({ text, target: i + 1 }));
    const menu = [...entries].reverse().slice(0, 25).map((e) => ({
        label: e.text,
        icon: e.target === index ? 'check' : undefined,
        shortcut: e.target === index ? 'current' : undefined,
        run: () => {
            const steps = index - e.target;
            if (steps > 0) {
                send({ type: 'undo', steps });
            } else if (steps < 0) {
                send({ type: 'redo', steps: -steps });
            }
        },
    }));
    menu.push({ label: 'Original document', icon: index === 0 ? 'check' : undefined, shortcut: index === 0 ? 'current' : undefined, run: () => index > 0 && send({ type: 'undo', steps: index }) });
    openMenu(r?.left ?? 40, (r?.bottom ?? 40) + 2, menu);
}

export function toggleConnectMode(): void {
    setMode(S.mode === 'connect' ? 'select' : 'connect');
    toolbar.querySelector('button[data-mode=connect]')?.setAttribute('aria-pressed', String(S.mode === 'connect'));
}

export function updateToolbar(): void {
    const sn = S.snapshot;
    for (const b of Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button[data-history]'))) {
        b.disabled = b.dataset.history === 'undo' ? !sn?.canUndo : !sn?.canRedo;
    }
    toolbar.querySelector<HTMLButtonElement>('button[data-history-menu]')?.toggleAttribute('disabled', !(sn?.canUndo || sn?.canRedo));
    toolbar.querySelector<HTMLButtonElement>('button[data-align]')?.toggleAttribute('disabled', alignable().length === 0);
    toolbar.querySelector('button[data-mode=connect]')?.setAttribute('aria-pressed', String(S.mode === 'connect'));
    for (const b of Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button[data-action]'))) {
        b.disabled = !actions.isEnabled(b.dataset.action as ActionName);
    }
    toolbar.querySelector('button[data-toggle=layouts]')?.setAttribute('aria-pressed', String(prefs.showLayouts));
    const fg = S.snapshot?.formGeometry;
    if (fg && widthInput && document.activeElement !== widthInput && document.activeElement !== heightInput) {
        widthInput.value = String(fg[2]);
        heightInput.value = String(fg[3]);
    }
    syncPanelButtons();
}

export { applyPanels };
