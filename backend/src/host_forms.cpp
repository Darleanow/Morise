#include "host.h"

namespace qdr {

QWidgetList Host::currentTabOrder(QDesignerFormWindowInterface *fw) const
{
    QWidget *root = fw->mainContainer();
    QWidgetList order;
    // Designer keeps the tab order on the form window's meta-database item, not on the main container.
    if (auto *item = m_core->metaDataBase()->item(fw))
        order = item->tabOrder();
    QWidgetList all;
    for (QWidget *w : root->findChildren<QWidget *>()) {
        if (!fw->isManaged(w))
            continue;
        // Designer turns focus off on design-time widgets; the real policy lives in the property sheet.
        auto *sheet = qt_extension<QDesignerPropertySheetExtension *>(m_core->extensionManager(), w);
        const int fi = sheet ? sheet->indexOf(QStringLiteral("focusPolicy")) : -1;
        if (fi < 0)
            continue;
        const auto e = sheet->property(fi).value<PropertySheetEnumValue>();
        const QString key = e.metaEnum.valueToKey(e.value);
        if (key.contains(QLatin1String("Tab")) || key.contains(QLatin1String("Strong")) || key.contains(QLatin1String("Wheel")))
            all << w;
    }
    QWidgetList out;
    for (QWidget *w : std::as_const(order))
        if (all.contains(w) && !out.contains(w))
            out << w;
    for (QWidget *w : std::as_const(all))
        if (!out.contains(w))
            out << w;
    return out;
}

QJsonObject Host::tabOrder(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QJsonArray names;
    for (QWidget *w : currentTabOrder(fw))
        names.append(idOf(w));
    return {{QLatin1String("order"), names}};
}

QJsonObject Host::setTabOrder(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidgetList list;
    for (const QJsonValue &n : p.value(QLatin1String("order")).toArray()) {
        QWidget *w = widgetByName(fw, n.toString());
        if (!w)
            throw ProtocolError{QStringLiteral("unknown widget in tab order")};
        list << w;
    }
    auto *cmd = new qdesigner_internal::TabOrderCommand(fw);
    cmd->init(list);
    fw->commandHistory()->push(cmd);
    return snapshot(fw);
}

QJsonObject Host::promote(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    static const QRegularExpression ident(QStringLiteral("^[A-Za-z_][A-Za-z0-9_:]*$"));
    const QString className = p.value(QLatin1String("className")).toString();
    const QString include = p.value(QLatin1String("include")).toString();
    if (!ident.match(className).hasMatch() || include.isEmpty())
        throw ProtocolError{QStringLiteral("a class name and a header are required")};
    QList<QPointer<QWidget>> keep;
    QList<QPointer<QWidget>> widgets;
    QString base;
    for (const QJsonValue &n : p.value(QLatin1String("names")).toArray()) {
        QWidget *w = widgetByName(fw, n.toString());
        if (!w)
            throw ProtocolError{QStringLiteral("unknown widget")};
        const auto *db = m_core->widgetDataBase();
        const int idx = db->indexOfObject(w);
        const QString cls = idx >= 0 ? db->item(idx)->name() : QString();
        if (base.isEmpty()) base = cls;
        else if (base != cls)
            throw ProtocolError{QStringLiteral("promote widgets of one class at a time")};
        widgets << w;
    }
    if (widgets.isEmpty())
        throw ProtocolError{QStringLiteral("nothing to promote")};
    QDesignerPromotionInterface *pi = m_core->promotion();
    bool known = false;
    for (const auto &item : pi->promotedClasses())
        if (item.promotedItem && item.promotedItem->name() == className) known = true;
    QString err;
    if (!known && !pi->addPromotedClass(base, className, include, &err))
        throw ProtocolError{err};
    auto *cmd = new qdesigner_internal::PromoteToCustomWidgetCommand(fw);
    cmd->init(widgets, className);
    fw->commandHistory()->push(cmd);
    return snapshot(fw);
}

QJsonObject Host::demote(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
    if (!w)
        throw ProtocolError{QStringLiteral("unknown widget")};
    auto *cmd = new qdesigner_internal::DemoteFromCustomWidgetCommand(fw);
    cmd->init(QList<QPointer<QWidget>>() << QPointer<QWidget>(w));
    fw->commandHistory()->push(cmd);
    return snapshot(fw);
}

QJsonObject Host::formInfo(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    int margin = 0, spacing = 0;
    fw->layoutDefault(&margin, &spacing);
    return {{QLatin1String("grid"), QJsonArray{fw->grid().x(), fw->grid().y()}},
            {QLatin1String("layoutDefault"), QJsonArray{margin == INT_MIN ? QJsonValue() : QJsonValue(margin), spacing == INT_MIN ? QJsonValue() : QJsonValue(spacing)}},
            {QLatin1String("author"), fw->author()}, {QLatin1String("comment"), fw->comment()},
            {QLatin1String("exportMacro"), fw->exportMacro()}, {QLatin1String("pixmapFunction"), fw->pixmapFunction()},
            {QLatin1String("includeHints"), stringsToJson(fw->includeHints())},
            {QLatin1String("resourceFiles"), stringsToJson(fw->resourceFiles())},
            {QLatin1String("resources"), resources(p).value(QLatin1String("files"))},
            {QLatin1String("actions"), actionsOf(fw)}, {QLatin1String("actionTargets"), actionTargets(fw)}};
}

QJsonObject Host::setFormInfo(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QJsonObject o = p.value(QLatin1String("info")).toObject();
    if (o.contains(QLatin1String("grid"))) {
        const auto g = o.value(QLatin1String("grid")).toArray();
        fw->setGrid(QPoint(qBound(1, g[0].toInt(), 100), qBound(1, g[1].toInt(), 100)));
    }
    if (o.contains(QLatin1String("layoutDefault"))) {
        const auto d = o.value(QLatin1String("layoutDefault")).toArray();
        fw->setLayoutDefault(d[0].isNull() ? INT_MIN : d[0].toInt(), d[1].isNull() ? INT_MIN : d[1].toInt());
    }
    if (o.contains(QLatin1String("author"))) fw->setAuthor(o.value(QLatin1String("author")).toString());
    if (o.contains(QLatin1String("comment"))) fw->setComment(o.value(QLatin1String("comment")).toString());
    if (o.contains(QLatin1String("exportMacro"))) fw->setExportMacro(o.value(QLatin1String("exportMacro")).toString());
    if (o.contains(QLatin1String("includeHints"))) fw->setIncludeHints(jsonToStrings(o.value(QLatin1String("includeHints"))));
    fw->setDirty(true);
    return snapshot(fw);
}

QJsonObject Host::addDynamicProperty(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QObject *o = requireObject(fw, p.value(QLatin1String("name")).toString());
    const QString name = p.value(QLatin1String("property")).toString();
    static const QRegularExpression ident(QStringLiteral("^[A-Za-z_][A-Za-z0-9_]*$"));
    if (!ident.match(name).hasMatch())
        throw ProtocolError{QStringLiteral("invalid property name")};
    const QString kind = p.value(QLatin1String("kind")).toString();
    QVariant value;
    if (kind == QLatin1String("int")) value = p.value(QLatin1String("value")).toInt();
    else if (kind == QLatin1String("bool")) value = p.value(QLatin1String("value")).toBool();
    else if (kind == QLatin1String("double")) value = p.value(QLatin1String("value")).toDouble();
    else value = p.value(QLatin1String("value")).toString();
    auto *cmd = new qdesigner_internal::AddDynamicPropertyCommand(fw);
    if (!cmd->init(QObjectList() << o, o, name, value)) {
        delete cmd;
        throw ProtocolError{QStringLiteral("a property with this name already exists")};
    }
    fw->commandHistory()->push(cmd);
    return snapshot(fw);
}

QJsonObject Host::removeDynamicProperty(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QObject *o = requireObject(fw, p.value(QLatin1String("name")).toString());
    auto *cmd = new qdesigner_internal::RemoveDynamicPropertyCommand(fw);
    if (!cmd->init(QObjectList() << o, o, p.value(QLatin1String("property")).toString())) {
        delete cmd;
        throw ProtocolError{QStringLiteral("not a dynamic property")};
    }
    fw->commandHistory()->push(cmd);
    return snapshot(fw);
}

} // namespace qdr

