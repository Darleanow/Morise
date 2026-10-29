import { toast } from './toast';
import type { ConnectionInfo, ContainerInfo, DescribeResult, FormInfo, PaletteCategory, PropertiesResult, Snapshot, WebviewToHost } from '../protocol';

interface VsCodeApi {
    postMessage(message: WebviewToHost): void;
    getState(): unknown;
    setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export type RightTab = 'properties' | 'code' | 'connections' | 'form';

/** View preferences, persisted per editor by VS Code (webview state). */
export interface Prefs {
    zoom: number;
    showLayouts: boolean;
    leftW: number;
    rightW: number;
    paletteH: number;
    leftOpen: boolean;
    rightOpen: boolean;
    rightTab: RightTab;
    changedOnly: boolean;
    snapToWidgets: boolean;
    recent: { category: number; index: number }[];
}

export const DEFAULT_PREFS: Prefs = {
    zoom: 1, showLayouts: true, leftW: 240, rightW: 330, paletteH: 300, leftOpen: true, rightOpen: true,
    rightTab: 'properties', changedOnly: false, snapToWidgets: true, recent: [],
};

export const prefs: Prefs = { ...DEFAULT_PREFS };

const saved = api.getState();
if (typeof saved === 'object' && saved !== null) {
    Object.assign(prefs, saved);
}

export function savePrefs(): void {
    api.setState({ ...prefs });
}

/** Everything the page knows about the document, replaced wholesale by each `state` message. */
export const S = {
    snapshot: undefined as Snapshot | undefined,
    properties: null as PropertiesResult | null,
    propertiesFor: null as string | null,
    palette: [] as PaletteCategory[],
    code: null as DescribeResult | null,
    connections: [] as ConnectionInfo[],
    container: null as ContainerInfo | null,
    tabOrder: undefined as string[] | undefined,
    formInfo: undefined as FormInfo | undefined,
    fonts: [] as string[],
    locales: { languages: [] as string[], countries: [] as string[] },
    /** The page is in connect mode: dragging from a widget to another creates a signal/slot connection. */
    mode: 'select' as 'select' | 'connect',
    hovered: null as string | null,
    focusedLayout: null as string | null,
};

/** Class name to Designer icon (data URL), learned from the palette. */
export const classIcons = new Map<string, string>();

export function send(message: WebviewToHost): void {
    api.postMessage(message);
}

/** Copies through the host (the webview has no clipboard permission) and says so. */
export function copyText(text: string): void {
    send({ type: 'copyText', text });
    toast(`Copied ${text.length > 70 ? `${text.slice(0, 67)}\u2026` : text}`);
}

export function rememberWidget(category: number, index: number): void {
    prefs.recent = [{ category, index }, ...prefs.recent.filter((r) => !(r.category === category && r.index === index))].slice(0, 6);
    savePrefs();
}
