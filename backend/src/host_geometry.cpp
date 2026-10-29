#include "host.h"

namespace qdr {

QJsonObject Host::setGeometries(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    for (const QJsonValue &it : p.value(QLatin1String("items")).toArray()) {
        const QJsonObject o = it.toObject();
        QWidget *w = widgetByName(fw, o.value(QLatin1String("name")).toString());
        const QJsonArray r = o.value(QLatin1String("rect")).toArray();
        if (!w || r.size() != 4 || isWindowPart(fw, w))
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
            if (!w || r.size() != 4 || w == fw->mainContainer() || isWindowPart(fw, w))
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

void Host::aimLayoutCell(qdesigner_internal::FormWindowBase *base, QWidget *target, const QPoint &global, QWidget *skip, const QString &side)
{
    QWidget *container = base->findContainer(target, false);
    if (!container)
        return;
    auto *deco = qt_extension<QDesignerLayoutDecorationExtension *>(m_core->extensionManager(), container);
    if (!deco)
        return;
    QPoint pt = container->mapFromGlobal(global);
    QLayout *layout = qdesigner_internal::LayoutInfo::managedLayout(m_core, container);
    QWidget *nearest = nullptr;
    int bestDist = 0;
    for (QWidget *cand : deco->widgets(layout)) {
        if (cand == skip)
            continue;
        const int d = (cand->geometry().center() - pt).manhattanLength();
        if (!nearest || d < bestDist) {
            nearest = cand;
            bestDist = d;
        }
    }
    if (!nearest)
        return;
    // The engine decides before/after from where the point falls in the item's cell, and the last cell stretches to
    // the layout's edge. When the page says which side it means, aim at that side of the item itself.
    const auto type = qdesigner_internal::LayoutInfo::layoutType(m_core, layout);
    const bool before = side == QLatin1String("before");
    if (before || side == QLatin1String("after")) {
        // A point far beyond the item's edge on that side: the engine compares it with the cell's edges, and the
        // last cell stretches to the layout's border, so a point just inside the widget would read as "before".
        const QRect g = nearest->geometry();
        constexpr int far = 100000;
        if (type == qdesigner_internal::LayoutInfo::VBox)
            pt = QPoint(g.center().x(), before ? -far : far);
        else if (type == qdesigner_internal::LayoutInfo::HBox)
            pt = QPoint(before ? -far : far, g.center().y());
    }
    deco->adjustIndicator(pt, deco->indexOf(nearest));
}

QJsonObject Host::moveWidget(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
    if (!w || w == fw->mainContainer())
        throw ProtocolError{QStringLiteral("unknown widget")};
    if (isWindowPart(fw, w))
        throw ProtocolError{QStringLiteral("a part of the main window cannot be moved")};
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
    // Where the widget lands relative to the pointer: where the user grabbed it, else its centre.
    const QPoint grab(p.contains(QLatin1String("grabX")) ? p.value(QLatin1String("grabX")).toInt() : w->width() / 2,
                      p.contains(QLatin1String("grabY")) ? p.value(QLatin1String("grabY")).toInt() : w->height() / 2);
    decoration->setGeometry(QRect(global - grab, w->size()));
    MoveDropItem item(w, decoration, global);
    m_core->formWindowManager()->setActiveFormWindow(fw);
    aimLayoutCell(base, target, global, w, p.value(QLatin1String("side")).toString());
    const bool ok = base->dropWidgets({&item}, target, global);
    if (!ok)
        throw ProtocolError{QStringLiteral("the engine refused the move to this position")};
    fw->clearSelection(false);
    fw->selectWidget(w, true);
    return snapshot(fw);
}

} // namespace qdr
