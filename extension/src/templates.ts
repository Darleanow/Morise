/** Starting points for a new form, the same ones Qt Designer's New Form dialog offers. */
export type TemplateId = 'widget' | 'dialogButtonsBottom' | 'dialogButtonsRight' | 'dialog' | 'mainWindow';

export interface FormTemplate {
    id: TemplateId;
    label: string;
    detail: string;
    /** Qt class of the form. */
    base: 'QWidget' | 'QDialog' | 'QMainWindow';
}

export const TEMPLATES: FormTemplate[] = [
    { id: 'widget', label: 'Widget', detail: 'An empty QWidget', base: 'QWidget' },
    { id: 'dialogButtonsBottom', label: 'Dialog with Buttons at the Bottom', detail: 'QDialog with OK and Cancel, already connected to accept() and reject()', base: 'QDialog' },
    { id: 'dialogButtonsRight', label: 'Dialog with Buttons on the Right', detail: 'QDialog with a vertical OK and Cancel box', base: 'QDialog' },
    { id: 'dialog', label: 'Dialog without Buttons', detail: 'An empty QDialog', base: 'QDialog' },
    { id: 'mainWindow', label: 'Main Window', detail: 'QMainWindow with a central widget, menu bar and status bar', base: 'QMainWindow' },
];

/** A valid C++ class name from what the user typed as a file name. */
export function classNameFor(fileBase: string): string {
    const words = fileBase.replace(/\.ui$/i, '').split(/[^A-Za-z0-9_]+/).filter(Boolean);
    const joined = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    const name = joined === '' ? 'Form' : /^[A-Za-z_]/.test(joined) ? joined : `Form${joined}`;
    return name;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function rect(w: number, h: number): string {
    return `  <property name="geometry">\n   <rect><x>0</x><y>0</y><width>${w}</width><height>${h}</height></rect>\n  </property>\n`;
}

function connections(sender: string, form: string): string {
    const one = (signal: string, slot: string) => `  <connection>\n   <sender>${sender}</sender>\n   <signal>${signal}</signal>\n   <receiver>${form}</receiver>\n   <slot>${slot}</slot>\n  </connection>\n`;
    return ` <connections>\n${one('accepted()', 'accept()')}${one('rejected()', 'reject()')} </connections>\n`;
}

/** The .ui text of a template for a class called `name`. */
export function templateXml(id: TemplateId, rawName: string): string {
    const name = escape(rawName);
    const head = `<?xml version="1.0" encoding="UTF-8"?>\n<ui version="4.0">\n <class>${name}</class>\n`;
    const title = `  <property name="windowTitle">\n   <string>${name}</string>\n  </property>\n`;
    const tail = ' <resources/>\n';
    switch (id) {
        case 'widget':
            return `${head} <widget class="QWidget" name="${name}">\n${rect(400, 300)}${title} </widget>\n${tail} <connections/>\n</ui>\n`;
        case 'dialog':
            return `${head} <widget class="QDialog" name="${name}">\n${rect(400, 300)}${title} </widget>\n${tail} <connections/>\n</ui>\n`;
        case 'dialogButtonsBottom':
            return `${head} <widget class="QDialog" name="${name}">\n${rect(400, 300)}${title}`
                + `  <widget class="QDialogButtonBox" name="buttonBox">\n   <property name="geometry">\n    <rect><x>30</x><y>240</y><width>341</width><height>32</height></rect>\n   </property>\n`
                + `   <property name="orientation">\n    <enum>Qt::Horizontal</enum>\n   </property>\n   <property name="standardButtons">\n    <set>QDialogButtonBox::Cancel|QDialogButtonBox::Ok</set>\n   </property>\n  </widget>\n`
                + ` </widget>\n${tail}${connections('buttonBox', name)}</ui>\n`;
        case 'dialogButtonsRight':
            return `${head} <widget class="QDialog" name="${name}">\n${rect(400, 300)}${title}`
                + `  <widget class="QDialogButtonBox" name="buttonBox">\n   <property name="geometry">\n    <rect><x>290</x><y>20</y><width>81</width><height>241</height></rect>\n   </property>\n`
                + `   <property name="orientation">\n    <enum>Qt::Vertical</enum>\n   </property>\n   <property name="standardButtons">\n    <set>QDialogButtonBox::Cancel|QDialogButtonBox::Ok</set>\n   </property>\n  </widget>\n`
                + ` </widget>\n${tail}${connections('buttonBox', name)}</ui>\n`;
        case 'mainWindow':
            return `${head} <widget class="QMainWindow" name="${name}">\n${rect(800, 600)}${title}`
                + `  <widget class="QWidget" name="centralwidget"/>\n  <widget class="QMenuBar" name="menubar">\n   <property name="geometry">\n    <rect><x>0</x><y>0</y><width>800</width><height>24</height></rect>\n   </property>\n  </widget>\n`
                + `  <widget class="QStatusBar" name="statusbar"/>\n </widget>\n${tail} <connections/>\n</ui>\n`;
    }
}
