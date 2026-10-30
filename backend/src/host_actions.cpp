#include "host.h"

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

namespace {

/// An undoable change expressed as a pair of functions: the engine has no command for action groups.
class ActionGroupCommand : public QUndoCommand
{
public:
    ActionGroupCommand(const QString &text, std::function<void()> redo, std::function<void()> undo)
        : QUndoCommand(text), m_redo(std::move(redo)), m_undo(std::move(undo)) {}
    void redo() override { m_redo(); }
    void undo() override { m_undo(); }

private:
    std::function<void()> m_redo, m_undo;
};

QActionGroup *groupNamed(QDesignerFormWindowInterface *fw, const QString &name)
{
    for (QActionGroup *g : fw->mainContainer()->findChildren<QActionGroup *>(name))
        if (g->objectName() == name)
            return g;
    return nullptr;
}

QAction *plainAction(QDesignerFormWindowInterface *fw, const QString &name)
{
    for (QAction *a : fw->mainContainer()->findChildren<QAction *>(name))
        if (a->objectName() == name && !a->menu() && !a->isSeparator())
            return a;
    return nullptr;
}

} // namespace

/// The action groups of the form with the actions they hold.
QJsonArray Host::actionGroupsOf(QDesignerFormWindowInterface *fw) const
{
    QJsonArray out;
    for (QActionGroup *g : fw->mainContainer()->findChildren<QActionGroup *>()) {
        QJsonArray members;
        for (QAction *a : g->actions())
            members.append(a->objectName());
        out.append(QJsonObject{{QLatin1String("name"), g->objectName()}, {QLatin1String("exclusive"), g->isExclusive()}, {QLatin1String("actions"), members}});
    }
    return out;
}

/// Creates (`name`), removes (`name` + `remove`) an action group, or puts an action in one (`action` + `group`,
/// an empty group takes it out). Each is one undo step.
QJsonObject Host::actionGroup(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *owner = fw->mainContainer();
    QDesignerMetaDataBaseInterface *db = m_core->metaDataBase();
    if (p.contains(QLatin1String("action"))) {
        QAction *a = plainAction(fw, p.value(QLatin1String("action")).toString());
        if (!a)
            throw ProtocolError{QStringLiteral("unknown action")};
        const QString groupName = p.value(QLatin1String("group")).toString();
        QActionGroup *group = groupName.isEmpty() ? nullptr : groupNamed(fw, groupName);
        if (!groupName.isEmpty() && !group)
            throw ProtocolError{QStringLiteral("unknown action group: ") + groupName};
        QPointer<QAction> action = a;
        QPointer<QActionGroup> before = a->actionGroup(), after = group;
        if (before == after)
            throw ProtocolError{QStringLiteral("nothing to change")};
        fw->commandHistory()->push(new ActionGroupCommand(QStringLiteral("Change action group"),
            [action, after] { if (action) action->setActionGroup(after); },
            [action, before] { if (action) action->setActionGroup(before); }));
        return snapshot(fw);
    }
    const QString name = p.value(QLatin1String("name")).toString().trimmed();
    static const QRegularExpression ident(QStringLiteral("^[A-Za-z_][A-Za-z0-9_]*$"));
    if (!ident.match(name).hasMatch())
        throw ProtocolError{QStringLiteral("not a valid object name: ") + name};
    if (p.value(QLatin1String("remove")).toBool()) {
        QActionGroup *g = groupNamed(fw, name);
        if (!g)
            throw ProtocolError{QStringLiteral("unknown action group: ") + name};
        QPointer<QActionGroup> group = g;
        auto members = std::make_shared<QList<QPointer<QAction>>>();
        for (QAction *a : g->actions())
            members->append(a);
        fw->commandHistory()->push(new ActionGroupCommand(QStringLiteral("Remove action group %1").arg(name),
            [group, members, db, owner] {
                if (!group) return;
                for (const auto &a : *members) if (a) a->setActionGroup(nullptr);
                db->remove(group);
                group->setParent(nullptr);
            },
            [group, members, db, owner] {
                if (!group) return;
                group->setParent(owner);
                db->add(group);
                for (const auto &a : *members) if (a) a->setActionGroup(group);
            }));
        return snapshot(fw);
    }
    if (groupNamed(fw, name) || plainAction(fw, name) || owner->findChild<QObject *>(name))
        throw ProtocolError{QStringLiteral("the name is already used: ") + name};
    auto *group = new QActionGroup(nullptr);
    group->setObjectName(name);
    group->setParent(owner);
    db->add(group);
    group->setParent(nullptr);
    QPointer<QActionGroup> guard = group;
    auto owned = std::make_shared<std::unique_ptr<QActionGroup>>(group);
    fw->commandHistory()->push(new ActionGroupCommand(QStringLiteral("Add action group %1").arg(name),
        [guard, owned, owner, db] {
            if (!guard) return;
            guard->setParent(owner);
            db->add(guard);
            owned->release();
        },
        [guard, owned, db] {
            if (!guard) return;
            for (QAction *a : guard->actions()) a->setActionGroup(nullptr);
            db->remove(guard);
            guard->setParent(nullptr);
            owned->reset(guard);
        }));
    return snapshot(fw);
}

