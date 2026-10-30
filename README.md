# Qt Designer Revamped

Edit Qt `.ui` files in a VS Code tab, driven by the **real Qt Designer form engine**
(`libQt6Designer` + `libQt6DesignerComponents`), not a re-implementation.

Personal project. Source audited: qttools tag `6.11.3` (`vendor/qttools`). Built against Qt 6.11.3.

## Architecture (option C: native backend around existing Designer components)

```
VS Code extension host (TypeScript)  <-- stdio, JSON lines -->  designer_backend (C++, QApplication offscreen)
  CustomEditorProvider                                            QDesignerFormEditorInterface
  document lifecycle, save, undo, backup                          QDesignerFormWindowInterface (real FormWindow)
        ^ postMessage                                             QUndoStack, property sheets, QDesignerResource
        v
Webview (TypeScript, HTML, CSS with --vscode-* variables)
  image of the form + object tree + property inspector
```

- The Qt widgets are **rendered by Qt** (`QWidget::grab()` on the real `FormWindow`, grid and selection
  handles included) and shown as a PNG. A Qt widget cannot be placed in the DOM; the image is the
  mechanism, its limits are listed below.
- Every edit goes through Designer's own commands (`QDesignerFormWindowCursorInterface::setWidgetProperty`),
  so Designer's undo stack is authoritative. VS Code undo/redo call `undo`/`redo` on it.
