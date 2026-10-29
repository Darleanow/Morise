#include "host.h"

namespace qdr {

QDesignerTaskMenuExtension *Host::taskMenuOf(QWidget *w) const
{
    return qobject_cast<QDesignerTaskMenuExtension *>(m_core->extensionManager()->extension(w, QStringLiteral("QDesignerInternalTaskMenuExtension")));
}

QJsonObject Host::taskActions(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
    if (!w)
        throw ProtocolError{QStringLiteral("unknown object")};
    QJsonArray out;
    if (auto *tm = taskMenuOf(w)) {
        const auto acts = tm->taskActions();
        for (int i = 0; i < acts.size(); ++i) {
            QAction *a = acts.at(i);
            out.append(QJsonObject{{QLatin1String("index"), i}, {QLatin1String("text"), a->text().remove(QLatin1Char('&'))},
                                   {QLatin1String("separator"), a->isSeparator()}, {QLatin1String("enabled"), a->isEnabled()},
                                   {QLatin1String("checkable"), a->isCheckable()}, {QLatin1String("checked"), a->isChecked()},
                                   {QLatin1String("hasMenu"), a->menu() != nullptr}});
        }
    }
    return {{QLatin1String("actions"), out}};
}

/// A task menu as a tree of what can be run without a dialog (the engine's "..." entries open modal boxes).
static QJsonArray taskTreeOf(const QList<QAction *> &acts)
{
    QJsonArray out;
    for (int i = 0; i < acts.size(); ++i) {
        QAction *a = acts.at(i);
        const QString text = a->text().remove(QLatin1Char('&'));
        if (a->isSeparator() || text.isEmpty() || text.endsWith(QLatin1String("...")) || text.endsWith(QChar(0x2026)))
            continue;
        QJsonObject o{{QLatin1String("index"), i}, {QLatin1String("text"), text}, {QLatin1String("enabled"), a->isEnabled()},
                      {QLatin1String("checkable"), a->isCheckable()}, {QLatin1String("checked"), a->isChecked()}};
        if (QMenu *m = a->menu()) {
            const QJsonArray kids = taskTreeOf(m->actions());
            if (kids.isEmpty())
                continue;
            o.insert(QLatin1String("children"), kids);
        }
        out.append(o);
    }
    return out;
}

QJsonArray Host::taskTree(QWidget *w) const
{
    auto *tm = taskMenuOf(w);
    return tm ? taskTreeOf(tm->taskActions()) : QJsonArray();
}

QJsonObject Host::taskAction(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
    auto *tm = w ? taskMenuOf(w) : nullptr;
    if (!tm)
        throw ProtocolError{QStringLiteral("this widget has no task menu")};
    const auto acts = tm->taskActions();
    // A path walks into sub menus: [index of the entry, index inside its menu, ...].
    if (const QJsonArray path = p.value(QLatin1String("path")).toArray(); !path.isEmpty()) {
        QAction *a = nullptr;
        QList<QAction *> level = acts;
        for (const QJsonValue &step : path) {
            const int k = step.toInt(-1);
            if (k < 0 || k >= level.size())
                throw ProtocolError{QStringLiteral("task action unavailable")};
            a = level.at(k);
            level = a->menu() ? a->menu()->actions() : QList<QAction *>();
        }
        if (!a || a->isSeparator() || !a->isEnabled() || a->menu())
            throw ProtocolError{QStringLiteral("task action unavailable")};
        m_core->formWindowManager()->setActiveFormWindow(fw);
        fw->clearSelection(false);
        fw->selectWidget(w, true);
        a->trigger();
        nameUnnamedWidgets(fw);
        return snapshot(fw);
    }
    int i = p.value(QLatin1String("index")).toInt(-1);
    // By caption, so the page does not depend on how the engine numbers a menu that changes with the form.
    if (const QString text = p.value(QLatin1String("text")).toString(); !text.isEmpty()) {
        i = -1;
        for (int k = 0; k < acts.size(); ++k)
            if (!acts.at(k)->isSeparator() && acts.at(k)->text().remove(QLatin1Char('&')) == text) {
                i = k;
                break;
            }
    }
    if (i < 0 || i >= acts.size() || acts.at(i)->isSeparator() || !acts.at(i)->isEnabled())
        throw ProtocolError{QStringLiteral("task action unavailable")};
    m_core->formWindowManager()->setActiveFormWindow(fw);
    fw->clearSelection(false);
    fw->selectWidget(w, true);
    acts.at(i)->trigger();
    return snapshot(fw);
}

QJsonObject Host::containerInfo(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
    auto *c = w ? qt_extension<QDesignerContainerExtension *>(m_core->extensionManager(), w) : nullptr;
    if (!c)
        return {{QLatin1String("pages"), QJsonArray()}, {QLatin1String("current"), -1}};
    QJsonArray pages;
    for (int i = 0; i < c->count(); ++i)
        pages.append(idOf(c->widget(i)));
    QJsonObject out{{QLatin1String("pages"), pages}, {QLatin1String("current"), c->currentIndex()}};
    // Where the tab headers are drawn, so the page can switch and rename a tab by clicking on it.
    if (auto *tabs = qobject_cast<QTabWidget *>(w)) {
        QJsonArray rects;
        for (int i = 0; i < tabs->count(); ++i) {
            const QRect r = tabs->tabBar()->tabRect(i);
            const QPoint tl = tabs->tabBar()->mapTo(fw, r.topLeft());
            rects.append(QJsonObject{{QLatin1String("x"), tl.x()}, {QLatin1String("y"), tl.y()}, {QLatin1String("w"), r.width()}, {QLatin1String("h"), r.height()}});
        }
        out.insert(QLatin1String("tabs"), rects);
    }
    return out;
}

QJsonObject Host::pageOp(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
    if (!w)
        throw ProtocolError{QStringLiteral("unknown object")};
    const QString op = p.value(QLatin1String("op")).toString();
    const char *slot = op == QLatin1String("add") ? "addPage" : op == QLatin1String("addAfter") ? "addPageAfter"
                     : op == QLatin1String("remove") ? "removeCurrentPage" : nullptr;
    if (!slot)
        throw ProtocolError{QStringLiteral("unknown page operation")};
    for (QObject *c : w->findChildren<QObject *>(QString(), Qt::FindDirectChildrenOnly)) {
        if (c->metaObject()->indexOfMethod(slot + QByteArray("()")) < 0)
            continue;
        m_core->formWindowManager()->setActiveFormWindow(fw);
        if (QMetaObject::invokeMethod(c, slot)) {
            QCoreApplication::processEvents();
            return snapshot(fw);
        }
    }
    throw ProtocolError{QStringLiteral("this widget has no pages to edit")};
}

} // namespace qdr
