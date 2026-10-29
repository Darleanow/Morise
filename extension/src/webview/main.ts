import type { ActionName, HostToWebview } from '../protocol';
import * as actions from './actions';
import './actiondrop';
import './entrydrag';
import { alignable } from './align';
import { cancelGesture, fitZoom, flushPendingMenu, frameArrived, gestureActive, initGlobalCanvas, onZoomChange, renderCanvas, requestScale, setMode, setSpaceDown, setZoom, stepZoom } from './canvas';
import { buildCommands } from './commands';
import { onDescribeResult, openConnectDialog } from './connectdialog';
import { $ } from './dom';
import { onlyFormSelected, selectedObject } from './geometry';
import { openHelp } from './help';
import { hooks } from './hooks';
import { runPendingTab } from './tabs';
import { closeInplace, editableText, editText, editTextWhenReady, inplaceOpen, runPendingEdit } from './inplace';
import { blurProperties, focusProperty, initInspector, inspectorWouldChange, propertiesHaveFocus, renderInspector } from './inspector';
import { closeMenu, menuOpen, objectMenu, openMenu } from './menu';
import { initOutline, refreshOutlineHover, renderOutline } from './outline';
import { initPalette, learnIcons, renderPalette } from './palette';
import { anyPopupOpen } from './popup';
import { onPreview, onPreviewFrame, openPreview, refreshPreviewSoon } from './preview';
import { onStyleSheetCheck } from './dialogs';
import { closeQuickAdd, openQuickAdd, quickAddOpen } from './quickadd';
import { closeRename, openRename, renameOpen } from './rename';
import { initSplitters } from './splitter';
import { renderRulers } from './rulers';
import { renderStatus, renderZoomBar } from './statusbar';
import { prefs, S, send } from './state';
import { toast } from './toast';
import { selectFirstChild, selectParent, selectSibling } from './traverse';
import { buildToolbar, openHistoryMenu, toggleConnectMode, updateToolbar } from './toolbar';

const loading = $('loading');
const engineDown = $('engine-down');
let firstState = true;

hooks.openContextMenu = (x, y) => openMenu(x, y, objectMenu(openRename));
hooks.openQuickAdd = openQuickAdd;
hooks.focusProperty = focusProperty;
hooks.rename = openRename;
hooks.editableText = editableText;
hooks.editText = editText;
hooks.editTextWhenReady = editTextWhenReady;
hooks.openPreview = openPreview;
hooks.commands = buildCommands;
hooks.openCommands = () => openQuickAdd(undefined, true);
hooks.openHelp = openHelp;
hooks.openConnect = (init) => void openConnectDialog(init);

// ---- keyboard ---------------------------------------------------------------------------

/** Arrow keys move the selection by the grid (Alt: one pixel); Shift resizes. Works on several widgets at once. */
function nudge(ev: KeyboardEvent): boolean {
    const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = delta[ev.key];
    const s = S.snapshot;
    if (!d || !s) {
        return false;
    }
    const [gx, gy] = ev.altKey ? [1, 1] : s.grid;
    const dx = d[0] * gx, dy = d[1] * gy;
    const single = selectedObject();
    if (single?.parent === null) {
        if (!ev.shiftKey) {
            return false;
        }
        const [fx, fy, fw, fh] = s.formGeometry;
        send({ type: 'setProperty', name: single.name, property: 'geometry', value: [fx, fy, Math.max(40, fw + dx), Math.max(40, fh + dy)] });
        return true;
    }
    const targets = alignable();
    if (targets.length === 0) {
        return false;
    }
    const rect = (o: (typeof targets)[number]) => {
        const x = o.x - o.gx, y = o.y - o.gy;
        return ev.shiftKey ? [x, y, Math.max(4, o.w + dx), Math.max(4, o.h + dy)] : [x + dx, y + dy, o.w, o.h];
    };
    if (targets.length === 1) {
        const o = targets[0] as (typeof targets)[number];
        send({ type: 'setProperty', name: o.name, property: 'geometry', value: rect(o) });
    } else {
        send({ type: 'gesture', phase: 'begin', label: `${ev.shiftKey ? 'Resize' : 'Move'} ${targets.length} widgets` });
        send({ type: 'setGeometries', items: targets.map((o) => ({ name: o.name, rect: rect(o) })) });
        send({ type: 'gesture', phase: 'end', label: '' });
    }
    return true;
}