- Saving uses `QDesignerFormWindowInterface::contents()` (Designer's `QDesignerResource`), written to a
  temp file and renamed over the target.

## Build and run

The Qt Designer sources (tag `6.11.3`) are expected in `vendor/qttools` (not committed):
`git clone --depth 1 --branch v6.11.3 https://code.qt.io/qt/qttools.git vendor/qttools`.


```bash
# Qt 6.11.3 (done with aqtinstall into ~/Qt)
export PATH=$HOME/Qt/6.11.3/gcc_64/bin:$PATH
cd backend && cmake -S . -B build -G Ninja -DCMAKE_PREFIX_PATH=$HOME/Qt/6.11.3/gcc_64 && cmake --build build
cd ../extension && npm install && npm run build
```

Or skip all of that: open this repository's root folder in VS Code and press **F5**. The launch configurations
build the backend (configure and compile with CMake) and the extension first, then start the Extension
Development Host with a sample form already open. Pick the configuration in the Run and Debug dropdown
(`free.ui` for free-form editing, `sample.ui` for a layout, or an empty window). Ctrl+Shift+B runs the same build.
The backend path defaults to `../backend/build/designer_backend`; override with `qtDesignerRevamped.backendPath`.

## Tests

| Command | What it covers |
|---|---|
| `python3 -I backend/tests/protocol_test.py` | Backend protocol end to end (275 checks: every property kind, multi-edit, layouts, batch geometry, reparenting, preview, pages, tab order, promotion, form settings, dynamic properties, connections, gestures, scroll area drops, messages, close cycles, save, `uic`) |
| `python3 -u backend/tests/corpus_test.py [--fuzz N --seed S] [--skip-corpus]` | Robustness: loads the `.ui` corpus, round-trips every property of every widget (about 32k on 90 documents), then replays N random operations (fuzz) and reports any backend crash with the operation log |
| `backend/testdata/roundtrip.sh <dir> <workdir>` | Round-trips every `.ui` under a directory without edits and compares `uic` output |
| `cd extension && npm test` | 116 Node tests: client against the real backend, message validation, the whole webview in jsdom (structure, security, gestures, inspector, code snippets, panels) |
| `cd extension && npm run test:integration` | Real VS Code 1.105.1 (downloaded): custom editor, dirty state, undo/redo, save, external change, add/move/delete, a resize gesture as one native undo step, and connections/promotion/layout properties saved and accepted by `uic`. Needs a display (WSLg works) and no `ELECTRON_RUN_AS_NODE` in the environment |

## What the editor does today

**Layout.** Widgets palette and Outline on the left, canvas in the middle, inspector on the right, status bar at
the bottom. The columns are real splitters (drag, double-click to reset, arrow keys); both sidebars collapse;
sizes and the active tab are remembered.

**Selecting.** Click, Shift/Ctrl-click, or drag a band over empty space (Shift adds). Ctrl+A selects all.
A floating bar on the selection offers only the actions that are currently possible.

**Moving, resizing, aligning.**
- Drag to move (several selected widgets move together); 8 handles resize; the form itself resizes from its right
  and bottom edges with the layouts reflowing live. Snapping goes to Designer's grid *and* to neighbouring widgets'
  edges and centres, with red guides; Alt bypasses both; Esc cancels. A drag is one undo step.
- Dropping widgets on another container reparents them (keeping their place on screen).
- **Search everything** (`/` or double-click the canvas): type a word to find widgets to add, objects of the form and commands in one list; `>` limits it to commands, `@` jumps to an object, `:` jumps to a property of the selection.
- **Style sheet editor:** coloured source, completion of Qt style sheet properties, pseudo-states, sub-controls and colours, snippets, and a Live mode that paints the form while you type (Cancel puts it back with no undo entry left).
- **Compare with the last commit** (`> compare`): reads `git show HEAD:<file>`, draws the committed form next to the current one (swipe, fade or side by side) and lists what was added, removed or changed per object; a click selects the object. Needs git on the PATH and a file known to git.
- **Form check** (`> check the form`, toolbar when wide): reads the saved XML and lists buttons without text, fields with no label (buddy) or accessible name, buddies that do not exist, repeated Alt mnemonics and action shortcuts, widgets missing from the tab order and default object names. A click selects the widget.
- **Align** (left, centres, right, top, bottom), **Distribute** horizontally/vertically and **Same width/height/size**,
  from the toolbar, the context menu or the floating bar: one undo step each. One widget aligns to its parent,
  several to the bounds of the selection; sizes follow the first selected widget.
- Arrow keys nudge (Shift resizes) one or several widgets.

**Keyboard.** `?` opens the shortcut sheet, `>` in the quick add box switches to command mode (every action by name),
Ctrl+Up/Down walks the widget hierarchy, Space or middle mouse pans, Ctrl+0 / Ctrl+1 / Ctrl+plus / Ctrl+minus fit,
reset and zoom. Deleting or cutting shows a toast with Undo; the history chevron next to Undo jumps several steps.

**Layouts.** Dragging a widget that a layout owns shows an insertion line and a tag ("Insert before X"); releasing moves it
there through the engine's own same-form move (one undo step). New widgets, from the palette, `/` or double-click, land at
the pointed cell; with `/` they go right after the selected widget.

**Alignment and buddies.** Alignment is two rows of buttons: a click sets, a second click on the active button clears
that axis, and its reset button is always there. A label's `buddy` is picked from the widgets of the form.
A free widget dropped on a layout-managed container joins its layout, and a widget dragged out of its layout onto a
free area becomes free there, under the point where you grabbed it.

**Items.** Combo boxes and list widgets get an Items editor in the inspector (edit, add, remove, reorder; one undo step
each, icons and other roles of unchanged items are kept). It uses the engine's own `ChangeListContentsCommand`.

**Tables, trees, menus, resources.** Table and tree widgets get a grid editor (headers, rows, cells, nested items). On a
`QMainWindow` form the context menu creates the menu bar, tool bars and status bar; menus are edited from the menu bar's
inspector (add menu, entry, separator, sub menu, remove). Resource files (`.qrc`) are added in the Form tab and their icons are
offered by every icon editor; the form saves `<include location=...>` and `resource=` like Designer.

**Actions.** The Form tab lists the form's actions with their shortcut and where they are used. You can create one (text,
checkable), edit it in the inspector, put it into a menu or tool bar (or take it out), add a separator to a tool bar, and
remove it. Creation and removal use the engine's own commands; placing uses a small undo command of ours because the engine's
is not exported. Each step is one undo step and the saved `.ui` passes `uic`.
Action groups (`QActionGroup`) are created and removed in the same tab and an action is put in one from its place button; the engine has no
command for them, so these are small undo commands of ours, and the saved `<actiongroup>` nests its actions and passes `uic`.

**Signals and slots of the form.** The Form tab edits the form's own custom slots and signals (Designer's "Edit Signals/Slots"):
they are offered in the connection dialog, saved in the `.ui` (`<slots>`) and one undo step each. Connecting a widget to the
form itself works even when its children cover it. **Style sheets** are validated live in the larger editor with Qt's own CSS
parser. **Save as image** (command palette) writes the runtime render as a PNG.

**New forms.** `Qt Designer: New Form...` (command palette, or right-click a folder in the Explorer) offers Designer's templates (widget, dialogs with the buttons connected to `accept()`/`reject()`, dialog without buttons, main window), asks where to save it and opens it in the designer. A brand new empty `.ui` file (File > New File) offers the same templates when it is opened.

**Translation data.** Every text property has a small globe button: mark a text as not translatable and give lupdate a disambiguation and a comment for the translator (saved as `notr`, `comment` and `extracomment`).

**Widget tasks.** The context menu has a *Widget tasks* submenu with what Designer's own task menu offers without a
dialog: *Morph into* (a push button becomes a tool button, a check box...), size constraints, layout alignment, button
groups, page operations. Entries that would open a dialog ("Change text...") are left out.

**Palette and locale.** A widget's palette is edited as colours per role and group (only the roles you change are saved; the
reset button goes back to the style). The locale has language and country lists.

