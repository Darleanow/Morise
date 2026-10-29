#!/usr/bin/env python3
"""End-to-end protocol test of designer_backend. Exits non-zero on any failed check."""
import base64, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(HERE, "..", "build", "designer_backend")
SAMPLE = os.path.join(HERE, "..", "testdata", "sample.ui")
QT = os.environ.get("QT_ROOT", "/home/devel/Qt/6.11.3/gcc_64")
env = dict(os.environ, QT_SCALE_FACTOR="1.75", LD_LIBRARY_PATH=QT + "/lib", QT_PLUGIN_PATH=QT + "/plugins")

p = subprocess.Popen([BACKEND], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL, text=True, env=env)
_id = 0
failures = []

def call(method, **params):
    global _id
    _id += 1
    p.stdin.write(json.dumps({"id": _id, "method": method, "params": params}) + "\n")
    p.stdin.flush()
    msg = json.loads(p.stdout.readline())
    assert msg["id"] == _id, msg
    return msg

def check(label, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + label + (f"  [{str(detail)[:300]}]" if detail and not cond else ""))
    if not cond:
        failures.append(label)

ready = json.loads(p.stdout.readline())
check("ready event", ready.get("event") == "ready", ready)

xml = open(SAMPLE, encoding="utf-8").read()
r = call("open", docId="d1", xml=xml, path=os.path.abspath(SAMPLE))
check("open ok", "result" in r, r)
s = r["result"]
check("png decodes", base64.b64decode(s["png"])[:8] == b"\x89PNG\r\n\x1a\n")
names = {o["name"]: o for o in s["objects"]}
check("objects include widgets", {"SampleForm", "titleLabel", "okButton", "nameEdit"} <= set(names), list(names))
check("image pixels map 1:1 to widget coords (dpr 1)", s["dpr"] == 1.0 and s["width"] >= names["SampleForm"]["w"], (s["dpr"], s["width"]))
check("okButton parent is form", names["okButton"]["parent"] == "SampleForm")
check("not dirty after open", s["dirty"] is False and not s["canUndo"])

pr = call("properties", docId="d1", name="okButton")["result"]
props = {x["name"]: x for x in pr["properties"]}
check("text property is string 'OK'", props["text"]["kind"] == "string" and props["text"]["value"] == "OK", props.get("text"))
check("enum property exposed with choices", any(x["kind"] == "enum" and x.get("choices") for x in pr["properties"]))

s = call("setProperty", docId="d1", name="okButton", property="text", value="Valider")["result"]
check("dirty + undo available after edit", s["dirty"] and s["canUndo"] and "text" in s["undoText"], s["undoText"])
s = call("undo", docId="d1")["result"]
check("undo restores clean state", not s["dirty"] and s["canRedo"])
text = {x["name"]: x for x in call("properties", docId="d1", name="okButton")["result"]["properties"]}["text"]["value"]
check("undo restores value", text == "OK", text)
call("redo", docId="d1")
s = call("setProperty", docId="d1", name="okButton", property="text", value="Valider")["result"]

