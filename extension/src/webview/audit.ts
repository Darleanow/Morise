import { el, icon } from './dom';
import { footer, header, openPopup, secondaryButton } from './popup';
import { send } from './state';
import { toast } from './toast';
import { auditForm, type Finding } from './xmlaudit';

export function requestAudit(): void {
    send({ type: 'audit' });
}

/** The answer to `audit`: what a screen reader user, a translator or a reader of the code would trip over. */
export function onAuditResult(xml: string): void {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
        toast('The form could not be read for the check', { kind: 'error' });
        return;
    }
    const findings = auditForm(doc);
    const warnings = findings.filter((f) => f.severity === 'warning').length;
    const row = (f: Finding) => {
        const names = f.target.split(', ');
        const r = el('div', { className: `cmp-change audit-${f.severity}`, role: 'listitem', tabIndex: 0 },
            icon(f.severity === 'warning' ? 'warning' : 'info'), el('div', { className: 'cmp-text' }, el('div', {}, el('b', {}, f.target), ' ', el('span', { className: 'dim' }, f.cls)), el('div', { className: 'dim cmp-line' }, f.message)));
        const go = () => {
            send({ type: 'selectNames', names: f.cls === 'mnemonic' ? names : [f.target] });
            popup.close();
        };
        r.addEventListener('click', go);
        r.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                go();
            }
        });
        return r;
    };
    const body = findings.length === 0
        ? [el('div', { className: 'hint' }, 'Nothing to report: every field has a label or an accessible name, and the shortcuts are unique.')]
        : [...findings.filter((f) => f.severity === 'warning'), ...findings.filter((f) => f.severity === 'info')].map(row);
    const popup = openPopup([header('Form check', findings.length === 0 ? 'all good' : `${warnings} to fix · ${findings.length - warnings} suggestions`),
        el('div', { className: 'cmp-list audit-list', role: 'list' }, ...body), footer(el('span', { className: 'spacer' }), secondaryButton('Close', () => popup.close()))], 'compare audit');
}
