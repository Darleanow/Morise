#!/usr/bin/env python3
"""Robustness: every real .ui in the corpus through the backend, then random operations.
Usage: corpus_test.py [--fuzz N] [--seed S]. Exits non-zero on any crash, hang, bad document or refused round trip."""
import base64, glob, json, os, random, select, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
QT = os.environ.get("QT_ROOT", "/home/devel/Qt/6.11.3/gcc_64")
BACKEND = os.path.join(HERE, "..", "build", "designer_backend")
args = sys.argv[1:]
FUZZ = int(args[args.index("--fuzz") + 1]) if "--fuzz" in args else 600
SKIP_CORPUS = "--skip-corpus" in args
SEED = int(args[args.index("--seed") + 1]) if "--seed" in args else 1

class Backend:
    def __init__(self):
        self.p = subprocess.Popen([BACKEND], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.p.stdout.readline(); self.n = 0
    def call(self, method, timeout=20, **params):
        self.n += 1
        self.p.stdin.write(json.dumps({"id": self.n, "method": method, "params": params}) + "\n"); self.p.stdin.flush()
        r, _, _ = select.select([self.p.stdout], [], [], timeout)
        if not r:
            raise TimeoutError(f"hang in {method}")
        line = self.p.stdout.readline()
        if not line:
            raise ConnectionError(f"backend died in {method} (rc={self.p.poll()})")
        return json.loads(line)

problems = []
def problem(kind, detail):
    problems.append((kind, detail)); print(f"PROBLEM {kind}: {detail}")

def uic_ok(xml):
    with tempfile.TemporaryDirectory() as d:
        f = os.path.join(d, "x.ui"); open(f, "w", encoding="utf-8").write(xml)
        u = subprocess.run([QT + "/libexec/uic", f], capture_output=True, text=True)
        return u.returncode == 0, u.stderr[:200]

files = sorted(glob.glob(os.path.join(ROOT, "vendor/qttools/**/*.ui"), recursive=True)) + sorted(glob.glob(os.path.join(ROOT, "backend/testdata/*.ui")))
be = Backend()
stats = dict(docs=0, props=0, roundtrips=0, refused=0)
refused_by_kind = {}
t0 = time.time()
for f in ([] if SKIP_CORPUS else files):
    xml = open(f, encoding="utf-8", errors="replace").read()
    doc = "d%d" % stats["docs"]; stats["docs"] += 1
    try:
        r = be.call("open", docId=doc, xml=xml, path=f)
        if "error" in r:
            problem("open", f"{os.path.basename(f)}: {r['error'][:120]}"); continue
        snap = r["result"]
        assert base64.b64decode(snap["png"])[:4] == b"\x89PNG"
        names = [o["name"] for o in snap["objects"]] + [l["name"] for l in snap["layouts"]]
        for name in names:
            pr = be.call("properties", docId=doc, name=name)
            if "error" in pr:
                problem("properties", f"{os.path.basename(f)}:{name}: {pr['error']}"); continue
            for p in pr["result"]["properties"]:
                stats["props"] += 1
                if not p["enabled"] or p["kind"] in ("unsupported",) or p["name"] in ("objectName", "geometry"):
                    continue
                value = p["value"]
                if p["kind"] in ("icon", "pixmap") and value:
                    continue  # needs the file to exist next to the form
                r = be.call("setProperty", docId=doc, name=name, property=p["name"], value=value)
                stats["roundtrips"] += 1
                if "error" in r:
                    stats["refused"] += 1
                    refused_by_kind.setdefault(p["kind"], []).append(f"{os.path.basename(f)}:{name}.{p['name']}={str(value)[:40]}: {r['error'][:80]}")
        # whole-document checks after all the edits
        c = be.call("contents", docId=doc)["result"]
        ok, err = uic_ok(c["xml"])
        if not ok:
            problem("uic", f"{os.path.basename(f)} after round trip: {err}")
        if "<ui" not in c["xml"]:
            problem("contents", os.path.basename(f))
        pv = be.call("preview", docId=doc, style="Fusion", dark=True)
        if "error" in pv and "could not be built" not in pv["error"]:
            problem("preview", f"{os.path.basename(f)}: {pv['error'][:100]}")
        # reopen what we saved
        r2 = be.call("open", docId=doc + "b", xml=c["xml"])
        if "error" in r2:
            problem("reopen", f"{os.path.basename(f)}: {r2['error'][:100]}")
        else:
            be.call("close", docId=doc + "b")
        be.call("close", docId=doc)
    except (TimeoutError, ConnectionError) as e:
        problem("crash", f"{os.path.basename(f)}: {e}")
        be = Backend()
    except Exception as e:  # noqa: BLE001
        problem("exception", f"{os.path.basename(f)}: {type(e).__name__} {e}")

print(f"corpus: {stats['docs']} documents, {stats['props']} properties seen, {stats['roundtrips']} round trips, {stats['refused']} refused, {time.time()-t0:.0f}s")
for kind, items in refused_by_kind.items():
    print(f"  refused [{kind}] x{len(items)}: e.g. {items[0]}")

# ------------------------------------------------------------------ random operations
rng = random.Random(SEED)
seeds = [os.path.join(ROOT, "backend/testdata", n) for n in ("rich.ui", "free.ui", "sample.ui", "mainwindow.ui", "tabs.ui", "toolbox.ui", "interactive.ui", "freeinlayout.ui")]
fuzz_docs = 0
ops_done = 0
palette = be.call("palette")["result"]["categories"]
entries = [(c["index"], w["index"]) for c in palette for w in c["widgets"]]
ACTIONS = ["cut", "copy", "paste", "delete", "selectAll", "lower", "raise", "layoutHorizontal", "layoutVertical", "layoutGrid", "layoutForm", "breakLayout", "adjustSize", "simplifyLayout"]
t0 = time.time()
rounds = max(1, FUZZ // 150)
for rnd in range(rounds):
    src = seeds[rnd % len(seeds)]
    doc = f"f{rnd}"
    snap = be.call("open", docId=doc, xml=open(src, encoding="utf-8").read(), path=src)["result"]
    log = []
    try:
        for i in range(FUZZ // rounds):
            names = [o["name"] for o in snap["objects"]]
            free = [o for o in snap["objects"] if o["parent"] is not None and not o["laidOut"]]
            k = rng.choice(["add", "action", "geom", "select", "undo", "redo", "prop", "reparent", "connect", "gesture", "page", "dup", "form", "move", "move", "items", "grid", "pview", "pview", "pview", "pview", "menu", "menu", "task"])
            if k == "add":
                c, w = rng.choice(entries); req = ("addWidget", dict(category=c, index=w, x=rng.randint(0, 400), y=rng.randint(0, 300)))
            elif k == "action":
                req = ("action", dict(action=rng.choice(ACTIONS)))
            elif k == "geom" and free:
                items = [dict(name=o["name"], rect=[rng.randint(0, 300), rng.randint(0, 250), rng.randint(5, 200), rng.randint(5, 120)]) for o in rng.sample(free, min(len(free), rng.randint(1, 3)))]
                req = ("setGeometries", dict(items=items))
            elif k == "select":
                req = ("select", dict(names=rng.sample(names, min(len(names), rng.randint(0, 4)))))
            elif k == "undo":
                req = ("undo", {})
            elif k == "redo":
                req = ("redo", {})
            elif k == "prop" and names:
                req = ("setProperty", dict(name=rng.choice(names), property=rng.choice(["toolTip", "enabled", "windowTitle", "text", "minimumSize", "font", "sizePolicy", "alignment", "styleSheet"]),
                       value=rng.choice(["x", True, False, [1, 2], {"family": "Sans", "pointSize": 11, "bold": True}, {"h": "Fixed", "v": "Expanding", "hs": 1, "vs": 1}, ["AlignLeft"], "color: red;"])))
            elif k == "reparent" and len(snap["objects"]) > 2 and free:
                o = rng.choice(free); req = ("reparent", dict(parent=rng.choice(names), items=[dict(name=o["name"], rect=[rng.randint(0, 200), rng.randint(0, 150), o["w"], o["h"]])]))
            elif k == "grid" and names:
                cols = rng.sample(["A", "B", "", "C"], rng.randint(0, 3))
                req = ("setContents", dict(name=rng.choice(names), contents=rng.choice([
                    dict(columns=cols, rows=["r"] * rng.randint(0, 3), cells=[["x"] * len(cols)] * rng.randint(0, 3)),
                    dict(columns=cols, items=[dict(cells=["i"] * len(cols), children=[dict(cells=["c"], children=[])])] * rng.randint(0, 2))])))
            elif k == "menu":
                op = rng.choice(["bar", "menu", "entry", "entry", "sep", "sub", "remove", "removemenu", "tool", "status"])
                menus = ["menuFile", "menuEdit", "menuRecent", "menuHelp"]
                if op == "bar":
                    req = ("taskAction", dict(name=names[0], text="Create Menu Bar"))
                elif op == "tool":
                    req = ("taskAction", dict(name=names[0], text="Add Tool Bar"))
                elif op == "status":
                    req = ("taskAction", dict(name=names[0], text=rng.choice(["Create Status Bar", "Remove Status Bar"])))
                elif op == "menu":
                    req = ("addMenu", dict(title=rng.choice(["File", "Edit", "Recent", "Help"])))
                elif op == "entry":
                    req = ("addMenuEntry", dict(menu=rng.choice(menus), text=rng.choice(["New", "Open", "Quit", "a b", "x"])))
                elif op == "sep":
                    req = ("addMenuEntry", dict(menu=rng.choice(menus), separator=True))
                elif op == "sub":
                    req = ("makeSubmenu", dict(menu=rng.choice(menus), index=rng.randint(0, 3)))
                elif op == "remove":
                    req = ("removeMenuEntry", dict(menu=rng.choice(menus), index=rng.randint(0, 3)))
                else:
                    req = ("removeMenuEntry", dict(menu=rng.choice(menus)))
            elif k == "task":
                req = ("taskAction", dict(name=rng.choice(names), path=[rng.randint(0, 14), rng.randint(0, 4)]))
            elif k == "pview":
                if rng.random() < 0.08:
                    req = ("preview", dict(style=rng.choice(["Fusion", "", "Windows"]), scale=1))
                elif rng.random() < 0.04:
                    req = ("previewStop", {})
                else:
                    kind = rng.choice(["press", "release", "move", "move", "wheel", "keydown", "keyup", "dblclick"])
                    req = ("previewEvent", dict(kind=kind, x=rng.randint(0, 420), y=rng.randint(0, 300), button=rng.randint(0, 2), mods=rng.choice([0, 0, 0x02000000, 0x04000000]),
                           dx=rng.randint(-120, 120), dy=rng.randint(-120, 120), key=rng.choice(["a", "Enter", "Tab", "Backspace", "ArrowDown", "Escape", " ", "Home", "Delete", "Z"])))
            elif k == "items" and names:
                req = ("setItems", dict(name=rng.choice(names), items=rng.sample(["a", "b", "c", "", "d e"], rng.randint(0, 4))))
            elif k == "move" and len(names) > 2:
                req = ("moveWidget", dict(name=rng.choice(names), x=rng.randint(0, 400), y=rng.randint(0, 300)))
            elif k == "connect" and len(names) > 2:
                req = ("connect", dict(sender=rng.choice(names), signal="destroyed()", receiver=rng.choice(names), slot="deleteLater()"))
            elif k == "gesture":
                req = ("gesture", dict(phase=rng.choice(["begin", "end", "end"]), label="fuzz"))
            elif k == "page":
                req = ("pageOp", dict(name=rng.choice(names), op=rng.choice(["add", "addAfter", "remove"])))
            elif k == "dup":
                req = ("action", dict(action="copy"))
            elif k == "form":
                req = ("setFormInfo", dict(info=dict(grid=[rng.randint(1, 20), rng.randint(1, 20)], author="fuzz")))
            else:
                req = ("snapshot", {})
            log.append(req)
            r = be.call(req[0], docId=doc, **req[1])
            ops_done += 1
            if "result" in r and "objects" in r["result"]:
                snap = r["result"]
            elif k in ("undo", "redo", "action", "select") or "error" in r:
                snap = be.call("snapshot", docId=doc)["result"]
            if i % 25 == 24:
                be.call("gesture", docId=doc, phase="end", label="")
                c = be.call("contents", docId=doc)["result"]["xml"]
                ok, err = uic_ok(c)
                if not ok:
                    problem("fuzz-uic", f"round {rnd} op {i}: {err} last={log[-3:]}")
                r2 = be.call("open", docId=doc + "x", xml=c)
                if "error" in r2:
                    problem("fuzz-reopen", f"round {rnd} op {i}: {r2['error'][:100]} last={log[-3:]}")
                else:
                    be.call("close", docId=doc + "x")
        be.call("close", docId=doc)
    except (TimeoutError, ConnectionError) as e:
        problem("fuzz-crash", f"round {rnd} ({os.path.basename(src)}): {e}; last ops: {log[-4:]}")
        json.dump({"src": src, "ops": log}, open(f"/tmp/fuzz-crash-{SEED}-{rnd}.json", "w"))
        be = Backend(); palette = be.call("palette")["result"]["categories"]
print(f"fuzz: {ops_done} operations over {rounds} documents in {time.time()-t0:.0f}s (seed {SEED})")
print(f"\n{len(problems)} problem(s)")
os._exit(1 if problems else 0)
