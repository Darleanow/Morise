#include "host.h"

namespace qdr {

Host::Host(QObject *parent)
{
    m_core = QDesignerComponents::createFormEditor(parent);
    QDesignerComponents::createTaskMenu(m_core, parent);
    QDesignerComponents::initializeResources();
    // The engine expects these panels on the core; they are never shown.
    m_core->setWidgetBox(QDesignerComponents::createWidgetBox(m_core, nullptr));
    m_core->setPropertyEditor(QDesignerComponents::createPropertyEditor(m_core, nullptr));
    m_core->setObjectInspector(QDesignerComponents::createObjectInspector(m_core, nullptr));
    m_core->setActionEditor(QDesignerComponents::createActionEditor(m_core, nullptr));
    QDesignerComponents::initializePlugins(m_core);
    // Mirrors QDesignerWorkbench::initializeCorePlugins(): without it the signal/slot,
    // buddy and tab order editors are inactive and <connections> are dropped on save.
    for (QObject *plugin : QPluginLoader::staticInstances()) {
        if (auto *p = qobject_cast<QDesignerFormEditorPluginInterface *>(plugin)) {
            if (!p->isInitialized())
                p->initialize(m_core);
        }
    }
    new QDesignerIntegration(m_core, parent);
    m_core->setDialogGui(createHeadlessDialogGui());
    installModalGuard(parent);
}

QJsonObject Host::handle(const QString &method, const QJsonObject &p)
{
    // A gesture left open (the page vanished mid-drag) must never swallow later commands into its macro.
    static const QStringList keepsGestureOpen{QStringLiteral("gesture"), QStringLiteral("setProperty"), QStringLiteral("snapshot"),
        QStringLiteral("view"), QStringLiteral("select"), QStringLiteral("hitTest"), QStringLiteral("properties"),
        QStringLiteral("describe"), QStringLiteral("connections"), QStringLiteral("palette"), QStringLiteral("setGeometries"), QStringLiteral("history"),
        QStringLiteral("preview"), QStringLiteral("reparent"), QStringLiteral("taskActions"), QStringLiteral("containerInfo"), QStringLiteral("tabOrder"),
        QStringLiteral("formInfo")};
    if (!keepsGestureOpen.contains(method)) {
        const auto it = m_forms.constFind(p.value(QLatin1String("docId")).toString());
        if (it != m_forms.constEnd())
            endGesture(it.value());
    }
    if (method == QLatin1String("open")) return open(p);
    if (method == QLatin1String("close")) return close(p);
    if (method == QLatin1String("snapshot")) return snapshot(form(p));
    if (method == QLatin1String("select")) return select(p);
    if (method == QLatin1String("hitTest")) return hitTest(p);
    if (method == QLatin1String("properties")) return properties(p);
    if (method == QLatin1String("setProperty")) return setProperty(p);
    if (method == QLatin1String("resetProperty")) return resetProperty(p);
    if (method == QLatin1String("palette")) return palette();
    if (method == QLatin1String("gesture")) return gestureCmd(p);
    if (method == QLatin1String("describe")) return describe(p);
    if (method == QLatin1String("history")) return history(p);
    if (method == QLatin1String("setGeometries")) return setGeometries(p);
    if (method == QLatin1String("reparent")) return reparent(p);
    if (method == QLatin1String("moveWidget")) return moveWidget(p);
    if (method == QLatin1String("setItems")) return setItems(p);
    if (method == QLatin1String("setContents")) return setContents(p);
    if (method == QLatin1String("addMenu")) return addMenu(p);
    if (method == QLatin1String("makeSubmenu")) return makeSubmenu(p);
    if (method == QLatin1String("addAction")) return addAction(p);
    if (method == QLatin1String("removeAction")) return removeAction(p);
    if (method == QLatin1String("useAction")) return useAction(p);
    if (method == QLatin1String("actionGroup")) return actionGroup(p);
    if (method == QLatin1String("moveEntry")) return moveEntry(p);
    if (method == QLatin1String("customMethods")) return customMethods(p);
    // The clipboard lives in this process: the extension host mirrors it with the system clipboard.
    if (method == QLatin1String("getClipboard")) return {{QLatin1String("text"), QGuiApplication::clipboard()->text()}};
    if (method == QLatin1String("setClipboard")) {
        QGuiApplication::clipboard()->setText(p.value(QLatin1String("text")).toString());
        return {};
    }
    if (method == QLatin1String("checkStyleSheet")) return checkStyleSheet(p);
    if (method == QLatin1String("setCustomMethods")) return setCustomMethods(p);
    if (method == QLatin1String("previewEvent")) return previewEvent(p);
    if (method == QLatin1String("previewStop")) return previewStop(p);
    if (method == QLatin1String("resources")) return resources(p);
    if (method == QLatin1String("addResource")) return changeResource(p, true);
    if (method == QLatin1String("removeResource")) return changeResource(p, false);
    if (method == QLatin1String("removeMenuEntry")) return removeMenuEntry(p);
    if (method == QLatin1String("addMenuEntry")) return addMenuEntry(p);
    if (method == QLatin1String("preview")) return preview(p);
    if (method == QLatin1String("taskActions")) return taskActions(p);
    if (method == QLatin1String("taskAction")) return taskAction(p);
    if (method == QLatin1String("containerInfo")) return containerInfo(p);
    if (method == QLatin1String("setCurrentPage")) return setCurrentPage(p);
    if (method == QLatin1String("pageOp")) return pageOp(p);
    if (method == QLatin1String("connect")) return connectWidgets(p);
    if (method == QLatin1String("disconnect")) return disconnectWidgets(p);
    if (method == QLatin1String("tabOrder")) return tabOrder(p);
    if (method == QLatin1String("setTabOrder")) return setTabOrder(p);
    if (method == QLatin1String("promote")) return promote(p);
    if (method == QLatin1String("demote")) return demote(p);
    if (method == QLatin1String("formInfo")) return formInfo(p);
    if (method == QLatin1String("setFormInfo")) return setFormInfo(p);
    if (method == QLatin1String("addDynamicProperty")) return addDynamicProperty(p);
    if (method == QLatin1String("removeDynamicProperty")) return removeDynamicProperty(p);
    if (method == QLatin1String("connections")) return connections(p);
    if (method == QLatin1String("view")) {
        QDesignerFormWindowInterface *fw = form(p);
        m_scales.insert(fw, qBound(0.25, p.value(QLatin1String("scale")).toDouble(1.0), 4.0));
        return snapshot(fw);
    }
    if (method == QLatin1String("addWidget")) return addWidget(p);
    if (method == QLatin1String("action")) return action(p);
    if (method == QLatin1String("undo")) { form(p)->commandHistory()->undo(); return snapshot(form(p)); }
    if (method == QLatin1String("redo")) { form(p)->commandHistory()->redo(); return snapshot(form(p)); }
    if (method == QLatin1String("contents")) return contents(p);
    if (method == QLatin1String("markSaved")) {
        form(p)->commandHistory()->setClean();
        return snapshot(form(p));
    }
    throw ProtocolError{QStringLiteral("unknown method: ") + method};
}

QDesignerFormWindowInterface *Host::form(const QJsonObject &p) const
{
    const auto it = m_forms.constFind(p.value(QLatin1String("docId")).toString());
    if (it == m_forms.constEnd())
        throw ProtocolError{QStringLiteral("unknown docId")};
    return it.value();
}

bool Host::listed(QDesignerFormWindowInterface *fw, QWidget *w) const
{
    if (fw->isManaged(w))
        return true;
    if (!m_core->metaDataBase()->item(w))
        return false;
    if (qobject_cast<QMenuBar *>(w) || qobject_cast<QToolBar *>(w) || qobject_cast<QStatusBar *>(w))
        return true;
    const auto *mw = qobject_cast<QMainWindow *>(fw->mainContainer());
    return mw && mw->centralWidget() == w;
}

bool Host::isWindowPart(QDesignerFormWindowInterface *fw, QWidget *w) const
{
    return w != fw->mainContainer() && !fw->isManaged(w) && listed(fw, w);
}

QWidget *Host::widgetByName(QDesignerFormWindowInterface *fw, const QString &name) const
{
    if (name.isEmpty())
        return nullptr;
    QWidget *root = fw->mainContainer();
    if (idOf(root) == name)
        return root;
    for (QWidget *w : root->findChildren<QWidget *>())
        if (listed(fw, w) && idOf(w) == name)
            return w;
    return nullptr;
}

QObject *Host::objectByName(QDesignerFormWindowInterface *fw, const QString &name) const
{
    if (QWidget *w = widgetByName(fw, name))
        return w;
    for (QLayout *l : fw->mainContainer()->findChildren<QLayout *>(name)) {
        if (l->objectName() == name)
            return l;
    }
    // Actions (menu entries, tool bar buttons) have their own property sheet.
    for (QAction *a : fw->mainContainer()->findChildren<QAction *>(name)) {
        if (a->objectName() == name)
            return a;
    }
    return nullptr;
}

void Host::nameUnnamedWidgets(QDesignerFormWindowInterface *fw) const
{
    QSet<QString> used;
    const QList<QWidget *> all = fw->mainContainer()->findChildren<QWidget *>();
    for (QWidget *w : all)
        if (fw->isManaged(w) && !idOf(w).isEmpty())
            used.insert(idOf(w));
    for (QWidget *w : all) {
        if (!fw->isManaged(w) || !idOf(w).isEmpty())
            continue;
        const bool spacer = w->property("spacerName").isValid();
        const QString base = spacer ? QStringLiteral("spacer") : QStringLiteral("widget");
        QString candidate = base;
        for (int i = 2; used.contains(candidate); ++i)
            candidate = base + QString::number(i);
        used.insert(candidate);
        if (spacer)
            w->setProperty("spacerName", candidate);
        else
            w->setObjectName(candidate);
    }
}

QJsonObject Host::open(const QJsonObject &p)
{
    const QString id = p.value(QLatin1String("docId")).toString();
    if (id.isEmpty())
        throw ProtocolError{QStringLiteral("docId required")};
    if (m_forms.contains(id))
        throw ProtocolError{QStringLiteral("docId already open")};

    QDesignerFormWindowInterface *fw = m_core->formWindowManager()->createFormWindow();
    const QString path = p.value(QLatin1String("path")).toString();
    if (!path.isEmpty())
        fw->setFileName(path); // lets relative resources resolve against the .ui location
    QByteArray xml = p.value(QLatin1String("xml")).toString().toUtf8();
    QBuffer buf(&xml);
    buf.open(QIODevice::ReadOnly);
    QString err;
    if (!fw->setContents(&buf, &err)) {
        delete fw;
        throw ProtocolError{err.isEmpty() ? QStringLiteral("load failed") : err};
    }
    // The engine lays the main container out through the FormWindow; the host must give
    // it the form's own size or the saved <geometry> is rewritten (verified on sample.ui).
    nameUnnamedWidgets(fw);
    fw->resize(fw->mainContainer()->size());
    m_core->formWindowManager()->setActiveFormWindow(fw);
    m_forms.insert(id, fw);
    return snapshot(fw);
}

void Host::endGesture(QDesignerFormWindowInterface *fw)
{
    if (m_gestures.remove(fw))
        fw->endCommand();
}

QJsonObject Host::gestureCmd(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QString phase = p.value(QLatin1String("phase")).toString();
    if (phase == QLatin1String("begin")) {
        endGesture(fw);
        fw->beginCommand(p.value(QLatin1String("label")).toString());
        m_gestures.insert(fw);
    } else if (phase == QLatin1String("end")) {
        endGesture(fw);
    } else {
        throw ProtocolError{QStringLiteral("unknown gesture phase")};
    }
    return snapshot(fw);
}

// The engine's menu and tool bar editors filter their own events. When one is destroyed while it has the focus,
// ~QWidget() takes the focus away, the event reaches the editor's filter and the filter touches a half-destroyed
// object (QDesignerMenu::handleEvent calling update(): a segmentation fault that also exists in Designer itself).
// Taking the focus away and the filters off while the objects are still whole avoids it.
static void quiesceMenuEditors(QWidget *root)
{
    const QList<QWidget *> widgets = root->findChildren<QWidget *>();
    for (QWidget *w : widgets) {
        const QByteArray cls = w->metaObject()->className();
        if (cls == "QDesignerMenu" || cls == "QDesignerMenuBar" || cls == "QDesignerToolBar") {
            w->clearFocus();
            w->removeEventFilter(w);
        }
    }
    if (QWidget *focus = QApplication::focusWidget(); focus && root->isAncestorOf(focus))
        focus->clearFocus();
}

QJsonObject Host::close(const QJsonObject &p)
{
    const auto it = m_forms.find(p.value(QLatin1String("docId")).toString());
    if (it == m_forms.end())
        return {};
    QDesignerFormWindowInterface *fw = it.value();
    endGesture(fw);
    previewStop(p);
    m_forms.erase(it);
    m_scales.remove(fw);
    fw->clearSelection(false);
    m_core->formWindowManager()->removeFormWindow(fw);
    quiesceMenuEditors(fw);
    fw->hide();
    fw->deleteLater();
    QCoreApplication::sendPostedEvents(nullptr, QEvent::DeferredDelete);
    return {};
}

QJsonObject Host::contents(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    return {{QLatin1String("xml"), fw->contents()}, {QLatin1String("warnings"), QJsonArray::fromStringList(fw->checkContents())}};
}

QJsonObject Host::snapshot(QDesignerFormWindowInterface *fw)
{
    QCoreApplication::processEvents();
    // Render at the viewer's pixel density so text stays crisp on HiDPI screens and when zoomed.
    // Reported sizes and all coordinates stay in logical (1x) units.
    const qreal scale = m_scales.value(fw, 1.0);
    QPixmap px(fw->size() * scale);
    px.setDevicePixelRatio(scale);
    px.fill(Qt::transparent);
    fw->render(&px);
    QByteArray png;
    QBuffer b(&png);
    b.open(QIODevice::WriteOnly);
    px.save(&b, "PNG");

    QJsonArray objects;
    QWidget *root = fw->mainContainer();
    auto describeWidget = [&](QWidget *w) {
        QWidget *parent = w->parentWidget();
        while (parent && !listed(fw, parent))
            parent = parent->parentWidget();
        const QPoint tl = w->mapTo(fw, QPoint(0, 0));
        const QPoint origin = w->parentWidget() ? w->parentWidget()->mapTo(fw, QPoint(0, 0)) : QPoint(0, 0);
        QJsonObject described{
            {QLatin1String("name"), idOf(w)},
            {QLatin1String("class"), QString::fromUtf8(w->metaObject()->className())},
            {QLatin1String("parent"), (w == root || !parent) ? QJsonValue() : QJsonValue(idOf(parent))},
            {QLatin1String("gx"), origin.x()}, {QLatin1String("gy"), origin.y()},
            {QLatin1String("laidOut"), w != root && (isWindowPart(fw, w) || qdesigner_internal::LayoutInfo::isWidgetLaidout(m_core, w))},
            {QLatin1String("part"), isWindowPart(fw, w)},
            {QLatin1String("x"), tl.x()}, {QLatin1String("y"), tl.y()},
            {QLatin1String("w"), w->width()}, {QLatin1String("h"), w->height()}};
        // The entries of a tool bar with where they are drawn, so the page can reorder them by dragging.
        if (auto *bar = qobject_cast<QToolBar *>(w)) {
            QJsonArray entries;
            for (QAction *a : bar->actions()) {
                if (isPlaceholder(a))
                    continue;
                const QRect r = bar->actionGeometry(a); // empty when the action is not drawn: the index still counts
                entries.append(QJsonObject{{QLatin1String("x"), tl.x() + r.x()}, {QLatin1String("y"), tl.y() + r.y()}, {QLatin1String("w"), r.width()}, {QLatin1String("h"), r.height()},
                                           {QLatin1String("separator"), a->isSeparator()}});
            }
            described.insert(QLatin1String("entries"), entries);
        }
        objects.append(described);
    };
    describeWidget(root);
    for (QWidget *w : root->findChildren<QWidget *>())
        if (listed(fw, w))
            describeWidget(w);

    QJsonArray layouts;
    // Layouts nest (a horizontal layout inside a vertical one): walk the tree so each is reported.
    std::function<void(QWidget *, QLayout *, const QString &)> addLayout = [&](QWidget *w, QLayout *l, const QString &parentName) {
        const auto type = qdesigner_internal::LayoutInfo::layoutType(m_core, l);
        const QRect r = l->contentsRect().isValid() && !parentName.isEmpty() ? l->geometry() : l->contentsRect();
        const QPoint tl = w->mapTo(fw, r.topLeft());
        layouts.append(QJsonObject{
            {QLatin1String("owner"), idOf(w)}, {QLatin1String("name"), l->objectName()},
            {QLatin1String("parent"), parentName.isEmpty() ? QJsonValue() : QJsonValue(parentName)},
            {QLatin1String("kind"), qdesigner_internal::LayoutInfo::layoutName(type)},
            {QLatin1String("x"), tl.x()}, {QLatin1String("y"), tl.y()}, {QLatin1String("w"), r.width()}, {QLatin1String("h"), r.height()}});
        for (int i = 0; i < l->count(); ++i)
            if (QLayout *sub = l->itemAt(i)->layout())
                addLayout(w, sub, l->objectName());
    };
    auto describeLayout = [&](QWidget *w) {
        QLayout *l = nullptr;
        const auto type = qdesigner_internal::LayoutInfo::managedLayoutType(m_core, w, &l);
        if (type == qdesigner_internal::LayoutInfo::NoLayout)
            return;
        if (l) {
            addLayout(w, l, QString());
            return;
        }
        // splitters are their own layout
        const QPoint tl = w->mapTo(fw, QPoint(0, 0));
        layouts.append(QJsonObject{
            {QLatin1String("owner"), idOf(w)}, {QLatin1String("name"), idOf(w)}, {QLatin1String("parent"), QJsonValue()},
            {QLatin1String("kind"), qdesigner_internal::LayoutInfo::layoutName(type)},
            {QLatin1String("x"), tl.x()}, {QLatin1String("y"), tl.y()}, {QLatin1String("w"), w->width()}, {QLatin1String("h"), w->height()}});
    };
    describeLayout(root);
    for (QWidget *w : root->findChildren<QWidget *>())
        if (fw->isManaged(w))
            describeLayout(w);

    QJsonArray selection;
    QDesignerFormWindowCursorInterface *cur = fw->cursor();
    for (int i = 0; i < cur->selectedWidgetCount(); ++i)
        selection.append(idOf(cur->selectedWidget(i)));

    QJsonObject actions;
    m_core->formWindowManager()->setActiveFormWindow(fw);
    QCoreApplication::processEvents();
    for (const auto &d : actionDefs()) {
        QAction *a = m_core->formWindowManager()->action(d.id);
        actions.insert(QLatin1String(d.name), a && a->isEnabled());
    }
    QUndoStack *stack = fw->commandHistory();
    return {
        {QLatin1String("actions"), actions},
        {QLatin1String("formGeometry"), QJsonArray{root->geometry().x(), root->geometry().y(), root->geometry().width(), root->geometry().height()}},
        {QLatin1String("grid"), QJsonArray{fw->grid().x(), fw->grid().y()}},
        {QLatin1String("png"), QString::fromLatin1(png.toBase64())},
        {QLatin1String("width"), fw->width()}, {QLatin1String("height"), fw->height()}, {QLatin1String("dpr"), scale},
        {QLatin1String("objects"), objects}, {QLatin1String("layouts"), layouts}, {QLatin1String("selection"), selection},
        {QLatin1String("dirty"), fw->isDirty()},
        {QLatin1String("undoIndex"), stack->index()}, {QLatin1String("undoCount"), stack->count()},
        {QLatin1String("canUndo"), stack->canUndo()}, {QLatin1String("canRedo"), stack->canRedo()},
        {QLatin1String("undoText"), stack->undoText()}, {QLatin1String("redoText"), stack->redoText()}};
}

const std::vector<Host::ActionDef> &Host::actionDefs()
{
    using M = QDesignerFormWindowManagerInterface;
    static const std::vector<ActionDef> defs = {
        {"cut", M::CutAction}, {"copy", M::CopyAction}, {"paste", M::PasteAction},
        {"delete", M::DeleteAction}, {"selectAll", M::SelectAllAction},
        {"lower", M::LowerAction}, {"raise", M::RaiseAction},
        {"layoutHorizontal", M::HorizontalLayoutAction}, {"layoutVertical", M::VerticalLayoutAction},
        {"layoutSplitHorizontal", M::SplitHorizontalAction}, {"layoutSplitVertical", M::SplitVerticalAction},
        {"layoutGrid", M::GridLayoutAction}, {"layoutForm", M::FormLayoutAction},
        {"breakLayout", M::BreakLayoutAction}, {"adjustSize", M::AdjustSizeAction},
        {"simplifyLayout", M::SimplifyLayoutAction}};
    return defs;
}

QString Host::iconDataUrl(const QIcon &icon, int size)
{
    if (icon.isNull())
        return {};
    QPixmap px = icon.pixmap(QSize(size, size));
    if (px.isNull())
        return {};
    QByteArray png;
    QBuffer b(&png);
    b.open(QIODevice::WriteOnly);
    px.save(&b, "PNG");
    return QStringLiteral("data:image/png;base64,") + QString::fromLatin1(png.toBase64());
}

QJsonObject Host::palette()
{
    QDesignerWidgetBoxInterface *box = m_core->widgetBox();
    static const QRegularExpression classRe(QStringLiteral("<widget\\s+class=\"([^\"]+)\""));
    QJsonArray cats;
    for (int c = 0; c < box->categoryCount(); ++c) {
        const auto cat = box->category(c);
        QJsonArray widgets;
        for (int i = 0; i < box->widgetCount(c); ++i) {
            const auto w = box->widget(c, i);
            const auto m = classRe.match(w.domXml());
            widgets.append(QJsonObject{
                {QLatin1String("name"), w.name()}, {QLatin1String("index"), i},
                {QLatin1String("className"), m.hasMatch() ? m.captured(1) : QString()},
                {QLatin1String("icon"), iconDataUrl(qdesigner_internal::createIconSet(w.iconName()))}});
        }
        cats.append(QJsonObject{{QLatin1String("name"), cat.name()}, {QLatin1String("index"), c}, {QLatin1String("widgets"), widgets}});
    }
    // Languages and countries for the locale editor, in the order of the enums.
    QJsonArray languages, countries;
    const QMetaEnum le = QMetaEnum::fromType<QLocale::Language>(), ce = QMetaEnum::fromType<QLocale::Country>();
    for (int i = 0; i < le.keyCount(); ++i)
        languages.append(QString::fromLatin1(le.key(i)));
    for (int i = 0; i < ce.keyCount(); ++i)
        countries.append(QString::fromLatin1(ce.key(i)));
    return {{QLatin1String("categories"), cats}, {QLatin1String("fonts"), stringsToJson(QFontDatabase::families())},
            {QLatin1String("locales"), QJsonObject{{QLatin1String("languages"), languages}, {QLatin1String("countries"), countries}}}};
}

QJsonObject Host::describe(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
    if (!w)
        throw ProtocolError{QStringLiteral("unknown object")};
    QJsonArray signalsArr, slotsArr;
    const QMetaObject *mo = w->metaObject();
    for (int i = 0; i < mo->methodCount(); ++i) {
        const QMetaMethod m = mo->method(i);
        if (m.access() != QMetaMethod::Public)
            continue;
        if (m.methodType() != QMetaMethod::Signal && m.methodType() != QMetaMethod::Slot)
            continue;
        QJsonArray params;
        const auto types = m.parameterTypes();
        const auto names = m.parameterNames();
        for (int k = 0; k < types.size(); ++k)
            params.append(QJsonObject{{QLatin1String("type"), QString::fromLatin1(types.at(k))},
                                      {QLatin1String("name"), QString::fromLatin1(names.value(k))}});
        QJsonObject o{{QLatin1String("name"), QString::fromLatin1(m.name())},
                      {QLatin1String("signature"), QString::fromLatin1(m.methodSignature())},
                      {QLatin1String("params"), params},
                      {QLatin1String("owner"), QString::fromLatin1(m.enclosingMetaObject()->className())}};
        (m.methodType() == QMetaMethod::Signal ? signalsArr : slotsArr).append(o);
    }
    // The form's own slots and signals (Designer's "Edit Signals/Slots"), offered like any other method.
    auto *metaDb = qobject_cast<qdesigner_internal::MetaDataBase *>(m_core->metaDataBase());
    if (auto *item = metaDb ? metaDb->metaDataBaseItem(w) : nullptr) {
        auto fake = [&](const QStringList &list, QJsonArray &into) {
            for (const QString &sig : list) {
                const int open = sig.indexOf(QLatin1Char('('));
                QJsonArray params;
                for (const QString &t : sig.mid(open + 1, sig.size() - open - 2).split(QLatin1Char(','), Qt::SkipEmptyParts))
                    params.append(QJsonObject{{QLatin1String("type"), t.trimmed()}, {QLatin1String("name"), QString()}});
                into.append(QJsonObject{{QLatin1String("name"), sig.left(open)}, {QLatin1String("signature"), sig}, {QLatin1String("params"), params},
                                        {QLatin1String("owner"), QStringLiteral("(form)")}, {QLatin1String("custom"), true}});
            }
        };
        fake(item->fakeSignals(), signalsArr);
        fake(item->fakeSlots(), slotsArr);
    }
    QJsonArray chain;
    for (const QMetaObject *c = mo; c; c = c->superClass())
        chain.append(QString::fromLatin1(c->className()));
    // The class the .ui records (e.g. QPushButton), not the Designer proxy class.
    const auto *db = m_core->widgetDataBase();
    const int dbIndex = db->indexOfObject(w);
    return {{QLatin1String("name"), idOf(w)},
            {QLatin1String("class"), dbIndex >= 0 ? db->item(dbIndex)->name() : QString::fromUtf8(mo->className())},
            {QLatin1String("hierarchy"), chain}, {QLatin1String("signals"), signalsArr}, {QLatin1String("slots"), slotsArr},
            {QLatin1String("tasks"), taskTree(w)}};
}

QJsonObject Host::connections(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QXmlStreamReader r(fw->contents());
    QJsonArray out;
    QJsonObject cur;
    bool inConnections = false;
    while (!r.atEnd()) {
        r.readNext();
        if (r.isStartElement()) {
            const auto n = r.name();
            if (n == QLatin1String("connections")) inConnections = true;
            else if (inConnections && n == QLatin1String("connection")) cur = {};
            else if (inConnections && (n == QLatin1String("sender") || n == QLatin1String("signal") || n == QLatin1String("receiver") || n == QLatin1String("slot")))
                cur.insert(n.toString(), r.readElementText());
        } else if (r.isEndElement()) {
            if (r.name() == QLatin1String("connection") && inConnections && !cur.isEmpty())
                out.append(cur);
            else if (r.name() == QLatin1String("connections"))
                inConnections = false;
        }
    }
    return {{QLatin1String("connections"), out}};
}

QJsonObject Host::addWidget(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QDesignerWidgetBoxInterface *box = m_core->widgetBox();
    const int c = p.value(QLatin1String("category")).toInt(-1);
    const int i = p.value(QLatin1String("index")).toInt(-1);
    if (c < 0 || c >= box->categoryCount() || i < 0 || i >= box->widgetCount(c))
        throw ProtocolError{QStringLiteral("unknown palette entry")};
    const auto entry = box->widget(c, i);

    QString err;
    DomUI *ui = qdesigner_internal::QDesignerWidgetBox::xmlToUi(entry.name(), entry.domXml(), true, &err);
    if (!ui)
        throw ProtocolError{err};

    // Designer only allows dock widgets in a main window; elsewhere the engine crashes.
    if (const DomWidget *top = ui->elementWidget(); top && !top->elementWidget().isEmpty()
        && top->elementWidget().first()->attributeClass().endsWith(QLatin1String("DockWidget"))
        && !qobject_cast<QMainWindow *>(fw->mainContainer())) {
        delete ui;
        throw ProtocolError{QStringLiteral("A dock widget can only be added to a main window form (QMainWindow).")};
    }
    // Target: the managed widget under the point (a container is found by the engine).
    const QPoint pos(qRound(p.value(QLatin1String("x")).toDouble()), qRound(p.value(QLatin1String("y")).toDouble()));
    QWidget *target = fw->childAt(pos);
    while (target && !fw->isManaged(target))
        target = target->parentWidget();
    if (!target)
        target = fw->mainContainer();
    // A scroll area or dock widget holds one widget: the engine replaces the old content and frees it
    // without telling the rest of the editor, which then crashes on the dangling pointer.
    if (const auto *sa = qobject_cast<QScrollArea *>(target); sa && sa->widget()) {
        delete ui;
        throw ProtocolError{QStringLiteral("%1 already has content; drop into its content widget or lay it out instead.").arg(idOf(target))};
    }
    if (const auto *dw = qobject_cast<QDockWidget *>(target); dw && dw->widget()) {
        delete ui;
        throw ProtocolError{QStringLiteral("%1 already has content; drop into its content widget instead.").arg(idOf(target))};
    }

    // Size like the engine does for a drag: the widget's size hint, at least 16x16.
    QSize size(16, 16);
    if (const DomWidget *dw = ui->elementWidget(); dw && !dw->elementWidget().isEmpty()) {
        const QString cls = dw->elementWidget().first()->attributeClass();
        if (QWidget *probe = m_core->widgetFactory()->createWidget(cls, nullptr)) {
            // The palette entry carries its caption ("TextLabel"): measure with it, as the engine's own drag does.
            for (const DomProperty *prop : dw->elementWidget().first()->elementProperty()) {
                if (prop->kind() == DomProperty::String && (prop->attributeName() == QLatin1String("text") || prop->attributeName() == QLatin1String("title")))
                    probe->setProperty(prop->attributeName().toUtf8().constData(), prop->elementString()->text());
            }
            size = size.expandedTo(probe->sizeHint()).expandedTo(probe->minimumSizeHint());
            delete probe;
        }
    }
    const QPoint global = fw->mapToGlobal(pos);
    auto *decoration = new QWidget;
    decoration->setGeometry(QRect(global, size));
    auto *item = new PaletteDropItem(ui, decoration, global);

    auto *base = qobject_cast<qdesigner_internal::FormWindowBase *>(fw);
    if (!base)
        throw ProtocolError{QStringLiteral("form window does not support drops")};
    m_core->formWindowManager()->setActiveFormWindow(fw);
    aimLayoutCell(base, target, global, nullptr, p.value(QLatin1String("side")).toString());
    const bool ok = base->dropWidgets({item}, target, global);
    delete item;
    if (!ok)
        throw ProtocolError{QStringLiteral("the engine refused the drop at this position")};
    return snapshot(fw);
}

QJsonObject Host::action(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QString name = p.value(QLatin1String("action")).toString();
    for (const auto &d : actionDefs()) {
        if (name != QLatin1String(d.name))
            continue;
        m_core->formWindowManager()->setActiveFormWindow(fw);
        QCoreApplication::processEvents();
        QAction *a = m_core->formWindowManager()->action(d.id);
        if (!a || !a->isEnabled())
            throw ProtocolError{QStringLiteral("action not available for the current selection: ") + name};
        // Dock widgets only live in a main window: pasted elsewhere the engine crashes (found by fuzz, seed 78).
        if (name == QLatin1String("paste") && !qobject_cast<QMainWindow *>(fw->mainContainer())
            && QGuiApplication::clipboard()->text().contains(QLatin1String("class=\"QDockWidget\"")))
            throw ProtocolError{QStringLiteral("A dock widget can only be pasted into a main window form (QMainWindow).")};
        a->trigger();
        nameUnnamedWidgets(fw); // a layout made from a selection creates an unnamed layout widget
        return snapshot(fw);
    }
    throw ProtocolError{QStringLiteral("unknown action: ") + name};
}

QJsonObject Host::select(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    fw->clearSelection(false);
    const QJsonArray names = p.value(QLatin1String("names")).toArray();
    for (const QJsonValue &n : names) {
        if (QWidget *w = widgetByName(fw, n.toString()))
            fw->selectWidget(w, true);
    }
    return snapshot(fw);
}

QJsonObject Host::hitTest(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *w = fw->childAt(qRound(p.value(QLatin1String("x")).toDouble()), qRound(p.value(QLatin1String("y")).toDouble()));
    while (w && !listed(fw, w))
        w = w->parentWidget();
    // The central widget stands for the window itself: clicking on it selects the form, as in Designer.
    if (const auto *mw = qobject_cast<QMainWindow *>(fw->mainContainer()); mw && w && w == mw->centralWidget())
        w = fw->mainContainer();
    return {{QLatin1String("name"), w ? QJsonValue(idOf(w)) : QJsonValue()}};
}

} // namespace qdr
