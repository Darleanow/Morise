<p align="center"><img src="extension/media/icon.png" width="96" alt=""></p>

# Morise

Edit Qt `.ui` files in a VS Code tab, with the real Qt Designer form engine behind it.

Morise does not re-implement Designer. A small C++ backend loads `libQt6Designer` and `libQt6DesignerComponents`, renders the form with Qt and applies every edit through Designer's own commands. The saved file is what Designer would have written, and `uic` accepts it. The interface around it is a modern webview that follows your VS Code theme.

Independent project, not affiliated with The Qt Company. Built against Qt 6.12.0. Linux x64 only for now.

## Features

**Build forms**
- Drag widgets from the palette, or press `/` and type a name. Double-click empty space to add right there.
- Move, resize and align with snapping to the grid, to neighbouring widgets and to guides you pull out of the rulers (`> rulers`). Alt bypasses snapping, Esc cancels, every gesture is one undo step.
- Lay out with the toolbar or with `H` `V` `G` `F` (horizontal, vertical, grid, form) and `B` to break a layout. The status bar tells you when a form or container has no layout.
- Drop a widget on another container to reparent it. Drag a laid-out widget to reorder it inside its layout.

**Edit everything Designer edits**
- Typed property editors for every kind, a style sheet editor with completion and a live mode, palettes by role, translation metadata, dynamic properties. Editing several widgets applies to all of them as one undo step.
- Signals and slots: press `F4`, drag from one widget to another, pick a compatible signal and slot. Connections are drawn on the form and listed in a tab.
- Menus, tool bars, actions and action groups, resource files, table and tree contents, tab order, custom widget plugins, promotion to custom classes.

**Work faster**
- `/` searches widgets to add, objects of the form and commands in one list. `>` limits it to commands, `@` jumps to an object, `:` to a property.
- Live preview (`Ctrl+R`) in any installed Qt style, light or dark, with real mouse and keyboard input.
- Compare with the last git commit, and a form check for missing labels, mnemonics, accessible names and tab order.
- `?` lists every shortcut. Using the mouse on something that has a key shows that key once.

## Install

Build the `.vsix` (see below) and run `code --install-extension extension/morise-linux-x64.vsix`.

## Build from source

You need Qt 6.12.0 for Linux with its Designer libraries, CMake, Ninja, Node 18 or later, and the qttools sources for the same version (the backend uses a few private Designer headers):

```bash
git clone --depth 1 --branch v6.12.0 https://code.qt.io/qt/qttools.git vendor/qttools

export PATH=$HOME/Qt/6.12.0/gcc_64/bin:$PATH
cmake -S backend -B backend/build -G Ninja -DCMAKE_PREFIX_PATH=$HOME/Qt/6.12.0/gcc_64
cmake --build backend/build

cd extension && npm install && npm run build
```

Open the repository in VS Code and press F5 to start an Extension Development Host with a sample form. The backend path defaults to `backend/build/designer_backend` and can be set with `morise.backendPath`. Designer plugins are loaded from the folders in `morise.pluginPaths`; each folder holds a `designer` directory, like `QT_PLUGIN_PATH`, and the plugins must be built for the same Qt version.

To package: `backend/scripts/bundle-backend.sh extension/bin` copies the backend with the Qt libraries it needs (about 78 MB, relocatable), then `npm run package` in `extension/` writes `morise-linux-x64.vsix`.

## How it works

```
VS Code extension host (TypeScript)  <-- JSON lines on stdio -->  designer_backend (C++, offscreen QApplication)
  custom editor, undo, save, backup                                 QDesignerFormEditorInterface, FormWindow
        ^ postMessage                                               undo stack, property sheets, QDesignerResource
        v
Webview (TypeScript, CSS on --vscode-* variables)
  image of the form, outline, inspector
```