namespace qdr {

/// Adds a top-level menu to the menu bar the way a user does in Designer: double-click the "Type Here"
/// placeholder, type the title, press Enter. The commands behind it are not exported, the events are.
QJsonObject Host::addMenu(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    auto *bar = fw->mainContainer()->findChild<QDesignerMenuBar *>();
    if (!bar)
        throw ProtocolError{QStringLiteral("this form has no menu bar")};
    const QString title = p.value(QLatin1String("title")).toString().trimmed();
    if (title.isEmpty())
        throw ProtocolError{QStringLiteral("a menu needs a title")};
    m_core->formWindowManager()->setActiveFormWindow(fw);
    QCoreApplication::processEvents();
    const int before = bar->actions().size();
    QAction *placeholder = bar->actions().isEmpty() ? nullptr : bar->actions().last();
    if (!placeholder)
        throw ProtocolError{QStringLiteral("the menu bar has no placeholder")};
    const QPoint at = bar->actionGeometry(placeholder).center();
    auto send = [&](QEvent::Type t, Qt::MouseButton b, Qt::MouseButtons bs) {
        QMouseEvent ev(t, QPointF(at), QPointF(bar->mapToGlobal(at)), QPointF(bar->mapToGlobal(at)), b, bs, Qt::NoModifier);
        QCoreApplication::sendEvent(bar, &ev);
    };
    send(QEvent::MouseButtonPress, Qt::LeftButton, Qt::LeftButton);
    send(QEvent::MouseButtonRelease, Qt::LeftButton, Qt::NoButton);
    send(QEvent::MouseButtonDblClick, Qt::LeftButton, Qt::LeftButton);
    send(QEvent::MouseButtonRelease, Qt::LeftButton, Qt::NoButton);
    QLineEdit *editor = bar->findChild<QLineEdit *>();
    if (!editor)
        throw ProtocolError{QStringLiteral("the menu bar editor did not open")};
    editor->setText(title);
    QKeyEvent press(QEvent::KeyPress, Qt::Key_Return, Qt::NoModifier, QStringLiteral("\r"));
    QCoreApplication::sendEvent(editor, &press);
    QKeyEvent release(QEvent::KeyRelease, Qt::Key_Return, Qt::NoModifier);
    QCoreApplication::sendEvent(editor, &release);
    QCoreApplication::processEvents();
    closePopups();
    if (bar->actions().size() <= before)
        throw ProtocolError{QStringLiteral("the menu could not be created")};
    return snapshot(fw);
}

} // namespace qdr

