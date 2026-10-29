import * as actions from './actions';
import { ALIGNMENTS, alignable, runAlignment } from './align';
import { fitZoom, setZoom, stepZoom } from './canvas';
import { openConnectDialog } from './connectdialog';
import { openHelp } from './help';
import type { Command } from './hooks';
import { editableText, editText } from './inplace';
import { openPreview } from './preview';
import { openRename } from './rename';
import { renderRulers } from './rulers';
import { byName, primarySelection } from './geometry';
import { focusProperty, setTab } from './inspector';
import { togglePanel } from './splitter';
import { prefs, S, savePrefs, send } from './state';
import { toggleConnectMode } from './toolbar';

export interface WindowPart { text: string; label: string; icon: string; enabled: boolean; run: () => void }

/** What a QMainWindow can gain or lose: the engine's own task actions for the window, chosen by caption. */
export function mainWindowParts(root: string): WindowPart[] {
    const has = (cls: string) => (S.snapshot?.objects ?? []).some((o) => o.class.endsWith(cls));
    const part = (text: string, label: string, icon: string, enabled: boolean): WindowPart => ({ text, label, icon, enabled, run: () => send({ type: 'taskAction', name: root, text }) });
    return [
        part('Create Menu Bar', 'Create the menu bar', 'menu', !has('MenuBar')),
        part('Remove Menu Bar', 'Remove the menu bar', 'trash', has('MenuBar')),
        part('Add Tool Bar', 'Add a tool bar', 'tools', true),
        part('Create Status Bar', 'Create the status bar', 'layout-statusbar', !has('StatusBar')),
        part('Remove Status Bar', 'Remove the status bar', 'trash', has('StatusBar')),
    ];
}