**Tabs.** Click a tab header (or a tool box page header) on the form to switch to that page; double-click it to rename it in place.

**Custom widget plugins.** Qt Designer plugins (Qwt, KDE widgets, your own) are loaded from the folders listed in the
`qtDesignerRevamped.pluginPaths` setting (each folder holds a `designer` directory, like `QT_PLUGIN_PATH`). They must be
built for the same Qt version as the backend. Their widgets appear in the palette, in their own group. The build also
produces a tiny demo plugin (`backend/testplugin`) that the tests use.

**Adding.** Palette with Designer's icons, search and a Recent group (drag, double-click or Enter), `/` for a quick
search, double-click on empty space to add right there, Ctrl+D to duplicate.

**Editing text.** Double-click or Enter edits the widget's text in place; F2 renames the object (valid C++
identifier checked).

**Properties.** Typed editors for: strings (with a larger editor for style sheets and long text), numbers, booleans,
enums, **alignment as buttons**, other flags as a checklist, **size policy**, **font**, **icons and pixmaps** (file
picker, thumbnail), string lists, key sequences, colours, dates, URLs, rectangles/sizes/points. "Modified only"
filter, reset buttons, dynamic properties (add/remove). With several widgets selected an edit applies to all of
them as one undo step. **Layouts have their own property sheet** (margins, spacing, size constraint, stretch):
click a layout in the outline.

**Signals and slots.** Press **F4** (connect mode) and drag from one widget to another: pick the signal and a
*compatible* slot in a dialog like Designer's, and the connection is created by the engine's own signal/slot
editor (undoable, saved in the `.ui`). Existing connections are drawn as arrows and listed in the Connections tab,
where they can be created, selected, deleted, or searched for in the workspace. The Code tab gives ready-to-paste
`connect()` calls, slot declarations and `ui->name` accessors with the right declaring classes.

**Containers.** Tab widgets, stacked widgets and tool boxes: page controls on the floating bar (previous/next,
add, delete; undoable). Promote a widget to a custom class (and demote) from the context menu.

**Form tab.** Grid size, layout default margin/spacing, author, comment, export macro, include hints, and the
keyboard focus order (numbered on the form; drag rows or use the arrows).

**Preview.** Ctrl+R or the toolbar button shows the form as the application will draw it (no grid, no design-time
widgets) in any installed Qt style, light or dark. It is live: click, type, drag sliders, scroll, Tab through the focus
chain, open combo boxes (their list is drawn over the form). Hover effects and animations are not forwarded.

**Documents.** VS Code undo/redo, dirty state, atomic save, hot-exit backup, external change reload, close.
Rendering is done by Qt at `devicePixelRatio * zoom`, so text is crisp on HiDPI screens and at any zoom.

## Source layout

```
backend/src/backend_main.cpp        the Qt host around the Designer engine (JSON lines on stdio)
extension/src/                      extension host: provider, backend client, protocol types, message validation
extension/src/webview/*.ts          the page, one module per concern, bundled by esbuild into media/webview/main.js
  canvas.ts  gestures, overlay, handles, zoom       inspector.ts  properties / code / connections
  palette.ts outline.ts toolbar.ts statusbar.ts     menu.ts quickadd.ts rename.ts splitter.ts
  actions.ts geometry.ts state.ts hooks.ts dom.ts   main.ts  wiring and keyboard
extension/tools/e2e-browser.js      real-browser end-to-end test (see below)
```

## Visual check and browser end-to-end test

`extension/tools/e2e-browser.js` runs the real webview bundle in Chromium against the real backend, with a small
stand-in for the extension host, and drives it with real mouse and keyboard input: it resizes the form and
widgets, checks that layouts reflow, that a drag is one undo step, that Escape cancels, the context menu, rename,
quick add, palette drag and drop, splitters and zoom, rubber-band selection, group moves, alignment, reparenting, in-place editing, property editors, connect mode, tab pages, preview, tab order, promotion, layout properties, duplicate, dynamic properties and undo/redo, measures, command mode, help sheet, delete toast, history menu (see the file for the exact count). Set `SHOTS_DIR` to also save screenshots.
It needs `playwright-core` and a Chromium installed outside the project, for example in a scratch folder:
`npm i playwright-core && npx playwright-core install chromium`, then
`NODE_PATH=<scratch>/node_modules CHROME=<chromium> node extension/tools/e2e-browser.js`.
Theme variables are simulated approximations of VS Code's, so this checks behaviour and legibility, not exact colours.

## Known limits (verified or observed, not guesses)