- A Qt widget cannot live in the DOM, so the form is rendered by Qt (`QWidget::grab()` on the real `FormWindow`) and shown as an image. Clicks are hit-tested by the engine.
- Designer's undo stack is the source of truth. VS Code undo and redo call it.
- Saving uses `QDesignerFormWindowInterface::contents()`, written to a temporary file and renamed over the target.
- Moves go through the `SetPropertyCommand` Designer uses for resizing. Replaying a mouse drag would start a `QDrag` and a nested event loop, which is unsafe offscreen.
- Connections are made by driving the engine's own signal/slot editor with synthesised mouse events, so they rely on Designer's internal widget names and are tied to the Qt version.

```
backend/src/       the Designer host, one file per concern (forms, menus, actions, geometry, preview...)
extension/src/     extension host: provider, backend client, protocol types, message validation
extension/src/webview/   the page, one module per concern, bundled by esbuild
```

## Tests

| Command | Covers |
|---|---|
| `python3 -I backend/tests/protocol_test.py` | The backend protocol end to end (286 checks, including `uic` on saved files) |
| `python3 -u backend/tests/corpus_test.py [--fuzz N --seed S]` | Loads the qttools `.ui` corpus, round-trips every property (about 37 000 on 98 documents), then replays random operations and reports any crash |
| `backend/testdata/roundtrip.sh <dir> <workdir>` | Round-trips every `.ui` without edits and compares `uic` output |
| `cd extension && npm test` | 119 Node tests: client against the real backend, message validation, the whole webview in jsdom |
| `cd extension && npm run test:integration` | A real VS Code: open, dirty state, undo, save, external change, gestures, connections. Needs a display |
| `node extension/tools/e2e-browser.js` | The webview in Chromium against the real backend, with real mouse and keyboard input. Needs `playwright-core` and a Chromium (`NODE_PATH=<dir>/node_modules CHROME=<chromium>`) |

## Known limits

- **Round trip.** On the 86 `.ui` files of qttools 6.12.0, all load and every saved file is accepted by `uic`. Without any edit, 45 produce the same `uic` output and 41 differ in small ways (spacer variable names, empty layout names, a layout's minimum size applied to the form, the order of some setters, an added `AlignBaseline` flag, and similar). The differences were grouped from the diff text on Qt 6.11.3 and were not shown to change what a form displays. Designer rewrites the XML from the widget tree, so XML it does not know is not preserved.
- **Menus and menu bars** are only drawn while open, so their entries cannot be dragged on the canvas. Reorder them with the arrows in the Form tab. Tool bar entries can be dragged.
- **Guides** from the rulers live in the editor session and are not saved in the `.ui`.
- **Scroll areas and dock widgets** hold one widget. A second drop is refused with a message, because the engine would free the first one behind the editor's back.
- **Reparenting** into a container that already has a layout is refused (Designer would insert into the layout).
- **Preview** forwards mouse, wheel and keyboard. Hover, caret blink and tool tips are reproduced. Drag and drop and menus opened by the application are not.
- **A few exotic property types** are shown read-only.
- **Clipboard.** Copies are mirrored to the system clipboard as Designer XML, so paste works between documents and windows. Other text is ignored.
- **Teardown.** Destroying `QApplication` at exit still segfaults, so the backend leaves with `_Exit` when stdin closes. Closing a form that has menu editors used to crash too (Designer's `QDesignerMenu` handles a focus event while being destroyed); the backend now takes the focus and the filters away first. If the backend dies anyway, the extension restarts it and reopens every form from the engine's XML kept a moment behind your edits (the undo history before the crash is lost), and a save that hits the dead backend is retried once. Closing a document is clean (50 open, edit, close cycles, 192 kB growth).
- **Not verified:** Windows and macOS, restoring a hot-exit backup, the prompt for a file changed on disk while dirty.

## License

`GPL-3.0-only WITH Qt-GPL-exception-1.0`, the license of the Qt Designer code this project builds on. See [LICENSE](LICENSE), [LICENSES/](LICENSES) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The packaged extension bundles Qt and the Designer libraries, so distributing it means distributing GPL-covered binaries: keep the notices with it and make the matching sources available.
