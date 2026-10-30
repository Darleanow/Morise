// Types shared by the extension host, the webview and the native backend.
// Types only: nothing here may carry runtime code (the webview imports it with `import type`).

/** Which side of the nearest layout item a drop means. */
export type Side = 'before' | 'after';

/** A widget managed by the Designer form window. Coordinates are in snapshot image pixels. */
export interface SceneObject {
    name: string;
    class: string;
    parent: string | null;
    /** Origin (snapshot pixels) of the real parent widget; `geometry` is relative to it. */
    gx: number;
    gy: number;
    /** Managed by a layout: moving/resizing by geometry is meaningless. */
    laidOut: boolean;
    /** The menu bar, a tool bar, the status bar or the central widget of a main window: never moved or resized. */
    part?: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
    /** Tool bars only: where each entry is drawn (form pixels), in the order moveEntry counts them. */
    entries?: { x: number; y: number; w: number; h: number; separator: boolean }[];
}

/** Palette entry: indexes address QDesignerWidgetBoxInterface category/widget. */
export interface PaletteWidget {
    name: string;
    index: number;
    /** Class recorded in the .ui for this entry, e.g. QPushButton. */
    className: string;
    /** Designer's own icon for the entry, as a PNG data URL (may be empty). */
    icon: string;
}

export interface PaletteCategory {
    name: string;
    index: number;
    widgets: PaletteWidget[];
}

export interface MethodInfo {
    name: string;
    signature: string;
    params: { type: string; name: string }[];
    /** Class that declares the method. */
    owner: string;
}

/** One entry of the engine's task menu for a widget (Morph into, Size Constraints...). */
export interface TaskItem { index: number; text: string; enabled: boolean; checkable: boolean; checked: boolean; children?: TaskItem[] }

export interface DescribeResult {
    name: string;
    /** Class as recorded in the .ui (e.g. QPushButton). */
    class: string;
    hierarchy: string[];
    signals: MethodInfo[];
    slots: MethodInfo[];
    /** What the engine's task menu offers without opening a dialog. */
    tasks?: TaskItem[];
}

export interface ConnectionInfo {
    sender: string;
    signal: string;
    receiver: string;
    slot: string;
}

export type ActionName =
    | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll' | 'lower' | 'raise'
    | 'layoutHorizontal' | 'layoutVertical' | 'layoutSplitHorizontal' | 'layoutSplitVertical'
    | 'layoutGrid' | 'layoutForm' | 'breakLayout' | 'adjustSize' | 'simplifyLayout';

