import { checkStyleSheet } from './dialogs';
import { el, icon } from './dom';
import { footer, header, openPopup, primaryButton, secondaryButton } from './popup';
import { S, send } from './state';

// ---- vocabulary of Qt style sheets (https://doc.qt.io/qt-6/stylesheet-reference.html) ----------------

const PROPERTIES = ['alternate-background-color', 'background', 'background-color', 'background-image', 'background-position', 'background-repeat', 'background-clip', 'background-origin', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-style', 'border-width', 'border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius', 'border-image', 'bottom', 'color', 'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'gridline-color', 'height', 'icon-size', 'image', 'image-position', 'left', 'lineedit-password-character', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'max-height', 'max-width', 'min-height', 'min-width', 'opacity', 'outline', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'position', 'right', 'selection-background-color', 'selection-color', 'show-decoration-selected', 'spacing', 'subcontrol-origin', 'subcontrol-position', 'text-align', 'text-decoration', 'top', 'width'];
const PSEUDO = [':hover', ':pressed', ':focus', ':checked', ':unchecked', ':disabled', ':enabled', ':selected', ':active', ':inactive', ':read-only', ':editable', ':on', ':off', ':open', ':closed', ':first', ':last', ':middle', ':only-one', ':horizontal', ':vertical', ':indeterminate', ':alternate', ':default', ':flat', ':maximized', ':minimized', ':window', ':!hover', ':!pressed', ':!focus', ':!checked', ':!disabled'];
const SUBCONTROLS = ['::item', '::indicator', '::drop-down', '::down-arrow', '::up-arrow', '::up-button', '::down-button', '::handle', '::groove', '::sub-line', '::add-line', '::sub-page', '::add-page', '::section', '::tab', '::tab-bar', '::pane', '::title', '::chunk', '::menu-indicator', '::branch', '::text', '::separator', '::close-button'];
const VALUES: Record<string, string[]> = {
    'border-style': ['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'],
    'font-style': ['normal', 'italic', 'oblique'],
    'font-weight': ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
    'text-align': ['left', 'right', 'center', 'justify'],
    'text-decoration': ['none', 'underline', 'overline', 'line-through'],
    position: ['relative', 'absolute'],
    'background-repeat': ['repeat-x', 'repeat-y', 'repeat', 'no-repeat'],
};
const COLORS = ['transparent', 'white', 'black', 'red', 'green', 'blue', 'gray', 'palette(window)', 'palette(base)', 'palette(text)', 'palette(button)', 'palette(highlight)', 'palette(highlighted-text)', 'palette(mid)', 'palette(dark)', 'palette(light)', 'qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #ffffff, stop:1 #cccccc)'];
const COLOR_PROPS = new Set(['color', 'background', 'background-color', 'alternate-background-color', 'border-color', 'gridline-color', 'selection-background-color', 'selection-color', 'outline']);
const CLASSES = ['QWidget', 'QPushButton', 'QToolButton', 'QLabel', 'QLineEdit', 'QTextEdit', 'QPlainTextEdit', 'QComboBox', 'QSpinBox', 'QDoubleSpinBox', 'QCheckBox', 'QRadioButton', 'QSlider', 'QScrollBar', 'QProgressBar', 'QGroupBox', 'QTabWidget', 'QTabBar', 'QListView', 'QListWidget', 'QTreeView', 'QTableView', 'QHeaderView', 'QMenu', 'QMenuBar', 'QToolBar', 'QStatusBar', 'QDialog', 'QMainWindow', 'QFrame', 'QToolTip'];

const SNIPPETS: { label: string; css: string }[] = [
    { label: 'Rounded button', css: 'QPushButton {\n    background-color: palette(button);\n    border: 1px solid palette(mid);\n    border-radius: 6px;\n    padding: 6px 14px;\n}\nQPushButton:hover { background-color: palette(light); }\nQPushButton:pressed { background-color: palette(mid); }\n' },
    { label: 'Focus ring', css: 'QLineEdit:focus, QComboBox:focus, QSpinBox:focus {\n    border: 2px solid palette(highlight);\n}\n' },
    { label: 'Flat input', css: 'QLineEdit, QSpinBox, QComboBox {\n    border: none;\n    border-bottom: 2px solid palette(mid);\n    background: transparent;\n    padding: 4px;\n}\n' },
    { label: 'Dark panel', css: 'QWidget {\n    background-color: #1e1e1e;\n    color: #d4d4d4;\n}\n' },
];

// ---- highlighting ----------------------------------------------------------------------------------

type Kind = 'comment' | 'string' | 'selector' | 'property' | 'value' | 'punct' | 'number';