namespace qdr {

/// Adds an entry to a menu: double-click the "Type Here" placeholder of the menu, type, press Enter.
QJsonObject Host::addMenuEntry(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QString menuName = p.value(QLatin1String("menu")).toString();
    auto *menu = fw->mainContainer()->findChild<QDesignerMenu *>(menuName);
    if (!menu)
        throw ProtocolError{QStringLiteral("unknown menu: ") + menuName};
    const QString text = p.value(QLatin1String("text")).toString().trimmed();
    const bool separator = p.value(QLatin1String("separator")).toBool();
    if (text.isEmpty() && !separator)
        throw ProtocolError{QStringLiteral("an entry needs a text")};
    m_core->formWindowManager()->setActiveFormWindow(fw);
    const int before = menu->actions().size();
    menu->show(); // the editor needs a visible menu to lay itself out
    QCoreApplication::processEvents();
    struct Close { QDesignerMenu *m; ~Close() { m->closeMenuChain(); m->hide(); } } close{menu};
    // The menu ends with two design-time placeholders: "Type Here" and "Add Separator".
    if (menu->actions().size() < 2)
        throw ProtocolError{QStringLiteral("the menu has no placeholder")};
    QAction *placeholder = menu->actions().at(menu->actions().size() - (separator ? 1 : 2));
    const QPoint at = menu->actionGeometry(placeholder).center();
    auto send = [&](QEvent::Type t, Qt::MouseButton b, Qt::MouseButtons bs) {
        QMouseEvent ev(t, QPointF(at), QPointF(menu->mapToGlobal(at)), QPointF(menu->mapToGlobal(at)), b, bs, Qt::NoModifier);
        QCoreApplication::sendEvent(menu, &ev);
    };
    send(QEvent::MouseButtonPress, Qt::LeftButton, Qt::LeftButton);
    send(QEvent::MouseButtonRelease, Qt::LeftButton, Qt::NoButton);
    send(QEvent::MouseButtonDblClick, Qt::LeftButton, Qt::LeftButton); // on "Add Separator" this adds one
    send(QEvent::MouseButtonRelease, Qt::LeftButton, Qt::NoButton);
    if (!separator) {
        QLineEdit *editor = menu->findChild<QLineEdit *>();
        if (!editor)
            throw ProtocolError{QStringLiteral("the menu editor did not open")};
        editor->setText(text);
        QKeyEvent press(QEvent::KeyPress, Qt::Key_Return, Qt::NoModifier, QStringLiteral("\r"));
        QCoreApplication::sendEvent(editor, &press);
        QKeyEvent release(QEvent::KeyRelease, Qt::Key_Return, Qt::NoModifier);
        QCoreApplication::sendEvent(editor, &release);
    }
    QCoreApplication::processEvents();
    if (menu->actions().size() <= before)
        throw ProtocolError{QStringLiteral("the entry could not be created")};
    return snapshot(fw);
}

} // namespace qdr