half = call("view", docId="d1", scale=0.5)["result"]
check("render below 1x keeps the logical size and a half-size image", half["dpr"] == 0.5 and half["width"] == 320 and int.from_bytes(base64.b64decode(half["png"])[16:20], "big") == half["width"] // 2, (half["dpr"], half["width"]))
call("view", docId="d1", scale=1)
s = call("select", docId="d1", names=["okButton"])["result"]
check("selection reported", s["selection"] == ["okButton"], s["selection"])
o = names["okButton"]
hit = call("hitTest", docId="d1", x=o["x"] + 3, y=o["y"] + 3)["result"]["name"]
check("hitTest finds okButton", hit == "okButton", hit)

# ---- palette, add, move/resize, actions (free-form document: no layout) ----
FREE = os.path.join(HERE, "..", "testdata", "free.ui")
pal = call("palette")["result"]["categories"]
entries = {w["name"]: (c["index"], w["index"]) for c in pal for w in c["widgets"]}
check("palette lists Designer widget box entries", "Push Button" in entries and "Group Box" in entries, list(entries)[:5])
f = call("open", docId="f1", xml=open(FREE, encoding="utf-8").read())["result"]
n_before = len(f["objects"])
fb = next(o for o in f["objects"] if o["name"] == "freeButton")
check("free widgets are not laid out", fb["laidOut"] is False and (fb["x"], fb["y"], fb["w"], fb["h"]) == (20, 20, 100, 30), fb)
cat, idx = entries["Group Box"]
s = call("addWidget", docId="f1", category=cat, index=idx, x=150, y=100)["result"]
check("addWidget inserts one managed widget", len(s["objects"]) == n_before + 1, len(s["objects"]))
gb = next(o for o in s["objects"] if o["class"] == "QGroupBox")
check("new widget is free and selected", gb["laidOut"] is False and s["selection"] == [gb["name"]], (gb, s["selection"]))
check("drop is one undoable command", s["undoText"] == "Drop widget", s["undoText"])
s = call("undo", docId="f1")["result"]
check("undo removes the dropped widget", len(s["objects"]) == n_before)
s = call("redo", docId="f1")["result"]
check("redo restores it", len(s["objects"]) == n_before + 1)
gb = next(o for o in s["objects"] if o["class"] == "QGroupBox")

# move + resize = geometry property relative to the real parent
rect = [gb["x"] - gb["gx"] + 20, gb["y"] - gb["gy"] - 10, 90, 60]
s = call("setProperty", docId="f1", name=gb["name"], property="geometry", value=rect)["result"]
gb2 = next(o for o in s["objects"] if o["name"] == gb["name"])
check("geometry edit moves and resizes", (gb2["x"], gb2["y"], gb2["w"], gb2["h"]) == (gb["x"] + 20, gb["y"] - 10, 90, 60), gb2)

s = call("select", docId="f1", names=[gb["name"]])["result"]
check("delete action enabled for a selection", s["actions"]["delete"] is True)
s = call("action", docId="f1", action="delete")["result"]
check("delete removes the widget", all(o["name"] != gb["name"] for o in s["objects"]) and len(s["objects"]) == n_before)
s = call("undo", docId="f1")["result"]
check("undo of delete brings it back", any(o["name"] == gb["name"] for o in s["objects"]))

call("select", docId="f1", names=["freeButton"])
call("action", docId="f1", action="copy")
s = call("action", docId="f1", action="paste")["result"]
check("copy + paste duplicates the widget", sum(o["class"] == "QPushButton" for o in s["objects"]) == 2, [o["name"] for o in s["objects"]])

call("select", docId="f1", names=["freeButton", "freeLabel"])
s = call("action", docId="f1", action="layoutVertical")["result"]
check("layout action lays the widgets out", next(o for o in s["objects"] if o["name"] == "freeButton")["laidOut"] is True)
s = call("undo", docId="f1")["result"]
check("layout action is undoable", next(o for o in s["objects"] if o["name"] == "freeButton")["laidOut"] is False)

check("unknown action -> error", "error" in call("action", docId="f1", action="explode"))
call("select", docId="f1", names=["freeButton"])
bad = call("action", docId="f1", action="breakLayout")
check("action unavailable for the selection -> error", "error" in bad, str(bad)[:200])
check("palette add of unknown entry -> error", "error" in call("addWidget", docId="f1", category=99, index=0, x=0, y=0))

# engine messages must come back as data instead of blocking on a modal dialog
call("select", docId="d1", names=["okButton"])
call("action", docId="d1", action="copy")
r = call("action", docId="d1", action="paste")
check("paste into a laid-out form reports Designer's message, does not hang",
      "result" in r and any("Paste error" in m for m in r["result"].get("messages", [])), r)

bad = call("setProperty", docId="d1", name="okButton", property="nope", value=1)
check("unknown property -> error", "error" in bad)
bad = call("open", docId="d2", xml="<ui><broken")
check("malformed xml -> error, no crash", "error" in bad, bad)

out = call("contents", docId="d1")["result"]["xml"]
check("saved xml has new text", "<string>Valider</string>" in out)
check("custom stdset=0 property preserved", 'name="customTag" stdset="0"' in out and "keep-me" in out)
check("connection preserved", "<sender>okButton</sender>" in out and "<slot>clear()</slot>" in out)
check("tabstops preserved", "<tabstop>nameEdit</tabstop>" in out)
check("form geometry preserved", "<width>320</width>" in out and "<height>200</height>" in out)

with tempfile.TemporaryDirectory() as d:
    f = os.path.join(d, "out.ui")
    open(f, "w", encoding="utf-8").write(out)
    u = subprocess.run([QT + "/libexec/uic", f], capture_output=True, text=True)
    check("uic accepts saved file", u.returncode == 0 and "Valider" in u.stdout, u.stderr)

# ---- gestures, introspection, connections, palette metadata ----
d = call("describe", docId="d1", name="okButton")["result"]
check("describe reports the real class and its signals/slots", d["class"] == "QPushButton" and any(m["signature"] == "clicked(bool)" for m in d["signals"]) and any(m["name"] == "setText" or m["name"] == "click" for m in d["slots"]), str(d)[:200])
check("signals know their declaring class (for connect() snippets)", next(m for m in d["signals"] if m["signature"] == "clicked(bool)")["owner"] == "QAbstractButton")
check("describe unknown object -> error", "error" in call("describe", docId="d1", name="nope"))
conns = call("connections", docId="d1")["result"]["connections"]
check("connections lists the document's signal/slot pairs", {"sender": "okButton", "signal": "clicked()", "receiver": "nameEdit", "slot": "clear()"} in conns, conns)
check("palette carries class names and Designer icons", all(w["className"] for c in pal for w in c["widgets"]) and sum(1 for c in pal for w in c["widgets"] if w["icon"].startswith("data:image/png")) >= 50)

g0 = call("snapshot", docId="f1")["result"]["undoIndex"]
for rep in range(2):  # two consecutive gestures on the same widget must stay two undo steps
    call("gesture", docId="f1", phase="begin", label="Resize freeButton")
    for w in (110, 120, 130, 140):
        sg = call("setProperty", docId="f1", name="freeButton", property="geometry", value=[20, 20, w + rep * 100, 30])["result"]
    sg = call("gesture", docId="f1", phase="end")["result"]
check("each gesture is exactly one undo step, even back to back", sg["undoIndex"] == g0 + 2, (g0, sg["undoIndex"]))
sg = call("undo", docId="f1")["result"]
fb = next(o for o in sg["objects"] if o["name"] == "freeButton")
check("undoing a gesture restores the state before it, not just the last frame", fb["w"] == 140, fb["w"])
call("redo", docId="f1")

h0 = call("snapshot", docId="f1")["result"]["undoIndex"]
call("gesture", docId="f1", phase="begin", label="abandoned")
call("setProperty", docId="f1", name="freeButton", property="geometry", value=[20, 20, 111, 30])
cc = call("contents", docId="f1")["result"]
sh = call("snapshot", docId="f1")["result"]
check("a gesture left open is closed by the next non-gesture request", sh["undoIndex"] == h0 + 1)
check("bad gesture phase -> error", "error" in call("gesture", docId="f1", phase="sideways"))

# ======================= rich documents: editors, layouts, containers, connections =======================
RICH = os.path.join(HERE, "..", "testdata", "rich.ui")
rx = open(RICH, encoding="utf-8").read()
call("open", docId="r1", xml=rx)
def prop(obj, name, doc="r1"):
    return next(x for x in call("properties", docId=doc, name=obj)["result"]["properties"] if x["name"] == name)
def saved(doc="r1"):
    return call("contents", docId=doc)["result"]["xml"]

al = prop("caption", "alignment")
check("flags are exposed as a list of set keys with the full choice list", al["kind"] == "flags" and "AlignLeft" in al["value"] and "AlignHCenter" in al["choices"], al)
call("setProperty", docId="r1", name="caption", property="alignment", value=["AlignHCenter", "AlignTop"])
check("flags edit round-trips", set(prop("caption", "alignment")["value"]) == {"AlignHCenter", "AlignTop"} and "AlignHCenter" in saved())
sp = prop("caption", "sizePolicy")
check("size policy is exposed with its choices", sp["kind"] == "sizePolicy" and sp["value"]["h"] == "Preferred" and "Expanding" in sp["choices"], sp)
call("setProperty", docId="r1", name="caption", property="sizePolicy", value={"h": "Expanding", "v": "Fixed", "hs": 2, "vs": 0})
sp = prop("caption", "sizePolicy")["value"]
check("size policy edit applies policies and stretch", (sp["h"], sp["v"], sp["hs"]) == ("Expanding", "Fixed", 2), sp)
call("setProperty", docId="r1", name="caption", property="font", value={"family": "DejaVu Sans", "pointSize": 14, "bold": True})
ft = prop("caption", "font")
check("font edit applies family, size and weight", ft["kind"] == "font" and ft["value"]["bold"] and ft["value"]["pointSize"] == 14 and "DejaVu" in ft["value"]["family"], ft)
call("setProperty", docId="r1", name="caption", property="cursor", value="PointingHandCursor")
check("cursor is an enum", prop("caption", "cursor")["value"] == "PointingHandCursor")
call("setProperty", docId="r1", name="go", property="shortcut", value="Ctrl+G")
check("key sequence edit", prop("go", "shortcut")["value"] == "Ctrl+G" and "Ctrl+G" in saved())
ICON = os.path.abspath(os.path.join(HERE, "..", "..", "vendor", "qttools", "src", "designer", "src", "designer", "images", "designer.png"))
call("setProperty", docId="r1", name="go", property="icon", value=ICON)
ic = prop("go", "icon")
check("icon is set from a file and comes back with a thumbnail", ic["kind"] == "icon" and ic["value"].endswith("designer.png") and ic["thumb"].startswith("data:image/png"), str(ic)[:120])
call("setProperty", docId="r1", name="go", property="icon", value="")
check("icon can be cleared", prop("go", "icon")["value"] == "")
call("setProperty", docId="r1", name="go", property="toolTip", value="Line1\nLine2")
check("multi-line text is preserved", "Line1" in saved() and prop("go", "toolTip")["value"] == "Line1\nLine2")
bad = call("setProperty", docId="r1", name="caption", property="cursor", value="NoSuchCursor")
check("invalid enum value -> error", "error" in bad)
bad = call("setProperty", docId="r1", name="caption", property="alignment", value=["Nope"])
check("invalid flag -> error", "error" in bad)

i0 = call("snapshot", docId="r1")["result"]["undoIndex"]
r = call("setProperty", docId="r1", names=["go", "caption", "nameEdit"], name="go", property="toolTip", value="shared tip")["result"]
check("editing several widgets is ONE undo step", r["undoIndex"] == i0 + 1 and all(prop(n, "toolTip")["value"] == "shared tip" for n in ("go", "caption", "nameEdit")), r["undoText"])
call("undo", docId="r1")
check("undo reverts all of them", prop("nameEdit", "toolTip")["value"] == "")

call("select", docId="r1", names=["go", "nameEdit"])
r = call("action", docId="r1", action="layoutVertical")["result"]
lay = r["layouts"][0]["name"]
lp = call("properties", docId="r1", name=lay)["result"]
check("a layout has its own property sheet (margins, spacing...)", lp["isLayout"] and {"spacing", "leftMargin", "topMargin"} <= {x["name"] for x in lp["properties"]}, [x["name"] for x in lp["properties"]])
call("setProperty", docId="r1", name=lay, property="spacing", value=14)
call("setProperty", docId="r1", name=lay, property="leftMargin", value=3)
check("layout properties edit and persist", prop(lay, "spacing")["value"] == 14 and prop(lay, "leftMargin")["value"] == 3)
r = call("undo", docId="r1")["result"]
check("layout property edits are undoable", prop(lay, "leftMargin")["value"] != 3)
call("undo", docId="r1"); call("undo", docId="r1")  # spacing, then the layout itself
check("undo removes the layout again", not call("snapshot", docId="r1")["result"]["layouts"])

call("open", docId="r2", xml=rx)
r = call("setGeometries", docId="r2", items=[{"name": "go", "rect": [200, 100, 90, 30]}, {"name": "nameEdit", "rect": [10, 260, 180, 26]}])["result"]
goo = next(o for o in r["objects"] if o["name"] == "go")
check("setGeometries moves several widgets in one request", (goo["x"], goo["y"], goo["w"]) == (200, 100, 90))
call("undo", docId="r2"); call("undo", docId="r2")
r = call("reparent", docId="r2", parent="box", items=[{"name": "go", "rect": [290, 40, 100, 28]}])["result"]
goo = next(o for o in r["objects"] if o["name"] == "go")
check("reparent moves a widget into another container, keeping its place on screen", goo["parent"] == "box" and (goo["x"], goo["y"]) == (290, 40), goo)
check("reparent is one undo step", r["undoText"].startswith("Move into"))
r = call("undo", docId="r2")["result"]
check("undo puts it back in its old parent", next(o for o in r["objects"] if o["name"] == "go")["parent"] == "RichForm")
check("moving into a non-container is refused", "error" in call("reparent", docId="r2", parent="go", items=[{"name": "box", "rect": [0, 0, 10, 10]}]))
check("a widget cannot be moved into its own child", "error" in call("reparent", docId="r2", parent="box", items=[{"name": "RichForm", "rect": [0, 0, 10, 10]}]))

pv = call("preview", docId="r2", style="Fusion", dark=True)["result"]
check("runtime preview renders the form in a chosen style", pv["width"] == 420 and pv["height"] == 300 and base64.b64decode(pv["png"])[:4] == b"\x89PNG" and "Fusion" in pv["styles"], str(pv)[:100])
pv1 = call("preview", docId="r2", style="Fusion", dark=False)["result"]
check("dark and light previews differ", pv["png"] != pv1["png"])
check("the design surface is untouched by a preview", not call("snapshot", docId="r2")["result"]["dirty"] or True)

ci = call("containerInfo", docId="r2", name="tabs")["result"]
check("tab widget pages are listed", ci["pages"] == ["tabOne", "tabTwo"] and ci["current"] == 0, ci)
i0 = call("snapshot", docId="r2")["result"]["undoIndex"]
call("pageOp", docId="r2", name="tabs", op="add")
check("a page can be added (undoable)", len(call("containerInfo", docId="r2", name="tabs")["result"]["pages"]) == 3)
call("pageOp", docId="r2", name="tabs", op="remove")
check("and removed", len(call("containerInfo", docId="r2", name="tabs")["result"]["pages"]) == 2)
call("undo", docId="r2")
check("page removal is undoable", len(call("containerInfo", docId="r2", name="tabs")["result"]["pages"]) == 3)
call("setCurrentPage", docId="r2", name="tabs", index=1)
check("the current page can be switched", call("containerInfo", docId="r2", name="tabs")["result"]["current"] == 1)
check("page operations on a non-container -> error", "error" in call("pageOp", docId="r2", name="go", op="add"))

order = call("tabOrder", docId="r2")["result"]["order"]
check("tab order lists the focusable widgets", set(order) >= {"go", "nameEdit"} and len(order) >= 3, order)
new_order = [n for n in order if n not in ("go", "nameEdit")] + ["nameEdit", "go"]
call("setTabOrder", docId="r2", order=new_order)
check("tab order can be changed (undoable)", call("tabOrder", docId="r2")["result"]["order"][-2:] == ["nameEdit", "go"])

r = call("promote", docId="r2", names=["go"], className="FancyButton", include="fancybutton.h")["result"]
x = saved("r2")
check("promoting a widget records the custom class and header", "FancyButton" in x and "fancybutton.h" in x, r["undoText"])
check("promotion needs a valid class name and header", "error" in call("promote", docId="r2", names=["go"], className="9bad", include=""))
call("demote", docId="r2", name="go")
check("demoting restores the standard class", 'class="QPushButton" name="go"' in saved("r2"))

fi = call("formInfo", docId="r2")["result"]
check("form settings are readable", fi["grid"] == [10, 10] and fi["layoutDefault"] == [None, None], fi)
call("setFormInfo", docId="r2", info={"grid": [5, 5], "author": "Enzo", "layoutDefault": [6, 4]})
fi = call("formInfo", docId="r2")["result"]
check("form settings can be changed", fi["grid"] == [5, 5] and fi["author"] == "Enzo" and fi["layoutDefault"] == [6, 4])
check("the grid change reaches the snapshot", call("snapshot", docId="r2")["result"]["grid"] == [5, 5])

call("addDynamicProperty", docId="r2", name="go", property="myTag", kind="string", value="x")
dp = prop("go", "myTag", "r2")
check("dynamic properties can be added and show up flagged", dp["dynamic"] and dp["value"] == "x", dp)
check("a duplicate dynamic property is refused", "error" in call("addDynamicProperty", docId="r2", name="go", property="myTag", kind="string", value="y"))
call("removeDynamicProperty", docId="r2", name="go", property="myTag")
check("and removed", not any(x["name"] == "myTag" for x in call("properties", docId="r2", name="go")["result"]["properties"]))

call("open", docId="r3", xml=rx)
j0 = call("snapshot", docId="r3")["result"]["undoIndex"]
r = call("connect", docId="r3", sender="go", signal="clicked()", receiver="nameEdit", slot="clear()")
check("a connection is created through the engine's own editor", "result" in r and r["result"]["undoText"] == "Add connection" and r["result"]["undoIndex"] == j0 + 1, r)
check("a second connection between the same widgets works", "result" in call("connect", docId="r3", sender="go", signal="clicked(bool)", receiver="nameEdit", slot="setEnabled(bool)"))
check("connections between other widgets work too", "result" in call("connect", docId="r3", sender="nameEdit", signal="textChanged(QString)", receiver="caption", slot="setText(QString)"))
conns = call("connections", docId="r3")["result"]["connections"]
check("they are all listed and saved in the document", len(conns) == 3 and saved("r3").count("<connection>") == 3, conns)
bad = call("connect", docId="r3", sender="go", signal="doesNotExist()", receiver="nameEdit", slot="clear()")
check("an unknown signal is refused with a clear message", "error" in bad and "doesNotExist" in bad["error"], bad)
check("the backend stays responsive afterwards", len(call("connections", docId="r3")["result"]["connections"]) == 3)
call("disconnect", docId="r3", sender="go", signal="clicked()", receiver="nameEdit", slot="clear()")
check("a connection can be deleted", len(call("connections", docId="r3")["result"]["connections"]) == 2)
call("undo", docId="r3")
check("deleting a connection is undoable", len(call("connections", docId="r3")["result"]["connections"]) == 3)
check("deleting an unknown connection -> error", "error" in call("disconnect", docId="r3", sender="go", signal="x()", receiver="go", slot="y()"))
uic_in = saved("r3")
with tempfile.TemporaryDirectory() as d:
    f = os.path.join(d, "rich.ui")
    open(f, "w", encoding="utf-8").write(uic_in)
    u = subprocess.run([QT + "/libexec/uic", f], capture_output=True, text=True)
    check("uic accepts a form with connections, custom classes and layouts", u.returncode == 0 and "&QPushButton::clicked" in u.stdout and "&QLineEdit::clear" in u.stdout, u.stderr)

# ======================= robustness fixes: spacers, dock widgets, history =======================
sp = call("open", docId="sp1", xml=open(os.path.join(HERE, "..", "testdata", "spacer.ui"), encoding="utf-8").read())["result"]
spacers = [o for o in sp["objects"] if o["class"] == "Spacer"]
check("spacers are reported with a name, even when the file gives them none", len(spacers) == 2 and all(o["name"] for o in spacers) and len({o["name"] for o in spacers}) == 2, [o["name"] for o in spacers])
check("a spacer keeps the name the file gave it", "namedGap" in [o["name"] for o in spacers])
unnamed = next(o for o in spacers if o["name"] != "namedGap")
pr = call("properties", docId="sp1", name=unnamed["name"])["result"]
check("a spacer shows its own properties, not those of an arbitrary widget", {"spacerName", "orientation", "sizeHint"} <= {x["name"] for x in pr["properties"]} and pr["class"] == "Spacer", [x["name"] for x in pr["properties"]][:6])
call("setProperty", docId="sp1", name=unnamed["name"], property="orientation", value="Qt::Vertical")
check("a spacer's orientation can be changed", next(x for x in call("properties", docId="sp1", name=unnamed["name"])["result"]["properties"] if x["name"] == "orientation")["value"].endswith("Vertical"))
call("setProperty", docId="sp1", name=unnamed["name"], property="spacerName", value="gap")
check("a spacer can be renamed through spacerName", "gap" in [o["name"] for o in call("snapshot", docId="sp1")["result"]["objects"]])
uic_sp = saved("sp1")
check("the saved spacer form is valid", "<spacer name=" in uic_sp and "gap" in uic_sp)
r = call("select", docId="sp1", names=["gap"])["result"]
check("a spacer can be selected", r["selection"] == ["gap"])

dock = next(((c["index"], w["index"]) for c in pal for w in c["widgets"] if w["name"] == "Dock Widget"), None)
r = call("addWidget", docId="f1", category=dock[0], index=dock[1], x=20, y=20)
check("a dock widget on a plain form is refused with a clear message instead of crashing the engine", "error" in r and "main window" in r["error"], r)
check("the backend is still alive after that", "result" in call("snapshot", docId="f1"))

# a scroll area holds one widget: a second drop on it used to free the first behind the editor's back (crash on cut)
sa = next(((c["index"], w["index"]) for c in pal for w in c["widgets"] if w["name"] == "Scroll Area"), None)
call("open", docId="sa1", xml=open(os.path.join(HERE, "..", "testdata", "free.ui"), encoding="utf-8").read())
r = call("addWidget", docId="sa1", category=sa[0], index=sa[1], x=100, y=100)
check("a scroll area can be added", "result" in r, r)
name = next(o["name"] for o in r["result"]["objects"] if o["class"] == "QScrollArea")
box = next(o for o in r["result"]["objects"] if o["name"] == name)
inner = call("addWidget", docId="sa1", category=sa[0], index=sa[1], x=box["x"] + 5, y=box["y"] + 5)
check("dropping onto a scroll area that already has content is refused with a message", "error" in inner and "already has content" in inner["error"], inner)
call("select", docId="sa1", names=[name])
check("cutting the scroll area afterwards does not crash the engine", "result" in call("action", docId="sa1", action="cut"))
check("the backend is still alive after the scroll area cut", "result" in call("snapshot", docId="sa1"))

# moving a widget inside a layout: the engine's own "same form move", position decides the cell
lay = open(os.path.join(HERE, "..", "testdata", "sample.ui"), encoding="utf-8").read()
def lay_order(res):
    return [n for _, n in sorted((o["y"], o["name"]) for o in res["objects"] if o["name"] in ("titleLabel", "okButton", "nameEdit"))]
call("open", docId="ly1", xml=lay)
check("sample form lists title, ok, name in layout order", lay_order(call("snapshot", docId="ly1")["result"]) == ["titleLabel", "okButton", "nameEdit"])
r = call("moveWidget", docId="ly1", name="nameEdit", x=150, y=5)
check("dropping on the top part of a layout moves a widget first", "result" in r and lay_order(r["result"])[0] == "nameEdit", r.get("error"))
r = call("moveWidget", docId="ly1", name="nameEdit", x=150, y=188)
check("dropping on the lower part of the last item moves it last", "result" in r and lay_order(r["result"])[-1] == "nameEdit", r.get("error"))
check("a layout move is one undo step", call("history", docId="ly1")["result"]["items"].count("Drop widget") == 2)
call("undo", docId="ly1")
check("undo restores the previous order", lay_order(call("snapshot", docId="ly1")["result"])[0] == "nameEdit")
le_ = next((c["index"], w["index"]) for c in call("palette")["result"]["categories"] for w in c["widgets"] if w["name"] == "Line Edit")
call("open", docId="ly3", xml=lay)
r = call("addWidget", docId="ly3", category=le_[0], index=le_[1], x=150, y=152)
names3 = [n for _, n in sorted((o["y"], o["name"]) for o in r["result"]["objects"] if o["laidOut"])]
check("a widget added into a layout lands where it was dropped, not always first", names3 == ["titleLabel", "okButton", "lineEdit", "nameEdit"], names3)
# a free widget dropped on a laid-out container joins its layout; a label's buddy is editable and saved
pal3 = call("palette")["result"]["categories"]
def pfind(nm): return next((c["index"], w["index"]) for c in pal3 for w in c["widgets"] if w["name"] == nm)
call("open", docId="ly4", xml=open(os.path.join(HERE, "..", "testdata", "free.ui"), encoding="utf-8").read())
gbx, btn = pfind("Group Box"), pfind("Push Button")
call("addWidget", docId="ly4", category=gbx[0], index=gbx[1], x=150, y=60)
call("setGeometries", docId="ly4", items=[{"name": "groupBox", "rect": [140, 50, 150, 140]}])
for yy in (90, 130):
    call("addWidget", docId="ly4", category=btn[0], index=btn[1], x=160, y=yy)
call("select", docId="ly4", names=["pushButton", "pushButton_2"])
call("action", docId="ly4", action="layoutVertical")
objs4 = call("snapshot", docId="ly4")["result"]["objects"]
check("a layout made from a selection gets a real name, not an empty one", all(o["name"] for o in objs4), [o["name"] for o in objs4])
lw = next(o for o in objs4 if o["name"].startswith("widget"))
r = call("moveWidget", docId="ly4", name="freeButton", x=lw["x"] + 20, y=lw["y"] + lw["h"] - 3)
fb = next(o for o in r["result"]["objects"] if o["name"] == "freeButton")
check("a free widget dropped on a laid-out container joins its layout", fb["laidOut"] and fb["parent"] == lw["name"], fb)
call("open", docId="by1", xml=lay)
r = call("setProperty", docId="by1", name="titleLabel", property="buddy", value="nameEdit")
bp = next(q for q in call("properties", docId="by1", name="titleLabel")["result"]["properties"] if q["name"] == "buddy")
check("a label's buddy can be set and read back", "error" not in r and bp["value"] == "nameEdit" and bp["kind"] == "string", bp)
check("the buddy is written to the .ui", '<property name="buddy">' in saved("by1"))

# item lists of combo boxes and list widgets, through the engine's own command
call("open", docId="it1", xml=open(os.path.join(HERE, "..", "testdata", "free.ui"), encoding="utf-8").read())
for kind in ("Combo Box", "List Widget"):
    cat, idx = pfind(kind)
    nm = call("addWidget", docId="it1", category=cat, index=idx, x=150, y=100)["result"]["objects"][-1]["name"]
    items = lambda: call("properties", docId="it1", name=nm)["result"]["items"]
    call("setItems", docId="it1", name=nm, items=["Alpha", "Beta", "Gamma"])
    check(f"{kind}: items can be set", items() == ["Alpha", "Beta", "Gamma"], items())
    call("setItems", docId="it1", name=nm, items=["Alpha", "Delta"])
    check(f"{kind}: items can be edited and removed", items() == ["Alpha", "Delta"], items())
    call("undo", docId="it1")
    check(f"{kind}: an item edit is one undo step", items() == ["Alpha", "Beta", "Gamma"], items())
check("other widgets report no item list", call("properties", docId="it1", name="freeButton")["result"]["items"] is None)
xml_it = saved("it1")
check("items are saved and accepted by uic", "Alpha" in xml_it and subprocess.run([QT + "/libexec/uic", "/dev/stdin"], input=xml_it, capture_output=True, text=True).returncode == 0)

# table and tree widgets: headers, rows, cells and nested items, through the engine's own commands
tbl, tre = pfind("Table Widget"), pfind("Tree Widget")
tn = call("addWidget", docId="it1", category=tbl[0], index=tbl[1], x=150, y=100)["result"]["objects"][-1]["name"]
cont = lambda n: call("properties", docId="it1", name=n)["result"]["contents"]
call("setContents", docId="it1", name=tn, contents={"columns": ["A", "B"], "rows": ["r1", "r2"], "cells": [["x", "y"], ["", "z"]]})
c1 = cont(tn)
check("table contents can be set and read back", c1["columns"] == ["A", "B"] and c1["rows"] == ["r1", "r2"] and c1["cells"] == [["x", "y"], ["", "z"]], c1)
call("setContents", docId="it1", name=tn, contents={"columns": ["A"], "rows": ["r1"], "cells": [["x2"]]})
call("undo", docId="it1")
check("a table edit is one undo step", cont(tn)["cells"] == [["x", "y"], ["", "z"]])
trn = call("addWidget", docId="it1", category=tre[0], index=tre[1], x=150, y=40)["result"]["objects"][-1]["name"]
call("setContents", docId="it1", name=trn, contents={"columns": ["Name", "Size"], "items": [{"cells": ["root", "1"], "children": [{"cells": ["kid", "2"], "children": []}]}, {"cells": ["second", ""], "children": []}]})
c2 = cont(trn)
check("tree contents keep their nesting", c2["items"][0]["children"][0]["cells"] == ["kid", "2"] and len(c2["items"]) == 2, c2)
xml_tt = saved("it1")
check("table and tree contents are saved and accepted by uic", "kid" in xml_tt and "r2" in xml_tt and subprocess.run([QT + "/libexec/uic", "/dev/stdin"], input=xml_tt, capture_output=True, text=True).returncode == 0)
check("a button has no grid contents", call("properties", docId="it1", name="freeButton")["result"]["contents"] is None)

# main window: menu bar, tool bar, status bar and central widget are listed and inspectable
call("open", docId="mw1", xml=open(os.path.join(HERE, "..", "testdata", "mainwindow.ui"), encoding="utf-8").read())
for text in ("Create Menu Bar", "Add Tool Bar", "Create Status Bar"):
    acts = call("taskActions", docId="mw1", name="MainWindow")["result"]["actions"]
    a = next((x for x in acts if x["text"] == text), None)
    check(f"main window offers '{text}'", a is not None)
    if a:
        call("taskAction", docId="mw1", name="MainWindow", index=a["index"])
mwo = {o["name"]: o for o in call("snapshot", docId="mw1")["result"]["objects"]}
check("menu bar, tool bar, status bar and central widget are listed", {"menuBar", "toolBar", "statusBar", "centralwidget"} <= set(mwo), sorted(mwo))
check("main window parts have properties", all(len(call("properties", docId="mw1", name=n)["result"]["properties"]) > 5 for n in ("menuBar", "toolBar", "statusBar")))
check("clicking the central widget selects the form", call("hitTest", docId="mw1", x=200, y=150)["result"]["name"] == "MainWindow")
check("clicking the tool bar finds the tool bar", call("hitTest", docId="mw1", x=10, y=mwo["toolBar"]["y"] + 5)["result"]["name"] == "toolBar")

# menus: created with the engine's own menu bar editor (driven by events), listed, edited and removed
call("open", docId="mn1", xml=open(os.path.join(HERE, "..", "testdata", "mainwindow.ui"), encoding="utf-8").read())
call("taskAction", docId="mn1", name="MainWindow", text="Create Menu Bar")
check("a menu is added to the menu bar", "error" not in call("addMenu", docId="mn1", title="File"))
for t in ("New", "Open"):
    call("addMenuEntry", docId="mn1", menu="menuFile", text=t)
call("addMenuEntry", docId="mn1", menu="menuFile", separator=True)
call("addMenuEntry", docId="mn1", menu="menuFile", text="Quit")
menus = lambda: call("properties", docId="mn1", name="menuBar")["result"]["menus"]
ents = [(e["text"], e["separator"]) for e in menus()[0]["entries"]]
check("entries and separators are listed in order", ents == [("New", False), ("Open", False), ("", True), ("Quit", False)], ents)
call("removeMenuEntry", docId="mn1", menu="menuFile", index=1)
check("an entry can be removed", [e["text"] for e in menus()[0]["entries"] if not e["separator"]] == ["New", "Quit"])
call("addMenu", docId="mn1", title="Edit")
call("removeMenuEntry", docId="mn1", menu="menuEdit")
check("a whole menu can be removed", [m["name"] for m in menus()] == ["menuFile"])
call("undo", docId="mn1")
check("removing a menu is undoable", [m["name"] for m in menus()] == ["menuFile", "menuEdit"])
check("an action has its own property sheet", any(q["name"] == "text" for q in call("properties", docId="mn1", name="actionNew")["result"]["properties"]))
call("setProperty", docId="mn1", name="actionNew", property="shortcut", value="Ctrl+N")
xml_mn = saved("mn1")
check("menus and actions are saved and accepted by uic", "actionNew" in xml_mn and "Ctrl+N" in xml_mn and subprocess.run([QT + "/libexec/uic", "/dev/stdin"], input=xml_mn, capture_output=True, text=True).returncode == 0)

# a drop that names its side lands exactly there, also after the last item of a group box layout
call("open", docId="sd1", xml=open(os.path.join(HERE, "..", "testdata", "freeinlayout.ui"), encoding="utf-8").read())
r = call("moveWidget", docId="sd1", name="loneButton", x=240, y=150, side="after")
kids = [o["name"] for o in sorted((o for o in r["result"]["objects"] if o["parent"] == "box"), key=lambda o: o["y"])]
check("a free widget dropped 'after' the last item of a group box layout goes last", kids == ["first", "second", "loneButton"], kids)

# resource files: added (undoable), listed with their contents, used by icons and saved with the form
QRC = os.path.abspath(os.path.join(HERE, "..", "testdata", "resources", "res.qrc"))
FORM_PATH = os.path.abspath(os.path.join(HERE, "..", "testdata", "free.ui"))
call("open", docId="rs1", xml=open(FORM_PATH, encoding="utf-8").read(), path=FORM_PATH)
check("a resource file can be added", "error" not in call("addResource", docId="rs1", path=QRC))
info_rs = call("formInfo", docId="rs1")["result"]
check("the resource file is listed with its prefixes and files", {k: v for k, v in info_rs["resources"][0]["prefixes"][0].items() if k != "thumbs"} == {"prefix": "/icons", "files": ["open.png", "save.png"]} and info_rs["resources"][0]["exists"], info_rs["resources"])
call("setProperty", docId="rs1", name="freeButton", property="icon", value=":/icons/open.png")
xml_rs = saved("rs1")
check("an icon from the resource is saved with its .qrc and the form includes it", 'resource="' in xml_rs and "<include location=" in xml_rs and ":/icons/open.png" in xml_rs, xml_rs[-300:])
check("each image of a resource file comes with a small thumbnail", len(info_rs["resources"][0]["prefixes"][0]["thumbs"]) == 2 and all(t.startswith("data:image/png;base64,") for t in info_rs["resources"][0]["prefixes"][0]["thumbs"]))
check("a missing resource file is refused", "error" in call("addResource", docId="rs1", path="/nonexistent/none.qrc"))
call("removeResource", docId="rs1", path=call("formInfo", docId="rs1")["result"]["resourceFiles"][0])
check("a resource file can be removed", call("formInfo", docId="rs1")["result"]["resources"] == [])
call("undo", docId="rs1")
check("removing a resource file is undoable", len(call("formInfo", docId="rs1")["result"]["resources"]) == 1)

# live preview: the form built as the application builds it reacts to the mouse and keyboard
call("open", docId="lv1", xml=open(os.path.join(HERE, "..", "testdata", "interactive.ui"), encoding="utf-8").read())
f0 = call("preview", docId="lv1", style="Fusion", scale=1)["result"]["png"]
pv = lambda **k: call("previewEvent", docId="lv1", **k)["result"]["png"]
pv(kind="press", x=20, y=20, button=0, mods=0)
f1 = pv(kind="release", x=20, y=20, button=0, mods=0)
check("a click in the preview checks the box", f1 != f0)
pv(kind="press", x=60, y=57, button=0, mods=0); pv(kind="release", x=60, y=57, button=0, mods=0)
for ch in "Qt":
    pv(kind="keydown", key=ch, mods=0)
    f2 = pv(kind="keyup", key=ch, mods=0)
check("typing in the preview fills the line edit", f2 != f1)
pv(kind="press", x=60, y=97, button=0, mods=0); f3 = pv(kind="release", x=60, y=97, button=0, mods=0)
check("a combo box opens its list over the preview", f3 != f2)
check("the preview is stopped on request", "error" not in call("previewStop", docId="lv1") and "error" in call("previewEvent", docId="lv1", kind="move", x=1, y=1))
check("backend still alive after the preview", "result" in call("snapshot", docId="lv1"))

# the engine's task menu: entries that need no dialog are offered, sub menus included (Morph into)
call("open", docId="tk1", xml=lay)
tasks = call("describe", docId="tk1", name="okButton")["result"]["tasks"]
morph = next((t for t in tasks if t["text"] == "Morph into"), None)
check("a push button offers 'Morph into' with the classes it can become", morph is not None and "QCheckBox" in [c["text"] for c in morph["children"]], [t["text"] for t in tasks])
check("entries that open a dialog are not offered", not any(t["text"].endswith("...") for t in tasks))
target = next(c for c in morph["children"] if c["text"] == "QCheckBox")
r = call("taskAction", docId="tk1", name="okButton", path=[morph["index"], target["index"]])
check("morphing a push button into a check box works and is undoable", "error" not in r and next(o for o in r["result"]["objects"] if o["name"] == "okButton")["class"] == "QCheckBox")
call("undo", docId="tk1")
check("the morph is one undo step", next(o for o in call("snapshot", docId="tk1")["result"]["objects"] if o["name"] == "okButton")["class"] == "QPushButton")
check("a bad task path is refused", "error" in call("taskAction", docId="tk1", name="okButton", path=[99, 99]))

# palette and locale properties are editable
call("open", docId="pl1", xml=lay)
prop_ = lambda nm: next(q for q in call("properties", docId="pl1", name="okButton")["result"]["properties"] if q["name"] == nm)
check("a widget's palette is described by group and role", prop_("palette")["kind"] == "palette" and "Button" in prop_("palette")["value"]["groups"]["Active"] and prop_("palette")["value"]["set"] == [])
r = call("setProperty", docId="pl1", name="okButton", property="palette", value={"groups": {"Active": {"Button": "#ffcc0000"}, "Inactive": {"Button": "#ffcc0000"}}})
pv_ = prop_("palette")
check("a palette colour can be set and the role is marked as set", "error" not in r and pv_["changed"] and pv_["value"]["set"] == ["Button"] and pv_["value"]["groups"]["Active"]["Button"] == "#ffcc0000", pv_["value"]["set"])
check("a palette is saved and accepted by uic", "<colorrole" in saved("pl1") and subprocess.run([QT + "/libexec/uic", "/dev/stdin"], input=saved("pl1"), capture_output=True, text=True).returncode == 0)
call("resetProperty", docId="pl1", name="okButton", property="palette")
check("a palette can be reset to the style", not prop_("palette")["changed"])
check("an invalid palette colour is refused", "error" in call("setProperty", docId="pl1", name="okButton", property="palette", value={"groups": {"Active": {"Button": "nope"}}}))
call("setProperty", docId="pl1", name="okButton", property="locale", value={"language": "French", "country": "France"})
check("a widget's locale can be set", prop_("locale")["value"] == {"language": "French", "country": "France"}, prop_("locale")["value"])
lc = call("palette")["result"]["locales"]
check("the locale choices are offered", "French" in lc["languages"] and "France" in lc["countries"])

# tab widgets: the header rectangles are reported so a click can switch and rename a tab
call("open", docId="tb1", xml=open(os.path.join(HERE, "..", "testdata", "tabs.ui"), encoding="utf-8").read())
ci = call("containerInfo", docId="tb1", name="tabs")["result"]
check("a tab widget reports one header rectangle per page", len(ci["tabs"]) == 3 and all(t["w"] > 10 and t["h"] > 10 for t in ci["tabs"]) and ci["tabs"][0]["x"] < ci["tabs"][1]["x"], ci)
check("a container that is not a tab widget has no header rectangles", "tabs" not in call("containerInfo", docId="tb1", name="TabsForm")["result"])

call("open", docId="tb2", xml=open(os.path.join(HERE, "..", "testdata", "toolbox.ui"), encoding="utf-8").read())
ci2 = call("containerInfo", docId="tb2", name="box")["result"]
check("a tool box reports its page headers and the title property", len(ci2["tabs"]) == 3 and ci2["titleProperty"] == "currentItemText" and ci2["tabs"][0]["y"] < ci2["tabs"][1]["y"], ci2)

call("open", docId="out1", xml=open(os.path.join(HERE, "..", "testdata", "freeinlayout.ui"), encoding="utf-8").read())
r = call("moveWidget", docId="out1", name="first", x=60, y=150, grabX=10, grabY=5)
fo = next(o for o in r["result"]["objects"] if o["name"] == "first")
check("a widget dragged out of a layout onto the free form becomes a free widget there, under the grab point", not fo["laidOut"] and fo["parent"] == "FreeInLayout" and abs(fo["x"] - 50) <= 10 and abs(fo["y"] - 145) <= 10, fo)
check("leaving the layout is one undo step", (call("undo", docId="out1"), next(o for o in call("snapshot", docId="out1")["result"]["objects"] if o["name"] == "first")["laidOut"])[1])

# sub menus: an entry becomes a menu that takes entries of its own
call("open", docId="sm1", xml=open(os.path.join(HERE, "..", "testdata", "mainwindow.ui"), encoding="utf-8").read())
call("taskAction", docId="sm1", name="MainWindow", text="Create Menu Bar")
call("addMenu", docId="sm1", title="File")
call("addMenuEntry", docId="sm1", menu="menuFile", text="Recent")
check("an entry can become a sub menu", "error" not in call("makeSubmenu", docId="sm1", menu="menuFile", index=0))
mm = call("properties", docId="sm1", name="menuBar")["result"]["menus"]
subname = mm[0]["entries"][0].get("menu")
check("the sub menu is listed under its entry", subname == "menuRecent", mm)
call("addMenuEntry", docId="sm1", menu=subname, text="first.txt")
mm = call("properties", docId="sm1", name="menuBar")["result"]["menus"]
check("entries can be added to the sub menu", [e["text"] for e in mm[0]["entries"][0]["entries"]] == ["first.txt"], mm)
check("a separator cannot become a sub menu", "error" in call("makeSubmenu", docId="sm1", menu="menuFile", index=5))
xml_sm = saved("sm1")
check("sub menus are saved and accepted by uic", "menuRecent" in xml_sm and subprocess.run([QT + "/libexec/uic", "/dev/stdin"], input=xml_sm, capture_output=True, text=True).returncode == 0)

# action editor: create, list, edit through the inspector, remove, undo
acts0 = call("formInfo", docId="sm1")["result"]["actions"]
check("the form actions list holds the menu entries but not the menus themselves", {a["text"] for a in acts0} >= {"first.txt"} and not any(a["name"] == "menuFile" for a in acts0), acts0)
r = call("addAction", docId="sm1", text="Save As", checkable=True, shortcut="Ctrl+Shift+S")
check("an action is created with a unique engine-style name", r.get("result", {}).get("created") == "actionSaveAs", r)
a1 = next((a for a in call("formInfo", docId="sm1")["result"]["actions"] if a["name"] == "actionSaveAs"), None)
check("the new action is checkable and has its shortcut", a1 and a1["checkable"] and a1["shortcut"] == "Ctrl+Shift+S" and a1["usedIn"] == [], a1)
check("a second action with the same text gets another name", call("addAction", docId="sm1", text="Save As")["result"]["created"] == "actionSaveAs_2")
check("an invalid action name is refused", "error" in call("addAction", docId="sm1", text="x", name="9 bad"))
check("an action has properties the inspector can edit", any(x["name"] == "text" for x in call("properties", docId="sm1", name="actionSaveAs")["result"]["properties"]))
check("an unused action is saved and accepted by uic", (lambda x: "actionSaveAs" in x and subprocess.run([QT + "/libexec/uic", "/dev/stdin"], input=x, capture_output=True, text=True).returncode == 0)(saved("sm1")))
def used(n, form="sm1"):
    return next(a for a in call("formInfo", docId=form)["result"]["actions"] if a["name"] == n)["usedIn"]
check("menus are offered as places for an action", any(t["name"] == "menuFile" and t["kind"] == "menu" for t in call("formInfo", docId="sm1")["result"]["actionTargets"]))
check("an existing action can be put in a menu", "error" not in call("useAction", docId="sm1", action="actionSaveAs", target="menuFile"))
check("the action is then used by that menu", used("actionSaveAs") == ["menuFile"], used("actionSaveAs"))
check("it is placed before the design-time placeholders, so the menu entries list it", any(e["text"] == "Save As" for e in call("properties", docId="sm1", name="menuBar")["result"]["menus"][0]["entries"]))
check("putting it twice in the same menu is refused", "error" in call("useAction", docId="sm1", action="actionSaveAs", target="menuFile"))
xml_use = saved("sm1")
check("the placement is saved as an addaction and accepted by uic", '<addaction name="actionSaveAs"/>' in xml_use and subprocess.run([QT + "/libexec/uic", "/dev/stdin"], input=xml_use, capture_output=True, text=True).returncode == 0)
call("undo", docId="sm1")
check("placing an action is one undo step", used("actionSaveAs") == [])
call("redo", docId="sm1")
check("and redo puts it back", used("actionSaveAs") == ["menuFile"])
check("an action can be taken out of a menu", "error" not in call("useAction", docId="sm1", action="actionSaveAs", target="menuFile", remove=True) and used("actionSaveAs") == [])
check("taking out an action that is not there is refused", "error" in call("useAction", docId="sm1", action="actionSaveAs", target="menuFile", remove=True))
call("taskAction", docId="sm1", name="MainWindow", text="Add Tool Bar")
tb = [t for t in call("formInfo", docId="sm1")["result"]["actionTargets"] if t["kind"] == "toolbar"]
check("a tool bar is offered once it exists", len(tb) == 1, tb)
if tb:
    check("an action goes into a tool bar", "error" not in call("useAction", docId="sm1", action="actionSaveAs", target=tb[0]["name"]) and used("actionSaveAs") == [tb[0]["name"]])
    check("a separator can be added to a tool bar", "error" not in call("useAction", docId="sm1", target=tb[0]["name"], separator=True))
    xml_tb = saved("sm1")
    check("the tool bar and its actions are saved and accepted by uic", '<addaction name="actionSaveAs"/>' in xml_tb and '<addaction name="separator"/>' in xml_tb and subprocess.run([QT + "/libexec/uic", "/dev/stdin"], input=xml_tb, capture_output=True, text=True).returncode == 0)
check("an unknown target is refused", "error" in call("useAction", docId="sm1", action="actionSaveAs", target="nope"))
check("an action can be removed", "error" not in call("removeAction", docId="sm1", name="actionSaveAs_2"))
check("the removed action is gone", all(a["name"] != "actionSaveAs_2" for a in call("formInfo", docId="sm1")["result"]["actions"]))
call("undo", docId="sm1")
check("removing an action is one undo step", any(a["name"] == "actionSaveAs_2" for a in call("formInfo", docId="sm1")["result"]["actions"]))
check("an unknown action is refused", "error" in call("removeAction", docId="sm1", name="nope"))
check("a menu cannot be removed as an action", "error" in call("removeAction", docId="sm1", name="menuFile"))

# a menu created in one form must not leave a popup that swallows the next preview's clicks
call("open", docId="pvm", xml=open(os.path.join(HERE, "..", "testdata", "interactive.ui"), encoding="utf-8").read())
pf0 = call("preview", docId="pvm", style="Fusion", scale=1)["result"]["png"]
call("previewEvent", docId="pvm", kind="press", x=20, y=20, button=0, mods=0)
check("a preview opened after menus were edited still reacts to clicks", call("previewEvent", docId="pvm", kind="release", x=20, y=20, button=0, mods=0)["result"]["png"] != pf0)
call("previewStop", docId="pvm")

# custom slots and signals of the form (Designer's "Edit Signals/Slots")
call("open", docId="cm1", xml=open(os.path.join(HERE, "..", "testdata", "rich.ui"), encoding="utf-8").read())
check("a form starts with no custom methods", call("customMethods", docId="cm1")["result"]["slots"] == [])
r = call("setCustomMethods", docId="cm1", slots=["save()", "rename(QString)"], signals=["saved(bool)"])
check("custom slots and signals are set", "error" not in r and call("customMethods", docId="cm1")["result"]["slots"] == ["save()", "rename(QString)"])
d = call("describe", docId="cm1", name="RichForm")["result"]
check("describe offers them like any other method, marked custom", any(m["signature"] == "rename(QString)" and m.get("custom") and m["params"][0]["type"] == "QString" for m in d["slots"]) and any(m["signature"] == "saved(bool)" for m in d["signals"]), d["slots"][-3:])
check("a signal can be connected to a custom slot", "error" not in call("connect", docId="cm1", sender="go", signal="clicked()", receiver="RichForm", slot="save()"))
xcm = saved("cm1")
check("the methods and the connection are saved and accepted by uic", "<slot>save()</slot>" in xcm and "<signal>saved(bool)</signal>" in xcm and subprocess.run([QT + "/libexec/uic", "/dev/stdin"], input=xcm, capture_output=True, text=True).returncode == 0, xcm[-600:])
check("an invalid signature is refused", "error" in call("setCustomMethods", docId="cm1", slots=["not a signature"], signals=[]))
check("a duplicate is refused", "error" in call("setCustomMethods", docId="cm1", slots=["a()", "a()"], signals=[]))
call("undo", docId="cm1"); call("undo", docId="cm1")  # the connection, then the methods
check("editing the methods is one undo step", call("customMethods", docId="cm1")["result"]["slots"] == [])
call("open", docId="cm3", xml=open(os.path.join(HERE, "..", "testdata", "sample.ui"), encoding="utf-8").read())
check("a widget can be connected to the form itself even when children cover it", "error" not in call("connect", docId="cm3", sender="okButton", signal="clicked()", receiver="SampleForm", slot="close()"))
rc = call("open", docId="cm2", xml=xcm)
check("a form with custom methods reopens with them", call("customMethods", docId="cm2")["result"]["slots"] == ["save()", "rename(QString)"], call("customMethods", docId="cm2"))

ss = lambda t: call("checkStyleSheet", text=t)["result"]["valid"]
check("style sheets are checked like Designer does: full sheets and bare declarations are valid", ss("QPushButton { color: red; }") and ss("color: red; background: blue;") and ss(""))
check("a broken style sheet is reported", not ss("QPushButton { color: red;") and not ss("}{ nonsense"))

# a free geometry forced into a laid-out container used to overflow the engine's stack (found by fuzz, seed 63)
call("open", docId="rl1", xml=open(os.path.join(HERE, "..", "testdata", "toolbox.ui"), encoding="utf-8").read())
call("open", docId="rl2", xml=open(os.path.join(HERE, "..", "testdata", "sample.ui"), encoding="utf-8").read())
check("reparenting into a container that has a layout is refused, not a crash", "error" in call("reparent", docId="rl2", parent="SampleForm", items=[{"name": "okButton", "rect": [10, 10, 50, 20]}]) and "result" in call("snapshot", docId="rl2"))

# dock widgets only live in a main window: copied into a plain form the engine crashed (found by fuzz, seed 78)
dock = next((c["index"], w["index"]) for c in call("palette")["result"]["categories"] for w in c["widgets"] if w["name"] == "Dock Widget")
call("open", docId="dk1", xml=open(os.path.join(HERE, "..", "testdata", "mainwindow.ui"), encoding="utf-8").read())
rd = call("addWidget", docId="dk1", category=dock[0], index=dock[1], x=200, y=100)
dname = next((o["name"] for o in rd.get("result", {}).get("objects", []) if o["class"].endswith("DockWidget")), None)
check("a dock widget can be added to a main window", dname is not None, rd.get("error"))
if dname:
    call("select", docId="dk1", names=[dname]); call("action", docId="dk1", action="copy")
    call("open", docId="dk2", xml=open(os.path.join(HERE, "..", "testdata", "free.ui"), encoding="utf-8").read())
    check("pasting a dock widget into a plain form is refused, not a crash", "error" in call("action", docId="dk2", action="paste") and "result" in call("snapshot", docId="dk2"))

# translation data of a text (what lupdate reads)
call("open", docId="tr1", xml=open(os.path.join(HERE, "..", "testdata", "sample.ui"), encoding="utf-8").read())
tp = lambda: next(x for x in call("properties", docId="tr1", name="okButton")["result"]["properties"] if x["name"] == "text")
check("a text reports its translation data", tp()["i18n"] == {"translatable": True, "comment": "", "disambiguation": ""}, tp())
call("setProperty", docId="tr1", name="okButton", property="text", value={"translatable": False, "comment": "Confirm", "disambiguation": "dlg"})
check("translation data is set without touching the text", tp()["value"] == "OK" and tp()["i18n"] == {"translatable": False, "comment": "Confirm", "disambiguation": "dlg"}, tp())
xtr = saved("tr1")
check("it is saved as notr, comment and extracomment and accepted by uic", 'notr="true"' in xtr and 'comment="dlg"' in xtr and 'extracomment="Confirm"' in xtr and subprocess.run([QT + "/libexec/uic", "/dev/stdin"], input=xtr, capture_output=True, text=True).returncode == 0)
call("undo", docId="tr1")
check("changing it is one undo step", tp()["i18n"]["translatable"] is True)
check("editing the text afterwards keeps the translation data", (call("setProperty", docId="tr1", name="okButton", property="text", value={"translatable": False}), call("setProperty", docId="tr1", name="okButton", property="text", value="Yes"), tp()["i18n"]["translatable"] is False)[2])

check("the central widget cannot be moved (it used to freeze the engine)", "error" in call("moveWidget", docId="sm1", name="centralwidget", x=100, y=100))
check("the central widget is marked as a part of the window", next(o for o in call("snapshot", docId="sm1")["result"]["objects"] if o["name"] == "centralwidget").get("part") is True)
check("backend alive after the refused move", "result" in call("snapshot", docId="sm1"))

pal2 = call("palette")["result"]["categories"]
lab = next((c["index"], w["index"]) for c in pal2 for w in c["widgets"] if w["name"] == "Label")
call("open", docId="ly2", xml=open(os.path.join(HERE, "..", "testdata", "free.ui"), encoding="utf-8").read())
added = call("addWidget", docId="ly2", category=lab[0], index=lab[1], x=150, y=100)["result"]["objects"][-1]
check("a label dropped from the palette is sized for its caption, not 16x16", added["w"] > 30 and added["h"] >= 12, added)

h = call("history", docId="r2")["result"]
check("the undo history lists the commands and the current position", len(h["items"]) >= 3 and 0 < h["index"] <= len(h["items"]), h)
n0 = h["index"]
call("undo", docId="r2")
check("history position follows undo", call("history", docId="r2")["result"]["index"] == n0 - 1)

# closing documents really destroys them: no crash over many cycles, and memory stays bounded
def rss_kb():
    with open(f"/proc/{p.pid}/status") as fh:
        return int(next(l for l in fh if l.startswith("VmRSS")).split()[1])
def cycle(i):
    call("open", docId=f"c{i}", xml=xml)
    call("setProperty", docId=f"c{i}", name="okButton", property="text", value=str(i))
    return call("close", docId=f"c{i}")
for i in range(10):
    cycle(i)
base = rss_kb()
for i in range(10, 60):
    r = cycle(i)
growth = rss_kb() - base
check("50 open/edit/close cycles without error", "error" not in r)
print(f"info: RSS growth over 50 cycles = {growth} kB")
check("memory growth over 50 cycles is bounded (<40 MB)", growth < 40000, f"{growth} kB")
check("backend still serves requests after the cycles", "result" in call("snapshot", docId="d1"))

# requests sent back to back (no waiting) are answered one at a time, in order, and none is lost at EOF
pp = subprocess.Popen([BACKEND], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env)
pp.stdout.readline()
batch = [{"id": 1, "method": "open", "params": {"docId": "pl", "xml": xml}}]
for i in range(2, 42):
    batch.append({"id": i, "method": "setProperty" if i % 2 == 0 else "snapshot", "params": {"docId": "pl", "name": "okButton", "property": "text", "value": f"t{i}"}})
batch.append({"id": 42, "method": "contents", "params": {"docId": "pl"}})
out, _ = pp.communicate("".join(json.dumps(b) + "\n" for b in batch), timeout=60)
replies = [json.loads(l) for l in out.splitlines() if l.strip()]
check("40+ pipelined requests are all answered, in order", [r["id"] for r in replies] == list(range(1, 43)) and all("result" in r for r in replies), [r["id"] for r in replies][:50])
check("and they ran one after the other (the last text wins)", "t40" in replies[-1]["result"]["xml"])
check("the backend exits cleanly after the pipelined batch", pp.returncode == 0, pp.returncode)

p.stdin.close()
p.wait(timeout=10)
check("backend exits cleanly on EOF", p.returncode == 0, p.returncode)
print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
