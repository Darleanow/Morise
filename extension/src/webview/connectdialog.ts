import type { DescribeResult, MethodInfo } from '../protocol';
import { el, icon } from './dom';
import { footer, header, openPopup, primaryButton, secondaryButton, type Popup } from './popup';
import { S, send } from './state';

const pending = new Map<string, (d: DescribeResult | null) => void>();

/** The host answers `describe` requests with `describeResult`. */
export function onDescribeResult(name: string, result: DescribeResult | null): void {
    pending.get(name)?.(result);
    pending.delete(name);
}

function describe(name: string): Promise<DescribeResult | null> {
    if (S.code && S.code.name === name) {
        return Promise.resolve(S.code);
    }
    return new Promise((resolve) => {
        pending.set(name, resolve);
        send({ type: 'describe', name });
        setTimeout(() => {
            if (pending.delete(name)) {
                resolve(null);
            }
        }, 4000);
    });
}

const norm = (t: string) => t.replace(/\bconst\b|&/g, '').replace(/\s+/g, '').trim();

/** Qt's rule: a slot may take fewer arguments than the signal gives, but the ones it takes must match. */
export function compatible(signal: MethodInfo, slot: MethodInfo): boolean {
    if (slot.params.length > signal.params.length) {
        return false;
    }
    return slot.params.every((p, i) => norm(p.type) === norm(signal.params[i]?.type ?? ''));
}

const GENERIC = new Set(['QObject', 'QWidget']);

export interface ConnectInit {
    sender?: string;
    receiver?: string;
    at?: { x: number; y: number };
}

/** Choose the signal and slot, like Designer's connection dialog; sender and receiver can be picked when unknown. */
export async function openConnectDialog(init: ConnectInit): Promise<void> {
    const objects = (S.snapshot?.objects ?? []).map((o) => o.name);
    let sender = init.sender ?? '';
    let receiver = init.receiver ?? '';
    let senderInfo: DescribeResult | null = null;
    let receiverInfo: DescribeResult | null = null;
    let signal: MethodInfo | undefined;
    let slot: MethodInfo | undefined;
    let showAll = false;
    let popup: Popup | undefined;

    const pick = (value: string, onChange: (v: string) => void): HTMLSelectElement => {
        const s = el('select', {});
        s.append(el('option', { value: '' }, '— choose —'));
        for (const n of objects) {
            s.append(el('option', { value: n, selected: n === value }, n));
        }
        s.addEventListener('change', () => onChange(s.value));
        return s;
    };
    const sig = el('div', { className: 'conn-list', role: 'listbox' });
    const slt = el('div', { className: 'conn-list', role: 'listbox' });
    const sigFilter = el('input', { type: 'search', placeholder: 'Filter signals' });
    const sltFilter = el('input', { type: 'search', placeholder: 'Filter slots' });
    const ok = primaryButton('Connect', () => {
        if (signal && slot && sender && receiver) {
            popup?.close();
            send({ type: 'connect', sender, signal: signal.signature, receiver, slot: slot.signature });
        }
    }, true);
    const all = el('input', { type: 'checkbox' });
    all.addEventListener('change', () => {
        showAll = all.checked;
        paint();
    });
    const senderPick = init.sender ? el('b', {}, sender) : pick(sender, (v) => { sender = v; void load('sender'); });
    const receiverPick = init.receiver ? el('b', {}, receiver) : pick(receiver, (v) => { receiver = v; void load('receiver'); });

    const row = (m: MethodInfo, selected: boolean, onPick: () => void) => {
        const r = el('div', { className: `conn-item${selected ? ' active' : ''}`, role: 'option', tabIndex: 0 }, el('code', {}, m.signature), el('span', { className: 'dim' }, m.owner));
        r.setAttribute('aria-selected', String(selected));
        r.addEventListener('click', onPick);
        r.addEventListener('dblclick', () => ok.click());
        r.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                onPick();
            }
        });
        return r;
    };

    const paint = () => {
        const sq = sigFilter.value.trim().toLowerCase(), lq = sltFilter.value.trim().toLowerCase();
        const signals = (senderInfo?.signals ?? []).filter((m) => (showAll || !GENERIC.has(m.owner) || signal === m) && m.signature.toLowerCase().includes(sq));
        const slots = (receiverInfo?.slots ?? []).filter((m) => (showAll || !GENERIC.has(m.owner) || slot === m) && (!signal || compatible(signal, m)) && m.signature.toLowerCase().includes(lq));
        sig.replaceChildren(...(signals.length ? signals.map((m) => row(m, m === signal, () => {
            signal = m;
            if (slot && !compatible(m, slot)) {
                slot = undefined;
            }
            paint();
        })) : [el('div', { className: 'hint' }, sender ? 'No signal matches.' : 'Choose the sender first.')]));
        slt.replaceChildren(...(slots.length ? slots.map((m) => row(m, m === slot, () => {
            slot = m;
            paint();
        })) : [el('div', { className: 'hint' }, !receiver ? 'Choose the receiver first.' : signal ? 'No compatible slot.' : 'Choose a signal first.')]));
        ok.disabled = !(signal && slot && sender && receiver);
    };
    sigFilter.addEventListener('input', paint);
    sltFilter.addEventListener('input', paint);

    async function load(which: 'sender' | 'receiver'): Promise<void> {
        const name = which === 'sender' ? sender : receiver;
        const info = name ? await describe(name) : null;
        if (which === 'sender') {
            senderInfo = info;
            signal = undefined;
        } else {
            receiverInfo = info;
        }
        slot = undefined;
        paint();
    }

    popup = openPopup([
        header('New connection', 'signal → slot'),
        el('div', { className: 'conn-cols' },
            el('div', { className: 'conn-col' }, el('div', { className: 'conn-title' }, icon('broadcast'), 'Sender ', senderPick), sigFilter, sig),
            el('div', { className: 'conn-arrow' }, icon('arrow-right')),
            el('div', { className: 'conn-col' }, el('div', { className: 'conn-title' }, icon('inbox'), 'Receiver ', receiverPick), sltFilter, slt)),
        footer(el('label', { className: 'flag' }, all, 'Show inherited signals and slots'), el('span', { className: 'spacer' }), secondaryButton('Cancel', () => popup?.close()), ok),
    ], 'connect');
    if (init.at) {
        popup.box.dataset.at = `${Math.round(init.at.x)},${Math.round(init.at.y)}`;
    }
    paint();
    await Promise.all([sender ? load('sender') : Promise.resolve(), receiver ? load('receiver') : Promise.resolve()]);
    sigFilter.focus();
}
