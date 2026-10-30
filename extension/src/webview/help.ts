import { el, icon } from './dom';
import { footer, header, openPopup, primaryButton } from './popup';

const SHORTCUTS: { title: string; rows: [string, string][] }[] = [
    { title: 'Select', rows: [
        ['Click', 'select a widget'], ['Shift/Ctrl + click', 'add or remove from the selection'], ['Drag on empty space', 'select with a band'],
        ['Ctrl+A', 'select all'], ['Tab / Shift+Tab', 'next / previous widget'], ['Ctrl+\u2191 / Ctrl+\u2193', 'parent / first child'], ['Esc', 'cancel a drag, or leave connect mode'] ] },
    { title: 'Move and resize', rows: [
        ['Drag', 'move (snaps to grid and neighbours)'], ['Drag a handle', 'resize; the form resizes from its right and bottom edges'],
        ['Alt while dragging', 'no snapping'], ['Arrows', 'nudge by the grid (Alt: 1 px)'], ['Shift+arrows', 'resize'] ] },
    { title: 'Edit', rows: [
        ['/', 'add a widget by name'], ['>', 'run a command'], ['Enter / double-click', 'edit the text in place'], ['F2', 'rename the object'],
        ['Ctrl+C / X / V', 'copy, cut, paste'], ['Ctrl+D', 'duplicate'], ['Delete', 'delete'], ['Ctrl+Z / Ctrl+Shift+Z', 'undo, redo (VS Code)'] ] },
    { title: 'Layout', rows: [
        ['H / V / G / F', 'lay out horizontally, vertically, in a grid, in a form'], ['B', 'break the layout'], ['J', 'adjust size'], [']  /  [', 'bring to front / send to back'] ] },
    { title: 'View', rows: [
        ['Ctrl + wheel, Ctrl +/\u2212', 'zoom'], ['Ctrl+0', 'fit the form'], ['Ctrl+1', 'zoom to 100%'], ['Space + drag, middle button', 'pan'],
        ['Ctrl+R', 'preview the form'], ['F4', 'connect mode (drag between widgets)'], ['?', 'this list'] ] },
];

/** The keyboard and mouse shortcuts, grouped. */
export function openHelp(): void {
    const cols = SHORTCUTS.map((g) => el('section', { className: 'help-group' }, el('h3', {}, g.title),
        ...g.rows.map(([k, d]) => el('div', { className: 'help-row' }, el('kbd', {}, k), el('span', {}, d)))));
    const popup = openPopup([
        header('Keyboard and mouse', 'everything is also available from the > command search'),
        el('div', { className: 'help-grid' }, ...cols),
        footer(icon('lightbulb'), el('span', { className: 'dim' }, 'Right-click anything for its menu.'), el('span', { className: 'spacer' }), primaryButton('Close', () => popup.close())),
    ], 'help');
}
