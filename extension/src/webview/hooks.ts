export interface Command {
    id: string;
    label: string;
    /** Extra words the search also matches. */
    keywords?: string;
    icon: string;
    shortcut?: string;
    enabled?: boolean;
    /** Grey text after the label (a class, a value). */
    detail?: string;
    /** Heading shown above the first row of each section when results are mixed. */
    section?: string;
    run: () => void;
}

/**
 * Late-bound callbacks so feature modules can call each other without import cycles.
 * main.ts assigns the real implementations at start-up.
 */
export const hooks = {
    openContextMenu: (_clientX: number, _clientY: number): void => undefined,
    openQuickAdd: (_at?: { x: number; y: number }): void => undefined,
    focusProperty: (_name: string): void => undefined,
    rename: (): void => undefined,
    /** Whether the selected widget has a text property that can be edited in place. */
    editableText: (): boolean => false,
    editText: (): void => undefined,
    /** Select the widget, then open its in-place editor as soon as the engine has answered. */
    editTextWhenReady: (_name: string): void => undefined,
    /** Everything the > command search offers right now. */
    commands: (): Command[] => [],
    objects: (): Command[] => [],
    properties: (): Command[] => [],
    openCommands: (): void => undefined,
    openHelp: (): void => undefined,
    openPreview: (): void => undefined,
    openConnect: (_init: { sender?: string; receiver?: string; at?: { x: number; y: number } }): void => undefined,
};