namespace qdr {

static bool isPlaceholder(const QAction *a)
{
    return QLatin1String(a->metaObject()->className()).contains(QLatin1String("SpecialMenuAction"));
}

static QJsonArray entriesOf(QMenu *menu)
{
    QJsonArray out;
    for (QAction *a : menu->actions()) {
        if (isPlaceholder(a))
            continue;
        QJsonObject e{{QLatin1String("name"), a->objectName()}, {QLatin1String("text"), a->text()},
                      {QLatin1String("separator"), a->isSeparator()}};
        if (QMenu *sub = a->menu()) {
            e.insert(QLatin1String("menu"), sub->objectName());
            e.insert(QLatin1String("entries"), entriesOf(sub));
        }
        out.append(e);
    }
    return out;
}

/// The menus of a menu bar with their entries, or null for any other object.
QJsonValue Host::menusOf(QObject *o)
{
    auto *bar = qobject_cast<QMenuBar *>(o);
    if (!bar || !QLatin1String(bar->metaObject()->className()).contains(QLatin1String("MenuBar")))
        return QJsonValue(QJsonValue::Null);
    QJsonArray out;
    for (QAction *a : bar->actions()) {
        if (isPlaceholder(a) || !a->menu())
            continue;
        out.append(QJsonObject{{QLatin1String("name"), a->menu()->objectName()}, {QLatin1String("title"), a->text()},
                               {QLatin1String("entries"), entriesOf(a->menu())}});
    }
    return out;
}

/// Removes a top-level menu (`menu` only) or one entry of a menu (`menu` and `entry`, the action's name or its
/// index among the real entries for separators), through the engine's own delete helpers.
QJsonObject Host::removeMenuEntry(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QString menuName = p.value(QLatin1String("menu")).toString();
    auto *menu = fw->mainContainer()->findChild<QDesignerMenu *>(menuName);
    if (!menu)
        throw ProtocolError{QStringLiteral("unknown menu: ") + menuName};
    m_core->formWindowManager()->setActiveFormWindow(fw);
    if (!p.contains(QLatin1String("index"))) {
        auto *bar = fw->mainContainer()->findChild<QDesignerMenuBar *>();
        QAction *target = nullptr;
        for (QAction *a : bar ? bar->actions() : QList<QAction *>())
            if (a->menu() == menu)
                target = a;
        if (!target)
            throw ProtocolError{QStringLiteral("the menu is not in the menu bar")};
        bar->deleteMenuAction(target);
        return snapshot(fw);
    }
    const int index = p.value(QLatin1String("index")).toInt(-1);
    QList<QAction *> real;
    for (QAction *a : menu->actions())
        if (!isPlaceholder(a))
            real << a;
    if (index < 0 || index >= real.size())
        throw ProtocolError{QStringLiteral("no such entry")};
    menu->deleteAction(real.at(index));
    return snapshot(fw);
}

} // namespace qdr