/// The menus and tool bars an action can be placed in.
QJsonArray Host::actionTargets(QDesignerFormWindowInterface *fw) const
{
    QJsonArray out;
    for (QWidget *w : fw->mainContainer()->findChildren<QWidget *>()) {
        const bool menu = qobject_cast<QMenu *>(w) != nullptr;
        if ((!menu && !qobject_cast<QToolBar *>(w)) || w->objectName().isEmpty())
            continue;
        QJsonArray entries;
        for (QAction *a : w->actions())
            if (!isPlaceholder(a))
                entries.append(QJsonObject{{QLatin1String("name"), a->menu() ? a->menu()->objectName() : a->objectName()},
                                           {QLatin1String("text"), a->isSeparator() ? QString() : (a->menu() ? a->menu()->title() : a->text())},
                                           {QLatin1String("separator"), a->isSeparator()}});
        out.append(QJsonObject{{QLatin1String("name"), w->objectName()}, {QLatin1String("kind"), menu ? QLatin1String("menu") : QLatin1String("toolbar")},
                               {QLatin1String("title"), menu ? static_cast<QMenu *>(w)->title() : w->windowTitle()},
                               {QLatin1String("entries"), entries}});
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


namespace {

/// Puts the entries of a menu or tool bar in another order: the engine's insertion command is not exported.
class ReorderCommand : public QUndoCommand
{
public:
    ReorderCommand(QWidget *target, const QList<QAction *> &before, const QList<QAction *> &after)
        : QUndoCommand(QStringLiteral("Move entry")), m_target(target)
    {
        for (QAction *a : before) m_old.append(a);
        for (QAction *a : after) m_new.append(a);
    }
    void redo() override { apply(m_new); }
    void undo() override { apply(m_old); }

private:
    void apply(const QList<QPointer<QAction>> &order)
    {
        if (!m_target)
            return;
        for (QAction *a : m_target->actions())
            m_target->removeAction(a);
        for (const auto &a : order)
            if (a)
                m_target->addAction(a);
        m_target->update();
    }
    QPointer<QWidget> m_target;
    QList<QPointer<QAction>> m_old, m_new;
};

} // namespace

/// Moves one entry of a menu or tool bar (`from`, an index among its entries) to another position (`to`).
QJsonObject Host::moveEntry(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QString targetName = p.value(QLatin1String("target")).toString();
    QWidget *target = nullptr;
    for (QWidget *w : fw->mainContainer()->findChildren<QWidget *>(targetName))
        if (w->objectName() == targetName && (qobject_cast<QMenu *>(w) || qobject_cast<QToolBar *>(w)))
            target = w;
    if (!target)
        throw ProtocolError{QStringLiteral("unknown menu or tool bar: ") + targetName};
    const QList<QAction *> all = target->actions();
    QList<QAction *> real, rest;
    for (QAction *a : all)
        (isPlaceholder(a) ? rest : real).append(a);
    const int from = p.value(QLatin1String("from")).toInt(-1), to = p.value(QLatin1String("to")).toInt(-1);
    if (from < 0 || from >= real.size() || to < 0 || to >= real.size())
        throw ProtocolError{QStringLiteral("no such entry")};
    if (from == to)
        throw ProtocolError{QStringLiteral("nothing to move")};
    QList<QAction *> next = real;
    next.move(from, to);
    fw->commandHistory()->push(new ReorderCommand(target, all, next + rest));
    return snapshot(fw);
}

} // namespace qdr
