import { $, el, icon } from './dom';
import { primarySelection } from './geometry';
import { S, send } from './state';

const popups = $<HTMLDivElement>('popups');
let root: HTMLElement | null = null;

export function closeRename(): void {
    root?.remove();
    root = null;
}

export function renameOpen(): boolean {
    return root !== null;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** objectName must be a valid C++ identifier, since uic turns it into a member of the Ui class. */
export function openRename(): void {
    const o = primarySelection();
    if (!o) {
        return;
    }
    closeRename();
    const input = el('input', { type: 'text', value: o.name, className: 'qa-input' });
    input.setAttribute('aria-label', 'New object name');
    const error = el('div', { className: 'rename-error' });
    const box = el('div', { className: 'popup rename' }, el('div', { className: 'qa-row' }, icon('edit'), input), error,
        el('div', { className: 'qa-hint' }, `Renaming ${o.name} (used as ui->${o.name} in code)`, el('span', { className: 'dim' }, '↵ apply  Esc cancel')));
    const scrim = el('div', { className: 'scrim' }, box);
    root = scrim;
    popups.append(scrim);
    const apply = () => {
        const v = input.value.trim();
        if (!IDENT.test(v)) {
            error.textContent = 'Use letters, digits and underscores, not starting with a digit.';
            return;
        }
        if (v !== o.name && S.snapshot?.objects.some((x) => x.name === v)) {
            error.textContent = `An object named ${v} already exists.`;
            return;
        }
        closeRename();
        if (v !== o.name) {
            // a spacer's name lives in `spacerName`; every other object uses objectName
            send({ type: 'setProperty', name: o.name, property: o.class === 'Spacer' ? 'spacerName' : 'objectName', value: v });
        }
    };
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            apply();
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            closeRename();
        }
    });
    scrim.addEventListener('pointerdown', (ev) => {
        if (ev.target === scrim) {
            closeRename();
        }
    });
    input.focus();
    input.select();
}