namespace qdr {

namespace {

/// Adding or removing a resource file is not an undo step in the engine itself; this makes it one.
class ResourceFileCommand : public QUndoCommand
{
public:
    ResourceFileCommand(QDesignerFormWindowInterface *fw, const QString &stored, bool add)
        : QUndoCommand(add ? QStringLiteral("Add resource file") : QStringLiteral("Remove resource file")), m_fw(fw), m_stored(stored), m_add(add) {}
    void redo() override { apply(m_add); }
    void undo() override { apply(!m_add); }

private:
    void apply(bool add)
    {
        if (!m_fw)
            return;
        QtResourceModel *model = m_fw->core()->resourceModel();
        if (!m_fw->resourceSet() && model) {
            auto *set = model->addResourceSet({});
            m_fw->setResourceSet(set);
        }
        const QString abs = QFileInfo(m_stored).isRelative() ? m_fw->absoluteDir().absoluteFilePath(m_stored) : m_stored;
        const QString clean = QDir::cleanPath(abs);
        if (add)
            m_fw->addResourceFile(m_stored);
        else
            m_fw->removeResourceFile(m_stored);
        // What the engine saves and resolves icons against is the resource set, not the plain list.
        if (m_fw->resourceSet()) {
            QStringList active = m_fw->activeResourceFilePaths();
            active.removeAll(clean);
            if (add)
                active << clean;
            m_fw->activateResourceFilePaths(active);
        }
    }
    QPointer<QDesignerFormWindowInterface> m_fw;
    QString m_stored;
    bool m_add;
};

QJsonObject describeQrc(const QString &path)
{
    QJsonArray prefixes;
    QFile f(path);
    const bool exists = f.open(QIODevice::ReadOnly);
    if (exists) {
        QXmlStreamReader xml(&f);
        QString prefix;
        QJsonArray files;
        bool inFile = false;
        while (!xml.atEnd() && !xml.hasError()) {
            xml.readNext();
            if (xml.isStartElement() && xml.name() == QLatin1String("qresource")) {
                prefix = xml.attributes().value(QLatin1String("prefix")).toString();
                files = QJsonArray();
            } else if (xml.isStartElement() && xml.name() == QLatin1String("file")) {
                const QString alias = xml.attributes().value(QLatin1String("alias")).toString();
                const QString text = xml.readElementText();
                files.append(alias.isEmpty() ? text : alias);
                inFile = true;
            } else if (xml.isEndElement() && xml.name() == QLatin1String("qresource")) {
                prefixes.append(QJsonObject{{QLatin1String("prefix"), prefix}, {QLatin1String("files"), files}});
            }
        }
        Q_UNUSED(inFile);
    }
    return {{QLatin1String("path"), path}, {QLatin1String("exists"), exists}, {QLatin1String("prefixes"), prefixes}};
}

} // namespace

/// The resource files the form uses with what they contain, so the page can offer their icons.
QJsonObject Host::resources(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QJsonArray files;
    for (const QString &path : fw->resourceFiles()) {
        const QString abs = QFileInfo(path).isRelative() ? fw->absoluteDir().absoluteFilePath(path) : path;
        QJsonObject o = describeQrc(abs);
        o.insert(QLatin1String("path"), path);
        files.append(o);
    }
    return {{QLatin1String("files"), files}};
}

QJsonObject Host::changeResource(const QJsonObject &p, bool add)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QString path = p.value(QLatin1String("path")).toString();
    if (path.isEmpty())
        throw ProtocolError{QStringLiteral("a resource file needs a path")};
    if (add && !QFileInfo::exists(QFileInfo(path).isRelative() ? fw->absoluteDir().absoluteFilePath(path) : path))
        throw ProtocolError{QStringLiteral("the resource file does not exist: ") + path};
    if (add == fw->resourceFiles().contains(path))
        return snapshot(fw);
    // Stored the way Designer saves it: relative to the form when the form has a place on disk.
    QString stored = path;
    if (add && !fw->fileName().isEmpty() && QFileInfo(path).isAbsolute())
        stored = fw->absoluteDir().relativeFilePath(path);
    auto *cmd = new ResourceFileCommand(fw, add ? stored : path, add);
    fw->commandHistory()->push(cmd);
    return snapshot(fw);
}

} // namespace qdr

