# Overnight progress log

Rules: local commits only (conventional commits, no co-author), never a push, nothing deleted outside files created here. Every step is verified before the next one.
The test numbers below were true at the time of writing; the commands that produce them are in README.md (Tests).

## Plan (in order)
1. Verify what is written but not yet fully tested: table/tree grid editor, main window parts, taskAction by caption.
   Suites: protocol, fuzz, npm test, e2e x3, VS Code integration.
2. README: counts re-read from the real test output.
3. Real VS Code: drag a free widget into a laid-out container (only backend-tested so far).
4. Main window menus: try driving the menu bar editor with synthesised events; stop and note it if fragile.
5. .qrc browser if budget remains.
6. Final report here.

## Done
- Verified: grid editor (table/tree), main window parts, taskAction by caption. Protocol 153+ checks, fuzz, Node, e2e x3, VS Code integration.
- Local commits created (no push, no co-author line).
- Backend refactor: backend_main.cpp (2000 lines) split into host.h + host_*.cpp + dialogs.cpp + main.cpp. Same tests green.
- Menu bar editing (QMainWindow): add menu, add entry, add separator, remove entry/menu, action properties; all through the
  engine's own menu bar editor driven by events, undoable, saved, accepted by uic.

- Live interactive preview (click, type, scroll, combo popups) verified in Chromium and in the real VS Code.
- Resources (.qrc): add/remove (undoable), contents listed, icons chosen from them, saved as Designer saves them.
- Table/tree grid editor, items editor for combo/list, buddy editor, free widget into layout, drop sides.
- Web refactor: canvas.ts split into view/tags/guides/arrows/layoutslot modules (1335 -> 930 lines for canvas.ts).

- Also done: engine task menu in the context menu (Morph into...), palette and locale editors, tab and tool box page
  headers (click to switch, double-click to rename), widgets dragged out of layouts, custom widget plugins
  (qtDesignerRevamped.pluginPaths, tested with a demo plugin), sub menus, window parts guarded (central widget move froze
  the engine: found by fuzz on a QMainWindow form, fixed).
- Latest local numbers: protocol 197 checks, Node 98, e2e 0 failures x3, VS Code integration 8 ok, corpus-ui 60 forms
  0 problems, fuzz seeds 171..178 0 problems.

## Findings / not done
- Known engine crash (stack overflow in DesignerComponents recursion), found by fuzz seed 92, only with a long exact
  sequence: rich.ui + MDI Area + group box + a tab widget move, then moving the MDI area onto the group box.
  Not reproducible with a shorter sequence (ddmin gave 7 operations). Not fixed; the page shows "engine down" and
  restarts the backend if it happens.
- Outline: the form actions and the menus (with their entries) are listed in groups.
- Menus: sub menus and tool bar entries are not editable (engine commands are not exported, events only reach the menu bar
  and its menus).

## Later session
- Action editor in the Form tab (create, edit, place in menus and tool bars, remove), custom slots/signals of the form, live style
  sheet validation, save as PNG.
- Bugs fixed: quick add row clicks killed by a native image drag; menus left as the active popup broke the next preview;
  in-place edit box sizing and toolbar overlap; rename hint wrapping; connecting to the form itself failed when children covered it.
- Test tooling: `ONLY=<label part>` filters e2e scenarios; run the fuzz with `python3 -u` (output is lost otherwise);
  never `pkill -f` a pattern that is in your own command line.
- Fuzz now finds crashes with a call stack: run with `QDR_CRASH_LOG=/tmp/qdr-crash.log` (the backend writes the stack and the
  running request there). Found and fixed this way: reparenting a free widget into a laid-out container (stack overflow, seed 63)
  and pasting a dock widget into a plain form (seed 78). The old seed 92 crash did not reproduce again on 300, 600, 1200 and 9000
  operations (hypothesis: it was the same family as seed 63; not proven).
- Known engine crash (fuzz seed 123, reproduced in 3 operations, stack overflow inside `ReparentWidgetCommand::redo`): add a tab
  widget inside a tool box page, move or reparent it out of the tool box, then reparent the tool box into that tab widget.
  Not reproducible when the tab widget was never inside the tool box. Using the engine's drop instead of the reparent command
  recurses the same way, so the cause is in the engine's state, not in this call. Not fixed; the extension reports the stack in
  its log (`backend-crash.log`) and restarts on demand.