- **Actions on the canvas:** an action row of the Form tab can be dragged onto a tool bar (it is added) or onto the menu bar (a small menu asks which menu). The entries of a tool bar are reordered by dragging them along the bar (a blue line shows where one lands; Escape cancels). Entries of a menu, which is only drawn while open, and of the menu bar are not draggable on the canvas; every menu and tool bar can be reordered in the Form tab with arrows (small undo commands of ours; the saved `.ui` keeps the new order and passes `uic`).
- **Rulers** (command `> rulers`) show form pixels along the top and left edges. Drag from a ruler to pull a guide into the form: moves and resizes snap to it (Alt bypasses), a grip on the ruler moves it again, and dropping it outside the form or double-clicking the grip removes it. Guides live in the editor session only; they are not written to the `.ui`.
- **Why geometry instead of mouse replay:** Designer starts a `QDrag` (`QDesignerMimeData::execDrag`) when a
  widget is dragged, which runs a nested event loop; replaying that headless was judged unsafe, so moves go
  through the same `SetPropertyCommand` Designer itself uses for resizing.
- **Property editors:** palettes are edited by role; a few exotic types are still shown read-only. String edits keep Designer's
  translatable/comment metadata. Icons are stored as the path you chose (Designer saves it relative to the `.ui`).
- **Connections** are created by driving the engine's own signal/slot editor with synthesised mouse events and
  answering its connect dialog from the page's choice; this relies on Designer's internal widget names
  (`signalList`, `slotList`) and is pinned to Qt 6.11.3.
- **Preview** forwards mouse, wheel and keyboard to a form the backend keeps alive offscreen and sends back pictures. Hover states, the caret blink and tool tips (shown after the pointer rests for 0.6 s, drawn over the form) are reproduced; drag and drop and menus opened by the application are not.
- **Round trip fidelity:** on the 84 `.ui` files of qttools, all load and all saved files are accepted by `uic`.
  Without any edit, 28 give the same `uic` output (the 44 counted earlier used a looser comparison) and 56 differ.
  The differing lines of all 56 were grouped by pattern, not read file by file: spacer variable names
  (`spacerItem` becomes `spacer`/`verticalSpacer`), layout names that were empty, geometry of widgets a layout positions,
  the form size grown to its layout's minimum, the order of `setMinimum`/`setMaximum`, a dropped `NoButton` flag,
  `QIcon` built with `addFile` instead of the shortcut constructor, an added `AlignBaseline` flag, and a
  tool box page without a label saved with an empty one. A bogus `height` property on a form (a `lupdate` test file)
  is kept as a dynamic property. None of these was found to change what the form shows, but that was judged from the diff
  text, not by running the generated code.
  Designer rewrites the XML from the widget tree, and `ui4` rejects unknown elements, so unknown XML is not preserved.
- **Scroll areas and dock widgets** hold one widget: dropping a second one on them is refused with a message (the
  engine would free the first one without telling the rest of the editor, which crashed the backend; found by fuzzing).
  Connections whose endpoint vanished that way are detected and refused instead of dereferenced.
- **Reparenting** is refused for containers that already have a layout (Designer would insert into the layout).
- **Clipboard:** copies are mirrored to the system clipboard as Designer XML and a paste reads it back, so it works between documents, VS Code windows and applications that keep that text (checked in real VS Code with the system clipboard). Pasting other kinds of text does nothing.
- **Host quirks found:** the host must resize the `FormWindow` to the form size or the saved geometry changes;
  static form-editor plugins must be initialised or `<connections>` are dropped; a shell-exported
  `QT_SCALE_FACTOR` scales snapshots (the backend neutralises it); a paste into a laid-out container is refused by
  the engine with a message.
- **Teardown:** closing a document is done properly (50 open/edit/close cycles, 192 kB RSS growth). Destroying
  `QApplication`/`FormEditor` at process exit still segfaults, so the backend exits with `_Exit` on stdin EOF.
- **Not verified:** hot-exit backup restore, the "changed on disk while dirty" prompt, Windows/macOS.
- **Packaging:** the default build has an absolute RUNPATH to `~/Qt`. `backend/scripts/bundle-backend.sh <dir>` builds a relocatable folder (executable with RUNPATH `$ORIGIN/lib`, the Qt libraries and plugins, 78 MB); started from an empty environment it loads Qt 6.11.3 from that folder, and the extension uses `extension/bin/designer_backend` when it exists. Linux only. `npm run package` in `extension/` produces `qt-designer-revamped-linux-x64.vsix` (uses vsce 2.32 with a small `File` polyfill so it runs on Node 18).
- **Webview UI Toolkit:** `@vscode/webview-ui-toolkit` is deprecated on npm, so plain HTML controls styled with
  VS Code theme variables are used.
- **Licenses:** `lib/` is LGPL-3/GPL; `components/` is GPL-3 with Qt exception. Linking them makes the backend
  binary GPL-3 if distributed.