namespace qdr {

/// Turns an entry of a menu into a sub menu (the engine's own "create sub menu" step), so entries can be added to it.
QJsonObject Host::makeSubmenu(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QString menuName = p.value(QLatin1String("menu")).toString();
    auto *menu = fw->mainContainer()->findChild<QDesignerMenu *>(menuName);
    if (!menu)
        throw ProtocolError{QStringLiteral("unknown menu: ") + menuName};
    const int index = p.value(QLatin1String("index")).toInt(-1);
    QList<QAction *> real;
    for (QAction *a : menu->actions())
        if (!isPlaceholder(a))
            real << a;
    if (index < 0 || index >= real.size() || real.at(index)->isSeparator() || real.at(index)->menu())
        throw ProtocolError{QStringLiteral("this entry cannot become a sub menu")};
    m_core->formWindowManager()->setActiveFormWindow(fw);
    menu->show();
    QCoreApplication::processEvents();
    struct Close { QDesignerMenu *m; ~Close() { m->closeMenuChain(); m->hide(); } } close{menu};
    menu->createRealMenuAction(real.at(index));
    QCoreApplication::processEvents();
    if (!real.at(index)->menu())
        throw ProtocolError{QStringLiteral("the sub menu could not be created")};
    return snapshot(fw);
}

} // namespace qdr

