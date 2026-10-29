import type { PropertyInfo } from '../protocol';
import { el, icon } from './dom';
import { footer, header, openPopup, primaryButton, secondaryButton } from './popup';
import { send } from './state';

/** A larger editor for long text such as style sheets and tooltips. */
const styleChecks = new Map<string, (valid: boolean) => void>();

/** The host answers `checkStyleSheet` with `styleSheetCheck` (Qt's own CSS parser, as Designer validates). */
export function onStyleSheetCheck(text: string, valid: boolean): void {
    styleChecks.get(text)?.(valid);
    styleChecks.delete(text);
}

function checkStyleSheet(text: string): Promise<boolean> {
    return new Promise((resolve) => {
        styleChecks.set(text, resolve);
        send({ type: 'checkStyleSheet', text });
        setTimeout(() => {
            if (styleChecks.delete(text)) {
                resolve(true); // no answer: do not block the user
            }
        }, 3000);
    });
}

export function openTextEditor(title: string, current: string, onApply: (value: string) => void, validate = false): void {
    const ta = el('textarea', { value: current, className: 'big-text', spellcheck: false });
    const status = el('span', { className: 'dim style-status' });
    status.setAttribute('aria-live', 'polite');
    let timer: number | undefined;
    const recheck = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            const text = ta.value;
            void checkStyleSheet(text).then((valid) => {
                if (ta.value === text) {
                    status.textContent = text.trim() === '' ? '' : valid ? 'Valid style sheet' : 'Invalid style sheet';
                    status.className = `style-status ${text.trim() === '' ? 'dim' : valid ? 'ok' : 'bad'}`;
                }
            });
        }, 250);
    };
    if (validate) {
        ta.addEventListener('input', recheck);
        recheck();
    }
    ta.setAttribute('aria-label', title);
    const apply = () => {
        popup.close();
        if (ta.value !== current) {
            onApply(ta.value);
        }
    };
    const popup = openPopup([header(title, 'Ctrl+Enter to apply'), ta, footer(status, el('span', { className: 'spacer' }), secondaryButton('Cancel', () => popup.close()), primaryButton('Apply', apply))], 'text-editor');
    ta.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
            ev.preventDefault();
            apply();
        }
    });
    ta.focus();
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Dynamic properties are extra properties stored in the .ui and available at run time through property(). */
export function openAddDynamicProperty(objectName: string, existing: PropertyInfo[]): void {
    const name = el('input', { type: 'text', placeholder: 'propertyName', className: 'wide' });
    const kind = el('select', {});
    for (const k of ['string', 'int', 'double', 'bool']) {
        kind.append(el('option', { value: k }, k));
    }
    const value = el('input', { type: 'text', placeholder: 'initial value', className: 'wide' });
    const error = el('div', { className: 'rename-error' });
    const apply = () => {
        const n = name.value.trim();
        if (!IDENT.test(n)) {
            error.textContent = 'Use letters, digits and underscores, not starting with a digit.';
            return;
        }
        if (existing.some((p) => p.name === n)) {
            error.textContent = `${objectName} already has a property named ${n}.`;
            return;
        }
        const k = kind.value;
        const v: unknown = k === 'int' ? Math.trunc(Number(value.value) || 0) : k === 'double' ? Number(value.value) || 0 : k === 'bool' ? /^(1|true|yes|on)$/i.test(value.value.trim()) : value.value;
        popup.close();
        send({ type: 'addDynamicProperty', name: objectName, property: n, kind: k, value: v });
    };
    const popup = openPopup([
        header('Add a dynamic property', objectName),
        el('div', { className: 'form-grid' }, el('label', {}, 'Name'), name, el('label', {}, 'Type'), kind, el('label', {}, 'Value'), value),
        error,
        footer(el('span', { className: 'spacer' }), secondaryButton('Cancel', () => popup.close()), primaryButton('Add', apply)),
    ], 'small');
    popup.box.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            apply();
        }
    });
    name.focus();
}

/** Promote a widget to a custom class (the header is what uic emits as an #include). */
export function openPromote(names: string[], baseClass: string): void {
    const cls = el('input', { type: 'text', placeholder: 'MyFancyButton', className: 'wide' });
    const header_ = el('input', { type: 'text', placeholder: 'myfancybutton.h', className: 'wide' });
    cls.addEventListener('input', () => {
        if (!header_.dataset.touched) {
            header_.value = cls.value ? `${cls.value.toLowerCase()}.h` : '';
        }
    });
    header_.addEventListener('input', () => { header_.dataset.touched = '1'; });
    const error = el('div', { className: 'rename-error' });
    const apply = () => {
        if (!/^[A-Za-z_][A-Za-z0-9_:]*$/.test(cls.value.trim()) || header_.value.trim() === '') {
            error.textContent = 'Enter a valid C++ class name and its header file.';
            return;
        }
        popup.close();
        send({ type: 'promote', names, className: cls.value.trim(), include: header_.value.trim() });
    };
    const popup = openPopup([
        header('Promote to a custom widget', `${names.length > 1 ? `${names.length} widgets` : names[0]} · base class ${baseClass}`),
        el('div', { className: 'form-grid' }, el('label', {}, 'Class name'), cls, el('label', {}, 'Header file'), header_),
        el('p', { className: 'note' }, icon('info'), ' The class must derive from ', el('b', {}, baseClass), '. Designer keeps showing the base widget; uic includes the header.'),
        error,
        footer(el('span', { className: 'spacer' }), secondaryButton('Cancel', () => popup.close()), primaryButton('Promote', apply)),
    ], 'small');
    popup.box.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            apply();
        }
    });
    cls.focus();
}

/** A small box asking for one line of text. */
export function openPrompt(title: string, subtitle: string, label: string, initial: string, onOk: (value: string) => void): void {
    const input = el('input', { type: 'text', value: initial, className: 'wide' });
    input.setAttribute('aria-label', label);
    const apply = () => {
        const v = input.value.trim();
        if (v === '') {
            return;
        }
        popup.close();
        onOk(v);
    };
    const popup = openPopup([header(title, subtitle), el('div', { className: 'form-grid' }, el('label', {}, label), input), footer(el('span', { className: 'spacer' }), secondaryButton('Cancel', () => popup.close()), primaryButton('Add', apply))], 'small');
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            apply();
        }
    });
    input.focus();
    input.select();
}