/** Every action of the editor in one searchable list: what the > search shows. */
export function buildCommands(): Command[] {
    const out: Command[] = [];
    const sel = primarySelection();
    const parent = byName(sel?.parent);
    const targets = alignable();

    const root = S.snapshot?.objects.find((o) => o.parent === null);
    if (root?.class === 'QMainWindow') {
        for (const part of mainWindowParts(root.name)) {
            out.push({ id: `window.${part.text}`, label: part.label, keywords: 'main window menu bar tool bar status bar', icon: part.icon, enabled: part.enabled, run: part.run });
        }
    }
    for (const a of Object.values(actions.ACTIONS)) {
        out.push({ id: `action.${a.action}`, label: a.label, icon: a.icon, shortcut: a.shortcut, enabled: actions.isEnabled(a.action), run: () => actions.run(a.action) });
    }
    out.push({ id: 'duplicate', label: 'Duplicate', icon: 'files', shortcut: 'Ctrl+D', enabled: actions.isEnabled('copy'), run: () => actions.duplicate() });
    for (const d of ALIGNMENTS) {
        out.push({ id: `align.${d.op}`, label: d.label, keywords: 'align distribute size', icon: d.icon, enabled: targets.length >= d.needs, run: () => runAlignment(d.op) });
    }
    out.push(
        { id: 'rename', label: 'Rename the selected object', icon: 'edit', shortcut: 'F2', enabled: !!sel, run: openRename },
        { id: 'edit-text', label: 'Edit the text of the selected widget', icon: 'symbol-string', shortcut: 'Enter', enabled: editableText(), run: editText },
        { id: 'select-parent', label: parent ? `Select the parent (${parent.name})` : 'Select the parent', icon: 'arrow-up', shortcut: 'Ctrl+\u2191', enabled: !!parent, run: () => parent && send({ type: 'selectNames', names: [parent.name] }) },
        { id: 'save-image', label: 'Save the form as an image (PNG)', keywords: 'export screenshot picture png', icon: 'device-camera', run: () => send({ type: 'saveImage' }) },
        { id: 'preview', label: 'Preview the form', keywords: 'run test style dark', icon: 'open-preview', shortcut: 'Ctrl+R', run: openPreview },
        { id: 'connect-mode', label: S.mode === 'connect' ? 'Leave connect mode' : 'Connect signals and slots (drag between widgets)', keywords: 'signal slot', icon: 'plug', shortcut: 'F4', run: toggleConnectMode },
        { id: 'new-connection', label: 'New signal/slot connection\u2026', keywords: 'signal slot connect', icon: 'add', enabled: true, run: () => void openConnectDialog(sel && sel.parent !== null ? { sender: sel.name } : {}) },
        { id: 'zoom-in', label: 'Zoom in', icon: 'zoom-in', shortcut: 'Ctrl++', run: () => stepZoom(1) },
        { id: 'zoom-out', label: 'Zoom out', icon: 'zoom-out', shortcut: 'Ctrl+\u2212', run: () => stepZoom(-1) },
        { id: 'zoom-fit', label: 'Zoom to fit the form', icon: 'screen-full', shortcut: 'Ctrl+0', run: fitZoom },
        { id: 'zoom-100', label: 'Zoom to 100%', icon: 'search', shortcut: 'Ctrl+1', run: () => setZoom(1) },
        { id: 'layouts', label: prefs.showLayouts ? 'Hide layout outlines' : 'Show layout outlines', icon: 'layout', run: () => { prefs.showLayouts = !prefs.showLayouts; savePrefs(); document.dispatchEvent(new CustomEvent('qtd-redraw')); } },
        { id: 'rulers', label: prefs.rulers ? 'Hide the rulers' : 'Show rulers in form pixels', icon: 'symbol-ruler', run: () => { prefs.rulers = !prefs.rulers; savePrefs(); renderRulers(); } },
        { id: 'snap', label: prefs.snapToWidgets ? 'Stop snapping to neighbouring widgets' : 'Snap to neighbouring widgets', icon: 'magnet', run: () => { prefs.snapToWidgets = !prefs.snapToWidgets; savePrefs(); } },
        { id: 'sidebar-left', label: 'Toggle the widgets and outline sidebar', icon: 'layout-sidebar-left', run: () => togglePanel('left') },
        { id: 'sidebar-right', label: 'Toggle the inspector', icon: 'layout-sidebar-right', run: () => togglePanel('right') },
        { id: 'tab-properties', label: 'Show the properties', icon: 'settings-gear', run: () => setTab('properties') },
        { id: 'tab-code', label: 'Show the code helpers (signals, accessors)', icon: 'code', run: () => setTab('code') },
        { id: 'tab-connections', label: 'Show the connections', icon: 'plug', run: () => setTab('connections') },
        { id: 'tab-form', label: 'Show the form settings and tab order', keywords: 'grid margin spacing focus', icon: 'symbol-ruler', run: () => setTab('form') },
        { id: 'undo', label: 'Undo', icon: 'discard', shortcut: 'Ctrl+Z', enabled: !!S.snapshot?.canUndo, run: () => send({ type: 'undo' }) },
        { id: 'redo', label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Shift+Z', enabled: !!S.snapshot?.canRedo, run: () => send({ type: 'redo' }) },
        { id: 'help', label: 'Show the keyboard shortcuts', icon: 'question', shortcut: '?', run: openHelp },
    );
    return out;
}

/** Every object of the form, to jump to by name or class (the @ search). */
export function buildObjectCommands(): Command[] {
    return (S.snapshot?.objects ?? []).map((o) => ({
        id: `object.${o.name}`, label: o.name, detail: o.class, keywords: o.class, icon: 'symbol-class', section: 'Objects in this form',
        run: () => send({ type: 'selectNames', names: [o.name] }),
    }));
}

/** The properties of the selected object, to jump to the editor of one (the : search). */
export function buildPropertyCommands(): Command[] {
    const props = S.properties?.properties ?? [];
    return props.map((p) => ({
        id: `property.${p.name}`, label: p.name, detail: p.group, keywords: p.group, icon: 'symbol-property', section: `Properties of ${S.propertiesFor ?? 'the selection'}`,
        enabled: p.enabled, run: () => focusProperty(p.name),
    }));
}