/** A layout managed by the engine, in snapshot pixels (inside its margins). */
export interface SceneLayout {
    owner: string;
    /** Enclosing layout when this layout is nested in another one. */
    parent?: string | null;
    name: string;
    kind: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface ContainerInfo {
    pages: string[];
    current: number;
    /** Tab headers of a tab widget in form pixels. */
    tabs?: { x: number; y: number; w: number; h: number }[];
    /** The property that holds the title of the current page. */
    titleProperty?: string;
}

export interface FormInfo {
    grid: [number, number];
    layoutDefault: [number | null, number | null];
    author: string;
    comment: string;
    exportMacro: string;
    pixmapFunction: string;
    includeHints: string[];
    resourceFiles: string[];
    /** The resource files with what they contain, to choose icons from. */
    resources: ResourceFile[];
    /** The form's actions (menu entries, tool bar buttons), for the action editor. */
    actions: ActionInfo[];
    /** The form's own slots and signals (Designer's "Edit Signals/Slots"), as signatures like save(bool). */
    customSlots: string[];
    customSignals: string[];
    /** The menus and tool bars an action can be placed in. */
    actionTargets: ActionTarget[];
    /** The action groups, with the names of the actions they hold. */
    actionGroups?: ActionGroupInfo[];
}

export interface ActionGroupInfo { name: string; exclusive: boolean; actions: string[] }

export interface ActionTarget { name: string; kind: 'menu' | 'toolbar'; title: string; /** Its entries in order: a menu entry that opens a sub menu carries that menu's name. */ entries?: { name: string; text: string; separator: boolean }[] }

export interface ActionInfo { name: string; text: string; separator: boolean; checkable: boolean; shortcut: string; hasIcon: boolean; usedIn: string[] }

export interface ResourceFile { path: string; exists: boolean; prefixes: { prefix: string; files: string[]; /** Small data URIs aligned with files, empty for what is not an image. */ thumbs: string[] }[] }

export interface PreviewResult {
    png: string;
    width: number;
    height: number;
    /** Only in the answer to opening the preview. */
    styles?: string[];
}

/** One mouse, wheel or key event of the page for the live preview. Coordinates are form pixels. */
export interface PreviewInput {
    kind: 'press' | 'release' | 'dblclick' | 'move' | 'wheel' | 'keydown' | 'keyup' | 'tick';
    x?: number;
    y?: number;
    /** 0 left, 1 middle, 2 right. */
    button?: number;
    mods?: number;
    dx?: number;
    dy?: number;
    key?: string;
}

export interface Snapshot {
    layouts: SceneLayout[];
    /** Engine messages that would have been modal dialogs in Qt Designer (consumed by the host). */
    messages?: string[];
    /** Which form-manager actions are currently enabled for the selection. */
    actions: Partial<Record<ActionName, boolean>>;
    grid: [number, number];
    /** Geometry property of the form itself: x, y, width, height. */
    formGeometry: [number, number, number, number];
    /** Base64 PNG of the real FormWindow rendered by Qt (grid and selection handles included). Its pixel size is width*dpr by height*dpr. */
    png: string;
    width: number;
    height: number;
    dpr: number;
    objects: SceneObject[];
    selection: string[];
    dirty: boolean;
    /** QUndoStack index/count. Designer may merge consecutive commands, so the host compares indexes. */
    undoIndex: number;
    undoCount: number;
    canUndo: boolean;
    canRedo: boolean;
    undoText: string;
    redoText: string;
}

export type PropertyKind =
    | 'string' | 'bool' | 'int' | 'double' | 'enum' | 'flags' | 'rect' | 'size' | 'point' | 'rectf' | 'sizef' | 'pointf'
    | 'sizePolicy' | 'font' | 'icon' | 'pixmap' | 'stringlist' | 'keysequence' | 'color' | 'url' | 'date' | 'time' | 'datetime'
    | 'palette' | 'locale' | 'unsupported';

/** A palette: colours per group and role, and the roles the widget sets itself. */
export interface PaletteValue { groups: Record<string, Record<string, string>>; set: string[] }
export interface LocaleValue { language: string; country: string }
export interface LocaleChoices { languages: string[]; countries: string[] }

export interface SizePolicyValue { h: string; v: string; hs: number; vs: number }
export interface FontValue { family: string; pointSize: number; bold: boolean; italic: boolean; underline: boolean; strikeOut: boolean }

export interface PropertyInfo {
    name: string;
    group: string;
    kind: PropertyKind;
    /** string | boolean | number | number[] | string[] | SizePolicyValue | FontValue depending on kind. */
    value: string | boolean | number | number[] | string[] | SizePolicyValue | FontValue | PaletteValue | LocaleValue;
    choices?: string[];
    typeName?: string;
    changed: boolean;
    enabled: boolean;
    attribute: boolean;
    resettable: boolean;
    /** Added to this object by the user (a dynamic property). */
    dynamic?: boolean;
    /** Small preview of an icon or pixmap, as a PNG data URL. */
    thumb?: string;
    /** Translation data of a string (what lupdate reads). */
    i18n?: { translatable: boolean; comment: string; disambiguation: string };
}

/** Editable contents of a table or tree widget. */
export type GridContents =
    | { kind: 'table'; columns: string[]; rows: string[]; cells: string[][] }
    | { kind: 'tree'; columns: string[]; items: TreeItem[] };
export interface TreeItem { cells: string[]; children: TreeItem[] }

/** One entry of a menu: an action, a separator or a sub menu. */
export interface MenuEntry { name: string; text: string; separator: boolean; menu?: string; entries?: MenuEntry[] }
export interface MenuInfo { name: string; title: string; entries: MenuEntry[] }

export interface PropertiesResult {
    class: string;
    /** The object is a layout (not a widget). */
    isLayout?: boolean;
    /** Captions of a combo box or list widget, null for other widgets. */
    items?: string[] | null;
    /** Contents of a table or tree widget, null for other widgets. */
    contents?: GridContents | null;
    /** Menus of a menu bar, null for other objects. */
    menus?: MenuInfo[] | null;
    properties: PropertyInfo[];
}

/** The last committed version of the form next to the one being edited. */
export type CompareResult =
    | { ok: true; ref: string; png: string; width: number; height: number; dpr: number; baseXml: string; currentXml: string }
    | { ok: false; error: string };

/** Backend request methods and their result types. */
export interface BackendMethods {
    open: { params: { docId: string; xml: string; path?: string }; result: Snapshot };
    close: { params: { docId: string }; result: Record<string, never> };
    snapshot: { params: { docId: string }; result: Snapshot };
    view: { params: { docId: string; scale: number }; result: Snapshot };
    gesture: { params: { docId: string; phase: 'begin' | 'end'; label?: string }; result: Snapshot };
    setGeometries: { params: { docId: string; items: { name: string; rect: number[] }[] }; result: Snapshot };
    addResource: { params: { docId: string; path: string }; result: Snapshot };
    removeResource: { params: { docId: string; path: string }; result: Snapshot };
    makeSubmenu: { params: { docId: string; menu: string; index: number }; result: Snapshot };
    addMenu: { params: { docId: string; title: string }; result: Snapshot };
    addMenuEntry: { params: { docId: string; menu: string; text?: string; separator?: boolean }; result: Snapshot };
    addAction: { params: { docId: string; text: string; name?: string; checkable?: boolean; shortcut?: string }; result: Snapshot };
    moveEntry: { params: { docId: string; target: string; from: number; to: number }; result: Snapshot };
    actionGroup: { params: { docId: string; name?: string; remove?: boolean; action?: string; group?: string }; result: Snapshot };
    useAction: { params: { docId: string; target: string; action?: string; separator?: boolean; remove?: boolean }; result: Snapshot };
    setCustomMethods: { params: { docId: string; name?: string; slots: string[]; signals: string[] }; result: Snapshot };
    checkStyleSheet: { params: { text: string }; result: { valid: boolean } };
    getClipboard: { params: Record<string, never>; result: { text: string } };
    setClipboard: { params: { text: string }; result: Record<string, never> };
    removeAction: { params: { docId: string; name: string }; result: Snapshot };
    removeMenuEntry: { params: { docId: string; menu: string; index?: number }; result: Snapshot };
    taskAction: { params: { docId: string; name: string; text?: string; path?: number[] }; result: Snapshot };
    setContents: { params: { docId: string; name: string; contents: GridContents }; result: Snapshot };
    setItems: { params: { docId: string; name: string; items: string[] }; result: Snapshot };
    moveWidget: { params: { docId: string; name: string; x: number; y: number; side?: Side; grabX?: number; grabY?: number }; result: Snapshot };
    reparent: { params: { docId: string; parent: string; items: { name: string; rect: number[] }[] }; result: Snapshot };
    previewEvent: { params: { docId: string } & PreviewInput; result: PreviewResult };
    previewStop: { params: { docId: string }; result: Record<string, never> };
    preview: { params: { docId: string; style?: string; dark?: boolean; scale?: number }; result: PreviewResult };
    containerInfo: { params: { docId: string; name: string }; result: ContainerInfo };
    setCurrentPage: { params: { docId: string; name: string; index: number }; result: Snapshot };
    pageOp: { params: { docId: string; name: string; op: 'add' | 'addAfter' | 'remove' }; result: Snapshot };
    tabOrder: { params: { docId: string }; result: { order: string[] } };
    setTabOrder: { params: { docId: string; order: string[] }; result: Snapshot };
    promote: { params: { docId: string; names: string[]; className: string; include: string }; result: Snapshot };
    demote: { params: { docId: string; name: string }; result: Snapshot };
    formInfo: { params: { docId: string }; result: FormInfo };
    setFormInfo: { params: { docId: string; info: Partial<FormInfo> }; result: Snapshot };
    addDynamicProperty: { params: { docId: string; name: string; property: string; kind: string; value: unknown }; result: Snapshot };
    removeDynamicProperty: { params: { docId: string; name: string; property: string }; result: Snapshot };
    connect: { params: { docId: string; sender: string; signal: string; receiver: string; slot: string }; result: Snapshot };
    disconnect: { params: { docId: string; sender: string; signal: string; receiver: string; slot: string }; result: Snapshot };
    describe: { params: { docId: string; name: string }; result: DescribeResult };
    history: { params: { docId: string }; result: { items: string[]; index: number } };
    connections: { params: { docId: string }; result: { connections: ConnectionInfo[] } };
    palette: { params: Record<string, never>; result: { categories: PaletteCategory[]; fonts: string[]; locales: LocaleChoices } };
    addWidget: { params: { docId: string; category: number; index: number; x: number; y: number; side?: Side }; result: Snapshot };
    action: { params: { docId: string; action: ActionName }; result: Snapshot };
    select: { params: { docId: string; names: string[] }; result: Snapshot };
    hitTest: { params: { docId: string; x: number; y: number }; result: { name: string | null } };
    properties: { params: { docId: string; name: string }; result: PropertiesResult };
    setProperty: { params: { docId: string; name: string; names?: string[]; property: string; value: unknown }; result: Snapshot };
    resetProperty: { params: { docId: string; name: string; property: string }; result: Snapshot };
    undo: { params: { docId: string }; result: Snapshot };
    redo: { params: { docId: string }; result: Snapshot };
    contents: { params: { docId: string }; result: { xml: string; warnings: string[] } };
    markSaved: { params: { docId: string }; result: Snapshot };
}

export type BackendMethod = keyof BackendMethods;

/** Messages webview -> extension host. */
export type WebviewToHost =
    | { type: 'ready' }
    /** Pixel density the page wants the form rendered at (devicePixelRatio * zoom). */
    | { type: 'view'; scale: number }
    | { type: 'hitSelect'; x: number; y: number }
    | { type: 'selectNames'; names: string[] }
    | { type: 'setProperty'; name: string; names?: string[]; property: string; value: unknown }
    | { type: 'resetProperty'; name: string; property: string }
    | { type: 'addWidget'; category: number; index: number; x: number; y: number; side?: Side }
    /** Search the workspace for text (e.g. `ui->okButton`). */
    | { type: 'findInCode'; query: string }
    | { type: 'copyText'; text: string }
    | { type: 'saveImage' }
    /** Ask for the committed (git HEAD) version of the file, drawn and as XML, to compare with. */
    | { type: 'compare' }
    | { type: 'checkStyleSheet'; text: string }
    /** Abort the gesture in progress: undo what the live preview already applied. */
    | { type: 'cancelGesture' }
    | { type: 'setGeometries'; items: { name: string; rect: number[] }[] }
    /** Move widgets into another container; rects are in form pixels. */
    | { type: 'pickResource' }
    | { type: 'removeResource'; path: string }
    | { type: 'makeSubmenu'; menu: string; index: number }
    | { type: 'addMenu'; title: string }
    | { type: 'addMenuEntry'; menu: string; text?: string; separator?: boolean }
    | { type: 'addAction'; text: string; checkable?: boolean; shortcut?: string }
    | { type: 'removeAction'; name: string }
    | { type: 'setCustomMethods'; slots: string[]; signals: string[] }
    | { type: 'moveEntry'; target: string; from: number; to: number }
    | { type: 'actionGroup'; name?: string; remove?: boolean; action?: string; group?: string }
    | { type: 'useAction'; target: string; action?: string; separator?: boolean; remove?: boolean }
    | { type: 'removeMenuEntry'; menu: string; index?: number }
    | { type: 'taskAction'; name: string; text?: string; path?: number[] }
    | { type: 'setContents'; name: string; contents: GridContents }
    | { type: 'setItems'; name: string; items: string[] }
    | { type: 'moveWidget'; name: string; x: number; y: number; side?: Side; grabX?: number; grabY?: number }
    | { type: 'reparent'; parent: string; items: { name: string; rect: number[] }[] }
    | { type: 'preview'; style: string; dark: boolean; scale: number }
    | ({ type: 'previewEvent' } & PreviewInput)
    | { type: 'previewStop' }
    | { type: 'pageOp'; name: string; op: 'add' | 'addAfter' | 'remove' }
    | { type: 'setCurrentPage'; name: string; index: number }
    | { type: 'setTabOrder'; order: string[] }
    | { type: 'promote'; names: string[]; className: string; include: string }
    | { type: 'demote'; name: string }
    | { type: 'setFormInfo'; info: Partial<FormInfo> }
    | { type: 'addDynamicProperty'; name: string; property: string; kind: string; value: unknown }
    | { type: 'removeDynamicProperty'; name: string; property: string }
    | { type: 'connect'; sender: string; signal: string; receiver: string; slot: string }
    | { type: 'disconnect'; sender: string; signal: string; receiver: string; slot: string }
    /** Ask for the signals and slots of an object (answered with `describeResult`). */
    | { type: 'describe'; name: string }
    /** Let the user pick an image file, then set it on a property. */
    | { type: 'pickFile'; name: string; property: string }
    /** Undo or redo several steps at once (used by the history menu). */
    | { type: 'undo'; steps?: number }
    | { type: 'redo'; steps?: number }
    /** Ask for the undo history (answered with `history`). */
    | { type: 'history' }
    /** Restart the Qt engine after it stopped. */
    | { type: 'restartBackend' }
    /** Show the properties of an object that is not a widget (a layout) without changing the selection. */
    | { type: 'inspect'; name: string | null }
    /** Which optional data the page wants in each state message. */
    | { type: 'want'; tabOrder: boolean; formInfo: boolean }
    /** Groups the live commands of a drag into one undo step. */
    | { type: 'gesture'; phase: 'begin' | 'end'; label: string }
    | { type: 'action'; action: ActionName };

/** Messages extension host -> webview. */
export type HostToWebview =
    | { type: 'state'; snapshot: Snapshot; properties: PropertiesResult | null; propertiesFor: string | null; palette: PaletteCategory[]; fonts: string[]; locales?: LocaleChoices; notices: string[]; code: DescribeResult | null; connections: ConnectionInfo[]; container: ContainerInfo | null; tabOrder?: string[]; formInfo?: FormInfo }
    | { type: 'preview'; result: PreviewResult; style: string; dark: boolean }
    | { type: 'previewFrame'; result: PreviewResult }
    | { type: 'describeResult'; name: string; result: DescribeResult | null }
    | { type: 'styleSheetCheck'; text: string; valid: boolean }
    | { type: 'compareResult'; result: CompareResult }
    | { type: 'history'; items: string[]; index: number }
    | { type: 'error'; message: string }
    | { type: 'backendStatus'; text: string };
