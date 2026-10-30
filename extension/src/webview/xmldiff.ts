// Structural comparison of two .ui files: what was added, removed or changed, widget by widget.

export interface Change {
    kind: 'added' | 'removed' | 'changed';
    /** Object name (widget, layout, spacer, action) or a section such as "connections". */
    target: string;
    /** What it is, e.g. QPushButton. */
    cls: string;
    lines: string[];
    /** The object exists in the current form, so it can be selected. */
    inForm: boolean;
}

interface Item { name: string; cls: string; tag: string; parent: string | null; place: string; props: Map<string, string> }

const OBJECT_TAGS = new Set(['widget', 'layout', 'spacer', 'action', 'actiongroup']);

function text(e: Element): string {
    return (e.textContent ?? '').trim();
}

/** A short, human readable value: "OK", "10, 20, 100 x 30", or the compact XML for what has no nicer form. */
export function summarize(e: Element | null): string {
    if (!e) {
        return '';
    }
    const num = (tag: string) => text(e.getElementsByTagName(tag)[0] ?? e);
    switch (e.tagName) {
        case 'rect': return `${num('x')}, ${num('y')}, ${num('width')} × ${num('height')}`;
        case 'size': return `${num('width')} × ${num('height')}`;
        case 'string': case 'number': case 'bool': case 'enum': case 'set': case 'cstring': case 'double': case 'float': return text(e);
        default: return new XMLSerializer().serializeToString(e).replace(/\s+/g, ' ').replace(/> </g, '><').trim();
    }
}

function collect(doc: Document): { items: Map<string, Item>; connections: Set<string>; tabstops: string; resources: string } {
    const items = new Map<string, Item>();
    const walk = (e: Element, parent: string | null, place: string) => {
        const name = e.getAttribute('name') ?? '';
        const props = new Map<string, string>();
        for (const c of Array.from(e.children)) {
            if (c.tagName === 'property' || c.tagName === 'attribute') {
                props.set(`${c.tagName === 'attribute' ? 'attribute ' : ''}${c.getAttribute('name') ?? ''}`, summarize(c.firstElementChild));
            }
        }
        if (name !== '') {
            items.set(name, { name, cls: e.getAttribute('class') ?? e.tagName, tag: e.tagName, parent, place, props });
        }
        for (const c of Array.from(e.children)) {
            if (c.tagName === 'item' && e.tagName === 'layout') {
                const inner = Array.from(c.children).find((k) => OBJECT_TAGS.has(k.tagName));
                const at = ['row', 'column', 'rowspan', 'colspan'].filter((a) => c.hasAttribute(a)).map((a) => `${a} ${c.getAttribute(a)}`).join(', ');
                if (inner) {
                    walk(inner, name || parent, at);
                }
            } else if (OBJECT_TAGS.has(c.tagName)) {
                walk(c, name || parent, '');
            }
        }
    };
    const top = doc.documentElement;
    for (const c of Array.from(top.children)) {
        if (OBJECT_TAGS.has(c.tagName)) {
            walk(c, null, '');
        }
    }
    const connections = new Set(Array.from(doc.getElementsByTagName('connection')).map((c) => {
        const t = (tag: string) => text(c.getElementsByTagName(tag)[0] ?? c);
        return `${t('sender')}.${t('signal')} → ${t('receiver')}.${t('slot')}`;
    }));
    const tabstops = Array.from(doc.getElementsByTagName('tabstop')).map(text).join(', ');
    const resources = Array.from(doc.getElementsByTagName('include')).map((i) => i.getAttribute('location') ?? '').join(', ');
    return { items, connections, tabstops, resources };
}

const quote = (v: string) => (v.length > 60 ? `${v.slice(0, 57)}…` : v);

export function diffForms(base: Document, current: Document): Change[] {
    const a = collect(base);
    const b = collect(current);
    const out: Change[] = [];
    for (const [name, now] of b.items) {
        const was = a.items.get(name);
        if (!was) {
            out.push({ kind: 'added', target: name, cls: now.cls, lines: now.parent ? [`inside ${now.parent}`] : [], inForm: true });
            continue;
        }
        const lines: string[] = [];
        if (was.cls !== now.cls) {
            lines.push(`class: ${was.cls} → ${now.cls}`);
        }
        if (was.parent !== now.parent) {
            lines.push(`moved from ${was.parent ?? 'the top'} to ${now.parent ?? 'the top'}`);
        }
        if (was.place !== now.place) {
            lines.push(`layout cell: ${was.place || 'none'} → ${now.place || 'none'}`);
        }
        for (const key of new Set([...was.props.keys(), ...now.props.keys()])) {
            const before = was.props.get(key);
            const after = now.props.get(key);
            if (before !== after) {
                lines.push(before === undefined ? `${key}: set to ${quote(after ?? '')}` : after === undefined ? `${key}: removed (was ${quote(before)})` : `${key}: ${quote(before)} → ${quote(after)}`);
            }
        }
        if (lines.length > 0) {
            out.push({ kind: 'changed', target: name, cls: now.cls, lines, inForm: true });
        }
    }
    for (const [name, was] of a.items) {
        if (!b.items.has(name)) {
            out.push({ kind: 'removed', target: name, cls: was.cls, lines: was.parent ? [`was inside ${was.parent}`] : [], inForm: false });
        }
    }
    for (const c of b.connections) {
        if (!a.connections.has(c)) {
            out.push({ kind: 'added', target: c, cls: 'connection', lines: [], inForm: false });
        }
    }
    for (const c of a.connections) {
        if (!b.connections.has(c)) {
            out.push({ kind: 'removed', target: c, cls: 'connection', lines: [], inForm: false });
        }
    }
    if (a.tabstops !== b.tabstops) {
        out.push({ kind: 'changed', target: 'tab order', cls: 'form', lines: [`${a.tabstops || 'none'} → ${b.tabstops || 'none'}`], inForm: false });
    }
    if (a.resources !== b.resources) {
        out.push({ kind: 'changed', target: 'resource files', cls: 'form', lines: [`${a.resources || 'none'} → ${b.resources || 'none'}`], inForm: false });
    }
    return out;
}