/** Splits a style sheet into classed runs. It follows braces by hand, so a half typed sheet still colours. */
export function tokenize(text: string): { kind: Kind | ''; text: string }[] {
    const out: { kind: Kind | ''; text: string }[] = [];
    const push = (kind: Kind | '', t: string) => {
        if (t === '') {
            return;
        }
        const last = out[out.length - 1];
        if (last && last.kind === kind) {
            last.text += t;
        } else {
            out.push({ kind, text: t });
        }
    };
    let depth = 0;
    let inValue = false;
    let i = 0;
    while (i < text.length) {
        const c = text[i] as string;
        if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            const stop = end < 0 ? text.length : end + 2;
            push('comment', text.slice(i, stop));
            i = stop;
        } else if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < text.length && text[j] !== c && text[j] !== '\n') {
                j += text[j] === '\\' ? 2 : 1;
            }
            push('string', text.slice(i, Math.min(j + 1, text.length)));
            i = Math.min(j + 1, text.length);
        } else if (c === '{') {
            depth++;
            inValue = false;
            push('punct', c);
            i++;
        } else if (c === '}') {
            depth = Math.max(0, depth - 1);
            inValue = false;
            push('punct', c);
            i++;
        } else if (depth > 0 && c === ':' && !inValue) {
            inValue = true;
            push('punct', c);
            i++;
        } else if (depth > 0 && c === ';') {
            inValue = false;
            push('punct', c);
            i++;
        } else if (/\s/.test(c)) {
            push('', c);
            i++;
        } else {
            let j = i;
            while (j < text.length && !/[\s{};"']/.test(text[j] as string) && !(text[j] === '/' && text[j + 1] === '*') && !(depth > 0 && !inValue && text[j] === ':')) {
                j++;
            }
            const word = text.slice(i, Math.max(j, i + 1));
            push(depth === 0 ? 'selector' : inValue ? (/^[#\d.-]/.test(word) ? 'number' : 'value') : 'property', word);
            i += word.length;
        }
    }
    return out;
}

function paintInto(pre: HTMLElement, text: string): void {
    pre.replaceChildren(...tokenize(text).map((t) => (t.kind === '' ? document.createTextNode(t.text) : el('span', { className: `qss-${t.kind}` }, t.text))), document.createTextNode('\n'));
}

// ---- completion ------------------------------------------------------------------------------------

/** What could be typed at the caret: the word being typed and the candidates for it. */
export function completionsAt(text: string, caret: number): { from: number; items: string[] } {
    const before = text.slice(0, caret);
    const word = /[A-Za-z0-9_:!()#-]*$/.exec(before)?.[0] ?? '';
    const from = caret - word.length;
    const head = before.slice(0, from);
    const open = head.lastIndexOf('{');
    const inBlock = open > head.lastIndexOf('}');
    const lower = word.toLowerCase();
    const starts = (xs: string[]) => xs.filter((x) => x.toLowerCase().startsWith(lower) && x !== word);
    if (!inBlock) {
        if (word.startsWith('::')) {
            return { from, items: starts(SUBCONTROLS) };
        }
        const colon = word.indexOf(':');
        if (colon >= 0) {
            const typed = word.slice(colon);
            return { from: from + colon, items: [...PSEUDO, ...SUBCONTROLS].filter((x) => x.startsWith(typed) && x !== typed) };
        }
        const mine = [...new Set((S.snapshot?.objects ?? []).map((o) => o.class))];
        return { from, items: word === '' ? [] : starts([...mine, ...CLASSES.filter((c) => !mine.includes(c))]) };
    }
    const afterSep = head.slice(Math.max(head.lastIndexOf(';'), open) + 1);
    const colon = afterSep.indexOf(':');
    if (colon < 0) {
        return { from, items: word === '' ? [] : starts(PROPERTIES) };
    }
    const prop = afterSep.slice(0, colon).trim().toLowerCase();
    const values = VALUES[prop] ?? (COLOR_PROPS.has(prop) ? COLORS : []);
    return { from, items: word === '' ? [] : starts(values) };
}

// ---- the editor -------------------------------------------------------------------------------------

/**
 * Style sheet editor: coloured source, completion for Qt's vocabulary, snippets and a live mode that applies
 * the sheet to the form while it is typed. Closing without Apply puts the form back as it was.
 */
export function openStyleEditor(title: string, current: string, commit: (value: string) => void, canGoLive: boolean): void {
    const mirror = el('pre', { className: 'qss-mirror' });
    mirror.setAttribute('aria-hidden', 'true');
    const ta = el('textarea', { value: current, className: 'qss-input', spellcheck: false, wrap: 'off' });
    ta.setAttribute('aria-label', title);
    const suggest = el('div', { className: 'qss-suggest', role: 'listbox' });
    const status = el('span', { className: 'dim style-status' });
    status.setAttribute('aria-live', 'polite');
    const live = el('input', { type: 'checkbox', checked: canGoLive, disabled: !canGoLive });
    live.setAttribute('aria-label', 'Show the result on the form while typing');
    const liveLabel = el('label', { className: 'qss-live', title: canGoLive ? 'Apply the sheet to the form as you type' : 'Live mode needs a single selected widget' }, live, 'Live');

    // Whether the first live edit will merge into the previous undo entry (same property on the same object).
    const mergesIntoPrevious = (S.snapshot?.undoText ?? '').includes(`'styleSheet' of '${S.propertiesFor ?? ''}'`);
    let liveApplied = false;
    let applied = false;
    let sent = current;
    let timer: number | undefined;
    let items: string[] = [];
    let from = 0;
    let active = 0;

    const paint = () => {
        paintInto(mirror, ta.value);
        mirror.scrollTop = ta.scrollTop;
        mirror.scrollLeft = ta.scrollLeft;
    };
    const hideSuggest = () => {
        items = [];
        suggest.replaceChildren();
        suggest.hidden = true;
    };
    const accept = (value: string) => {
        const caret = ta.selectionStart;
        ta.setRangeText(value, from, caret, 'end');
        hideSuggest();
        ta.dispatchEvent(new Event('input'));
    };
    const showSuggest = () => {
        const found = completionsAt(ta.value, ta.selectionStart);
        items = found.items.slice(0, 8);
        from = found.from;
        active = 0;
        suggest.hidden = items.length === 0;
        suggest.replaceChildren(...items.map((it, i) => {
            const row = el('div', { className: `qa-item${i === active ? ' active' : ''}`, role: 'option' }, it);
            row.addEventListener('pointerdown', (ev) => {
                ev.preventDefault();
                accept(it);
            });
            return row;
        }));
    };
    const markActive = () => suggest.querySelectorAll('.qa-item').forEach((r, j) => r.classList.toggle('active', j === active));

    const check = () => {
        const text = ta.value;
        void checkStyleSheet(text).then((valid) => {
            if (ta.value !== text) {
                return;
            }
            status.textContent = text.trim() === '' ? '' : valid ? 'Valid style sheet' : 'Invalid style sheet';
            status.className = `style-status ${text.trim() === '' ? 'dim' : valid ? 'ok' : 'bad'}`;
            if (valid && live.checked && text !== sent) {
                sent = text;
                liveApplied = true;
                commit(text);
            }
        });
    };
    ta.addEventListener('input', () => {
        paint();
        showSuggest();
        window.clearTimeout(timer);
        timer = window.setTimeout(check, 250);
    });
    ta.addEventListener('scroll', paint);
    ta.addEventListener('blur', hideSuggest);
    ta.addEventListener('keydown', (ev) => {
        if (items.length > 0 && !suggest.hidden) {
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                active = (active + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
                markActive();
                return;
            }
            if (ev.key === 'Tab' || (ev.key === 'Enter' && !ev.ctrlKey && !ev.metaKey)) {
                ev.preventDefault();
                accept(items[active] as string);
                return;
            }
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                hideSuggest();
                return;
            }
        }
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
            ev.preventDefault();
            applyAndClose();
        } else if (ev.key === 'Tab' && !ev.shiftKey) {
            ev.preventDefault();
            ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end');
            ta.dispatchEvent(new Event('input'));
        }
    });
    // Closing the box any way but Apply undoes what live mode did.
    const revert = () => {
        if (applied || !liveApplied) {
            return;
        }
        if (mergesIntoPrevious) {
            commit(current);
        } else {
            send({ type: 'undo' });
        }
    };
    const applyAndClose = () => {
        applied = true;
        window.clearTimeout(timer);
        popup.close();
        if (ta.value !== sent) {
            commit(ta.value);
        }
    };

    const chips = el('div', { className: 'qss-chips' }, icon('sparkle'), ...SNIPPETS.map((sn) => {
        const b = el('button', { type: 'button', className: 'btn chip', title: 'Insert at the caret' }, sn.label);
        b.addEventListener('click', () => {
            ta.setRangeText(sn.css, ta.selectionStart, ta.selectionEnd, 'end');
            ta.focus();
            ta.dispatchEvent(new Event('input'));
        });
        return b;
    }));
    const popup = openPopup([header(title, 'Ctrl+Enter to apply'), chips, el('div', { className: 'qss-wrap' }, mirror, ta, suggest),
        footer(status, el('span', { className: 'spacer' }), liveLabel, secondaryButton('Cancel', () => popup.close()), primaryButton('Apply', applyAndClose))], 'text-editor style-editor', revert);
    suggest.hidden = true;
    paint();
    if (current.trim() !== '') {
        check();
    }
    ta.focus();
}