document.addEventListener('keydown', (ev) => {
    if (menuOpen() || quickAddOpen() || renameOpen() || anyPopupOpen() || inplaceOpen()) {
        return;
    }
    const t = ev.target instanceof Element ? ev.target : null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
        return;
    }
    // Arrows, Tab and Enter belong to the panel that has the focus (outline, palette, toolbar...), not to the canvas.
    const inPanel = t?.closest('#tree, #palette, #toolbar, #statusbar, #inspector') != null;
    if (ev.key === 'Escape') {
        if (gestureActive()) {
            cancelGesture();
        } else if (S.mode === 'connect') {
            toggleConnectMode();
        }
        return;
    }
    const s = S.snapshot;
    if (!s) {
        return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    let action: ActionName | undefined;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && !mod && !onlyFormSelected()) {
        action = 'delete';
    } else if (mod && k === 'c') {
        action = 'copy';
    } else if (mod && k === 'x') {
        action = 'cut';
    } else if (mod && k === 'v') {
        action = 'paste';
    } else if (mod && k === 'a') {
        action = 'selectAll';
    }
    if (action) {
        if (actions.isEnabled(action)) {
            ev.preventDefault();
            actions.run(action);
        }
        return;
    }
    if (mod && (ev.key === '0')) {
        ev.preventDefault();
        fitZoom();
    } else if (mod && ev.key === '1') {
        ev.preventDefault();
        setZoom(1);
    } else if (mod && (ev.key === '=' || ev.key === '+')) {
        ev.preventDefault();
        stepZoom(1);
    } else if (mod && (ev.key === '-' || ev.key === '_')) {
        ev.preventDefault();
        stepZoom(-1);
    } else if (ev.key === '>') {
        ev.preventDefault();
        openQuickAdd(undefined, true);
    } else if (ev.key === '?') {
        ev.preventDefault();
        openHelp();
    } else if (mod && ev.key === 'ArrowUp') {
        ev.preventDefault();
        selectParent();
    } else if (mod && ev.key === 'ArrowDown') {
        ev.preventDefault();
        selectFirstChild();
    } else if (ev.key === 'Tab' && !mod && !inPanel) {
        ev.preventDefault();
        selectSibling(ev.shiftKey ? -1 : 1);
    } else if (mod && k === 'd') {
        ev.preventDefault();
        actions.duplicate();
    } else if (mod && k === 'r') {
        ev.preventDefault();
        openPreview();
    } else if (ev.key === 'F4') {
        ev.preventDefault();
        toggleConnectMode();
    } else if (ev.key === 'F2') {
        ev.preventDefault();
        openRename();
    } else if (ev.key === 'Enter' && !mod && !inPanel && editableText()) {
        ev.preventDefault();
        editText();
    } else if (ev.key === '/' && !mod) {
        ev.preventDefault();
        openQuickAdd();
    } else if (!mod && !inPanel && nudge(ev)) {
        ev.preventDefault();
    }
});

document.addEventListener('keydown', (ev) => {
    const t = ev.target instanceof Element ? ev.target : null;
    if (ev.code === 'Space' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'BUTTON' || t.closest('#tree, #palette, .menu, .popup') !== null))) {
        ev.preventDefault();
        setSpaceDown(true);
    }
});
document.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space') {
        setSpaceDown(false);
    }
});
window.addEventListener('blur', () => setSpaceDown(false));

