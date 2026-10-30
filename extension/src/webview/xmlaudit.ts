// Checks on the saved form (the .ui XML) that a person would otherwise find only by using the app with a screen reader or a translator.

export interface Finding {
    severity: 'warning' | 'info';
    target: string;
    cls: string;
    message: string;
}

const TEXT_BUTTONS = new Set(['QPushButton', 'QToolButton', 'QCheckBox', 'QRadioButton', 'QCommandLinkButton']);
const FIELDS = new Set(['QLineEdit', 'QTextEdit', 'QPlainTextEdit', 'QComboBox', 'QSpinBox', 'QDoubleSpinBox', 'QDateEdit', 'QTimeEdit', 'QDateTimeEdit', 'QSlider', 'QDial', 'QListWidget', 'QTableWidget', 'QTreeWidget', 'QListView', 'QTableView', 'QTreeView']);
const DEFAULT_NAME = /^(pushButton|toolButton|checkBox|radioButton|label|lineEdit|textEdit|plainTextEdit|comboBox|spinBox|doubleSpinBox|slider|dial|groupBox|frame|widget|tabWidget|listWidget|tableWidget|treeWidget|progressBar|layoutWidget|horizontalLayout|verticalLayout|gridLayout|formLayout)(_\d+)?$/;

function own(e: Element, tag: string, name: string): Element | undefined {
    return Array.from(e.children).find((c) => c.tagName === tag && c.getAttribute('name') === name);
}

function stringOf(e: Element | undefined): string {
    return (e?.getElementsByTagName('string')[0]?.textContent ?? '').trim();
}

export function auditForm(doc: Document): Finding[] {
    const out: Finding[] = [];
    const widgets = Array.from(doc.getElementsByTagName('widget'));
    const names = new Set(widgets.map((w) => w.getAttribute('name') ?? ''));
    const buddies = new Set<string>();
    for (const w of widgets) {
        const rawBuddy = (own(w, 'property', 'buddy')?.getElementsByTagName('cstring')[0]?.textContent ?? '').trim();
        if (rawBuddy !== '') {
            buddies.add(rawBuddy);
            if (!names.has(rawBuddy)) {
                out.push({ severity: 'warning', target: w.getAttribute('name') ?? '', cls: w.getAttribute('class') ?? '', message: `its buddy "${rawBuddy}" does not exist` });
            }
        }
    }
    const mnemonics = new Map<string, string[]>();
    for (const w of widgets) {
        const name = w.getAttribute('name') ?? '';
        const cls = w.getAttribute('class') ?? '';
        const accessible = stringOf(own(w, 'property', 'accessibleName'));
        const text = stringOf(own(w, 'property', 'text'));
        const hasIcon = own(w, 'property', 'icon') !== undefined;
        if (TEXT_BUTTONS.has(cls) && text === '' && accessible === '' && stringOf(own(w, 'property', 'toolTip')) === '') {
            out.push({ severity: 'warning', target: name, cls, message: hasIcon ? 'an icon-only button needs an accessible name or a tool tip' : 'has no text, accessible name or tool tip' });
        }
        if (FIELDS.has(cls) && accessible === '' && !buddies.has(name)) {
            out.push({ severity: 'warning', target: name, cls, message: 'has no label pointing at it (buddy) and no accessible name' });
        }
        const m = /&([^&])/.exec(text);
        if (m && own(w, 'property', 'text')?.getElementsByTagName('string')[0]?.getAttribute('notr') !== 'true') {
            const key = (m[1] as string).toLowerCase();
            mnemonics.set(key, [...(mnemonics.get(key) ?? []), name]);
        }
        if (DEFAULT_NAME.test(name) && name !== '') {
            out.push({ severity: 'info', target: name, cls, message: 'still has its default name; a meaningful one makes the code readable' });
        }
    }
    for (const [key, owners] of mnemonics) {
        if (owners.length > 1) {
            out.push({ severity: 'warning', target: owners.join(', '), cls: 'mnemonic', message: `Alt+${key.toUpperCase()} is used by ${owners.length} widgets` });
        }
    }
    const stops = Array.from(doc.getElementsByTagName('tabstop')).map((t) => (t.textContent ?? '').trim());
    if (stops.length > 0) {
        for (const w of widgets) {
            const name = w.getAttribute('name') ?? '';
            if (FIELDS.has(w.getAttribute('class') ?? '') && !stops.includes(name)) {
                out.push({ severity: 'info', target: name, cls: w.getAttribute('class') ?? '', message: 'is not in the tab order' });
            }
        }
    }
    const seen = new Map<string, string>();
    for (const a of Array.from(doc.getElementsByTagName('action'))) {
        const sc = stringOf(own(a, 'property', 'shortcut'));
        const name = a.getAttribute('name') ?? '';
        if (sc !== '') {
            const other = seen.get(sc.toLowerCase());
            if (other) {
                out.push({ severity: 'warning', target: name, cls: 'QAction', message: `uses the shortcut ${sc}, already taken by ${other}` });
            } else {
                seen.set(sc.toLowerCase(), name);
            }
        }
    }
    return out;
}