namespace qdr {

/// The form's own actions (menu entries and tool bar buttons), without the design-time placeholders and the
/// actions that only open a menu: those belong to the menus editor.
QJsonArray Host::actionsOf(QDesignerFormWindowInterface *fw) const
{
    QJsonArray out;
    const QList<QWidget *> widgets = fw->mainContainer()->findChildren<QWidget *>();
    for (QAction *a : fw->mainContainer()->findChildren<QAction *>()) {
        if (isPlaceholder(a) || a->menu() || a->objectName().isEmpty())
            continue;
        QJsonArray usedIn;
        for (QWidget *w : widgets)
            if (w->actions().contains(a) && !idOf(w).isEmpty())
                usedIn.append(idOf(w));
        // The engine keeps the shortcut in its property sheet, not on the QAction.
        QString shortcut = a->shortcut().toString();
        if (auto *sheet = qt_extension<QDesignerPropertySheetExtension *>(m_core->extensionManager(), a)) {
            const int index = sheet->indexOf(QStringLiteral("shortcut"));
            if (index >= 0)
                shortcut = qvariant_cast<qdesigner_internal::PropertySheetKeySequenceValue>(sheet->property(index)).value().toString();
        }
        out.append(QJsonObject{{QLatin1String("name"), a->objectName()}, {QLatin1String("text"), a->text()},
                               {QLatin1String("separator"), a->isSeparator()}, {QLatin1String("checkable"), a->isCheckable()},
                               {QLatin1String("shortcut"), shortcut}, {QLatin1String("hasIcon"), !a->icon().isNull()},
                               {QLatin1String("usedIn"), usedIn}});
    }
    return out;
}

/// Creates an action the way the engine's action editor does, as one undo step.
QJsonObject Host::addAction(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QString text = p.value(QLatin1String("text")).toString().trimmed();
    if (text.isEmpty())
        throw ProtocolError{QStringLiteral("an action needs a text")};
    QString name = p.value(QLatin1String("name")).toString().trimmed();
    if (name.isEmpty()) {
        // Same naming as Designer: "action" followed by the text as an identifier.
        QString id;
        for (const QChar c : text)
            if (c.isLetterOrNumber())
                id += id.isEmpty() ? c.toUpper() : c;
        name = QStringLiteral("action") + (id.isEmpty() ? QStringLiteral("New") : id);
    }
    static const QRegularExpression ident(QStringLiteral("^[A-Za-z_][A-Za-z0-9_]*$"));
    if (!ident.match(name).hasMatch())
        throw ProtocolError{QStringLiteral("not a valid object name: ") + name};
    auto *action = new QAction(fw);
    action->setObjectName(name);
    fw->ensureUniqueObjectName(action);
    action->setText(text);
    auto *sheet = qt_extension<QDesignerPropertySheetExtension *>(m_core->extensionManager(), action);
    auto initial = [&](const QString &prop, const QVariant &value) {
        const int index = sheet->indexOf(prop);
        if (index >= 0) {
            sheet->setProperty(index, value);
            sheet->setChanged(index, true);
        }
    };
    if (p.value(QLatin1String("checkable")).toBool())
        initial(QStringLiteral("checkable"), true);
    const QString shortcut = p.value(QLatin1String("shortcut")).toString();
    if (!shortcut.isEmpty())
        initial(QStringLiteral("shortcut"), QVariant::fromValue(qdesigner_internal::PropertySheetKeySequenceValue(QKeySequence(shortcut))));
    auto *cmd = new qdesigner_internal::AddActionCommand(fw);
    cmd->init(action);
    fw->commandHistory()->push(cmd);
    QJsonObject out = snapshot(fw);
    out.insert(QLatin1String("created"), action->objectName());
    return out;
}

/// Deletes an action from the form and from every menu and tool bar that uses it (one undo step).
QJsonObject Host::removeAction(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QString name = p.value(QLatin1String("name")).toString();
    QAction *target = nullptr;
    for (QAction *a : fw->mainContainer()->findChildren<QAction *>(name))
        if (a->objectName() == name && !isPlaceholder(a) && !a->menu())
            target = a;
    if (!target)
        throw ProtocolError{QStringLiteral("unknown action: ") + name};
    fw->beginCommand(QStringLiteral("Remove action %1").arg(name));
    auto *cmd = new qdesigner_internal::RemoveActionCommand(fw);
    cmd->init(target);
    fw->commandHistory()->push(cmd);
    fw->endCommand();
    return snapshot(fw);
}

} // namespace qdr

