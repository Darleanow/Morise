#include "host.h"

namespace qdr {

QJsonObject Host::setGeometries(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    for (const QJsonValue &it : p.value(QLatin1String("items")).toArray()) {
        const QJsonObject o = it.toObject();
        QWidget *w = widgetByName(fw, o.value(QLatin1String("name")).toString());
        const QJsonArray r = o.value(QLatin1String("rect")).toArray();
        if (!w || r.size() != 4)
            throw ProtocolError{QStringLiteral("bad geometry item")};
        fw->cursor()->setWidgetProperty(w, QStringLiteral("geometry"), QRect(r[0].toInt(), r[1].toInt(), r[2].toInt(), r[3].toInt()));
    }
    return snapshot(fw);
}

QJsonObject Host::reparent(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *parent = widgetByName(fw, p.value(QLatin1String("parent")).toString());
    if (!parent)
        throw ProtocolError{QStringLiteral("unknown parent")};
    QWidget *container = m_core->widgetFactory()->containerOfWidget(parent);
    if (!container || !m_core->widgetDataBase()->isContainer(parent))
        throw ProtocolError{QStringLiteral("the target is not a container")};
    const QPoint origin = container->mapTo(fw, QPoint(0, 0));
    fw->beginCommand(QStringLiteral("Move into %1").arg(idOf(parent)));
    try {
        for (const QJsonValue &it : p.value(QLatin1String("items")).toArray()) {
            const QJsonObject o = it.toObject();
            QWidget *w = widgetByName(fw, o.value(QLatin1String("name")).toString());
            const QJsonArray r = o.value(QLatin1String("rect")).toArray();
            if (!w || r.size() != 4 || w == fw->mainContainer())
                throw ProtocolError{QStringLiteral("bad item")};
            if (container == w || w->isAncestorOf(container))
                throw ProtocolError{QStringLiteral("a widget cannot be moved into itself")};
            if (w->parentWidget() != container) {
                auto *cmd = new qdesigner_internal::ReparentWidgetCommand(fw);
                cmd->init(w, container);
                fw->commandHistory()->push(cmd);
            }
            const QRect rect(r[0].toInt() - origin.x(), r[1].toInt() - origin.y(), r[2].toInt(), r[3].toInt());
            fw->cursor()->setWidgetProperty(w, QStringLiteral("geometry"), rect);
        }
    } catch (...) {
        fw->endCommand();
        throw;
    }
    fw->endCommand();
    return snapshot(fw);
}

void Host::aimLayoutCell(qdesigner_internal::FormWindowBase *base, QWidget *target, const QPoint &global, QWidget *skip)
{
    QWidget *container = base->findContainer(target, false);
    if (!container)
        return;
    auto *deco = qt_extension<QDesignerLayoutDecorationExtension *>(m_core->extensionManager(), container);
    if (!deco)
        return;
    const QPoint pt = container->mapFromGlobal(global);
    int best = -1, bestDist = 0;
    for (QWidget *cand : deco->widgets(qdesigner_internal::LayoutInfo::managedLayout(m_core, container))) {
        if (cand == skip)
            continue;
        const int d = (cand->geometry().center() - pt).manhattanLength();
        if (best == -1 || d < bestDist) {
            best = deco->indexOf(cand);
            bestDist = d;
        }
    }
    if (best >= 0)
        deco->adjustIndicator(pt, best);
}

QJsonObject Host::moveWidget(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
    if (!w || w == fw->mainContainer())
        throw ProtocolError{QStringLiteral("unknown widget")};
    const QPoint pos(qRound(p.value(QLatin1String("x")).toDouble()), qRound(p.value(QLatin1String("y")).toDouble()));
    QWidget *target = fw->childAt(pos);
    while (target && (target == w || w->isAncestorOf(target) || !fw->isManaged(target)))
        target = target->parentWidget();
    if (!target)
        target = fw->mainContainer();
    if (target == w || w->isAncestorOf(target))
        throw ProtocolError{QStringLiteral("a widget cannot be moved into itself")};
    auto *base = qobject_cast<qdesigner_internal::FormWindowBase *>(fw);
    if (!base)
        throw ProtocolError{QStringLiteral("form window does not support drops")};
    if (qobject_cast<QScrollArea *>(target) && static_cast<QScrollArea *>(target)->widget() && w->parentWidget() != target)
        throw ProtocolError{QStringLiteral("%1 already has content").arg(idOf(target))};
    const QPoint global = fw->mapToGlobal(pos);
    auto *decoration = new QWidget;
    decoration->setGeometry(QRect(global - QPoint(w->width() / 2, w->height() / 2), w->size()));
    MoveDropItem item(w, decoration, global);
    m_core->formWindowManager()->setActiveFormWindow(fw);
    aimLayoutCell(base, target, global, w);
    const bool ok = base->dropWidgets({&item}, target, global);
    if (!ok)
        throw ProtocolError{QStringLiteral("the engine refused the move to this position")};
    fw->clearSelection(false);
    fw->selectWidget(w, true);
    return snapshot(fw);
}

} // namespace qdr
