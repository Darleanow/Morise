# Overnight progress log

Rules: no commit, no push, nothing deleted outside files created here. Every step is verified before the next one.

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

## Findings / not done
- Known engine crash (stack overflow in DesignerComponents recursion), found by fuzz seed 92, only with a long exact
  sequence: rich.ui + MDI Area + group box + a tab widget move, then moving the MDI area onto the group box.
  Not reproducible with a shorter sequence (ddmin gave 7 operations). Not fixed; the page shows "engine down" and
  restarts the backend if it happens.
- Menus: sub menus and tool bar entries are not editable (engine commands are not exported, events only reach the menu bar
  and its menus).