namespace qdr {

namespace {

/// Puts an existing action into a menu or tool bar, or takes it out: the engine's insertion command is not exported.
class UseActionCommand : public QUndoCommand
{
public:
    UseActionCommand(QWidget *target, QAction *action, QAction *before, bool insert)
        : QUndoCommand(insert ? QStringLiteral("Add action") : QStringLiteral("Remove action")), m_target(target), m_action(action), m_before(before), m_insert(insert) {}
    void redo() override { apply(m_insert); }
    void undo() override { apply(!m_insert); }

private:
    void apply(bool insert)
    {
        if (!m_target || !m_action)
            return;
        if (insert) {
            if (m_before)
                m_target->insertAction(m_before, m_action);
            else
                m_target->addAction(m_action);
        } else {
            m_target->removeAction(m_action);
        }
        m_target->update();
    }
    QPointer<QWidget> m_target;
    QPointer<QAction> m_action;
    QPointer<QAction> m_before;
    bool m_insert;
};

} // namespace

/// The menus and tool bars an action can be placed in.
QJsonArray Host::actionTargets(QDesignerFormWindowInterface *fw) const
{
    QJsonArray out;
    for (QWidget *w : fw->mainContainer()->findChildren<QWidget *>()) {
        const bool menu = qobject_cast<QMenu *>(w) != nullptr;
        if ((!menu && !qobject_cast<QToolBar *>(w)) || w->objectName().isEmpty())
            continue;
        out.append(QJsonObject{{QLatin1String("name"), w->objectName()}, {QLatin1String("kind"), menu ? QLatin1String("menu") : QLatin1String("toolbar")},
                               {QLatin1String("title"), menu ? static_cast<QMenu *>(w)->title() : w->windowTitle()}});
    }
    return out;
}

/// Places an existing action in a menu or tool bar (`action` + `target`), a new separator (`separator`), or takes
/// the action out again (`remove`). One undo step each.
QJsonObject Host::useAction(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QString targetName = p.value(QLatin1String("target")).toString();
    QWidget *target = nullptr;
    for (QWidget *w : fw->mainContainer()->findChildren<QWidget *>(targetName))
        if (w->objectName() == targetName && (qobject_cast<QMenu *>(w) || qobject_cast<QToolBar *>(w)))
            target = w;
    if (!target)
        throw ProtocolError{QStringLiteral("unknown menu or tool bar: ") + targetName};
    const bool remove = p.value(QLatin1String("remove")).toBool();
    const bool separator = p.value(QLatin1String("separator")).toBool();
    QAction *before = nullptr;
    for (QAction *a : target->actions())
        if (isPlaceholder(a)) {
            before = a; // menus keep their design-time "Type Here" entries last
            break;
        }
    if (separator && !remove) {
        fw->beginCommand(QStringLiteral("Add separator"));
        auto *sep = new QAction(fw);
        sep->setObjectName(QStringLiteral("separator"));
        fw->ensureUniqueObjectName(sep);
        sep->setSeparator(true);
        auto *add = new qdesigner_internal::AddActionCommand(fw);
        add->init(sep);
        fw->commandHistory()->push(add);
        fw->commandHistory()->push(new UseActionCommand(target, sep, before, true));
        fw->endCommand();
        return snapshot(fw);
    }
    const QString name = p.value(QLatin1String("action")).toString();
    QAction *action = nullptr;
    for (QAction *a : fw->mainContainer()->findChildren<QAction *>(name))
        if (a->objectName() == name && !isPlaceholder(a) && !a->menu())
            action = a;
    if (!action)
        throw ProtocolError{QStringLiteral("unknown action: ") + name};
    if (remove ? !target->actions().contains(action) : target->actions().contains(action))
        throw ProtocolError{remove ? QStringLiteral("the action is not there") : QStringLiteral("the action is already there")};
    QAction *after = nullptr; // what follows it, to put it back in place on undo of a removal
    if (remove) {
        const QList<QAction *> list = target->actions();
        const int at = list.indexOf(action);
        after = at + 1 < list.size() ? list.at(at + 1) : nullptr;
    }
    fw->commandHistory()->push(new UseActionCommand(target, action, remove ? after : before, !remove));
    return snapshot(fw);
}

} // namespace qdr