// ---- host messages ----------------------------------------------------------------------

function apply(msg: Extract<HostToWebview, { type: 'state' }>): void {
    const paletteChanged = S.palette.length !== msg.palette.length;
    const previousSelection = S.snapshot?.selection.join('\u0000');
    S.snapshot = msg.snapshot;
    S.properties = msg.properties;
    S.propertiesFor = msg.propertiesFor;
    S.code = msg.code;
    S.connections = msg.connections;
    S.container = msg.container;
    S.tabOrder = msg.tabOrder;
    S.formInfo = msg.formInfo;
    S.fonts = msg.fonts;
    if (msg.locales) {
        S.locales = msg.locales;
    }
    if (paletteChanged) {
        S.palette = msg.palette;
        learnIcons();
        renderPalette();
    }
    for (const n of msg.notices) {
        toast(n, { kind: 'warn' });
    }
    if (firstState) {
        firstState = false;
        loading.hidden = true;
        // A form larger than the window opens fitted, unless the user already chose a zoom.
        window.setTimeout(() => {
            const vp = document.getElementById('viewport');
            if (vp && prefs.zoom === 1 && (msg.snapshot.width > vp.clientWidth - 80 || msg.snapshot.height > vp.clientHeight - 80)) {
                fitZoom();
            }
        }, 60);
    }
    engineDown.hidden = true;
    if (inplaceOpen() && previousSelection !== msg.snapshot.selection.join('\u0000')) {
        closeInplace();
    }

    renderCanvas();
    renderRulers();
    renderOutline();
    renderStatus();
    updateToolbar();
    if (!gestureActive() && inspectorWouldChange()) {
        if (propertiesHaveFocus()) {
            blurProperties(); // commits what was typed: the engine is the source of truth for the next render
        }
        renderInspector();
    }
    frameArrived();
    flushPendingMenu();
    runPendingEdit();
    runPendingTab();
    refreshPreviewSoon();
}

window.addEventListener('message', (ev: MessageEvent<HostToWebview>) => {
    const msg = ev.data;
    switch (msg.type) {
        case 'state':
            apply(msg);
            break;
        case 'previewFrame':
            onPreviewFrame(msg.result);
            break;
        case 'preview':
            onPreview(msg.result, msg.style, msg.dark);
            break;
        case 'styleSheetCheck':
            onStyleSheetCheck(msg.text, msg.valid);
            break;
        case 'describeResult':
            onDescribeResult(msg.name, msg.result);
            break;
        case 'history':
            openHistoryMenu(msg.items, msg.index);
            break;
        case 'error':
            toast(msg.message, { kind: 'error' });
            break;
        case 'backendStatus':
            loading.hidden = true;
            $('engine-down-text').textContent = msg.text;
            engineDown.hidden = false;
            break;
    }
});

document.addEventListener('qtd-hover', refreshOutlineHover);
document.addEventListener('qtd-edit-text', (ev) => editTextWhenReady((ev as CustomEvent<string>).detail));
$('engine-restart').addEventListener('click', () => {
    engineDown.hidden = true;
    loading.hidden = false;
    send({ type: 'restartBackend' });
});
document.addEventListener('pointerdown', (ev) => {
    // clicking elsewhere dismisses the transient popups
    if (!(ev.target as HTMLElement).closest('.popup')) {
        closeQuickAdd();
        closeRename();
    }
    if (!(ev.target as HTMLElement).closest('.menu')) {
        closeMenu();
    }
}, true);

// ---- start ------------------------------------------------------------------------------

initGlobalCanvas();
initSplitters();
initPalette();
initOutline();
initInspector();
buildToolbar();
renderZoomBar();
onZoomChange(() => {
    renderRulers();
    renderStatus();
    renderZoomBar();
});
setZoom(prefs.zoom);
renderRulers();
setMode('select');
renderInspector();
send({ type: 'ready' });
requestScale();
