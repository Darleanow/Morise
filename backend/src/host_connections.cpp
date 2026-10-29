#include "host.h"

namespace qdr {

qdesigner_internal::ConnectionEdit *Host::signalSlotEditor(QDesignerFormWindowInterface *fw, int *toolIndex) const
{
    for (int i = 0; i < fw->toolCount(); ++i) {
        QWidget *e = fw->tool(i)->editor();
        auto *edit = qobject_cast<qdesigner_internal::ConnectionEdit *>(e);
        if (edit && QLatin1String(edit->metaObject()->className()).contains(QLatin1String("SignalSlot"))) {
            if (toolIndex)
                *toolIndex = i;
            return edit;
        }
    }
    throw ProtocolError{QStringLiteral("the signal/slot editor is not available")};
}

bool Host::hasStaleConnection(QDesignerFormWindowInterface *fw, qdesigner_internal::ConnectionEdit *edit)
{
    if (edit->connectionCount() == 0)
        return false;
    const auto all = fw->mainContainer()->findChildren<QObject *>();
    for (int i = 0; i < edit->connectionCount(); ++i) {
        for (auto t : {qdesigner_internal::CETypes::EndPoint::Source, qdesigner_internal::CETypes::EndPoint::Target}) {
            QObject *o = edit->connection(i)->object(t);
            if (o != fw->mainContainer() && !all.contains(o))
                return true;
        }
    }
    return false;
}

void Host::refuseStaleConnections(QDesignerFormWindowInterface *fw, qdesigner_internal::ConnectionEdit *edit)
{
    if (hasStaleConnection(fw, edit))
        throw ProtocolError{QStringLiteral("a connection refers to a widget that no longer exists; undo to the state before it or reopen the form")};
}

void Host::sendMouse(QWidget *w, QEvent::Type type, const QPoint &local, Qt::MouseButton button, Qt::MouseButtons buttons)
{
    QMouseEvent ev(type, QPointF(local), QPointF(w->mapToGlobal(local)), QPointF(w->mapToGlobal(local)), button, buttons, Qt::NoModifier);
    QCoreApplication::sendEvent(w, &ev);
}

QJsonObject Host::connectWidgets(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *a = widgetByName(fw, p.value(QLatin1String("sender")).toString());
    QWidget *b = widgetByName(fw, p.value(QLatin1String("receiver")).toString());
    if (!a || !b)
        throw ProtocolError{QStringLiteral("unknown sender or receiver")};
    int toolIndex = 0;
    auto *edit = signalSlotEditor(fw, &toolIndex);
    const int previousTool = fw->currentTool();
    refuseStaleConnections(fw, edit);
    ConnectPlan plan{p.value(QLatin1String("signal")).toString(), p.value(QLatin1String("slot")).toString()};
    m_core->formWindowManager()->setActiveFormWindow(fw);
    fw->setCurrentTool(toolIndex);
    QCoreApplication::processEvents();
    const int before = edit->connectionCount();
    // Existing connections anchor at the widget centre: grabbing there would drag that anchor instead of
    // starting a new connection, so pick a spot in the widget that no anchor occupies.
    QList<QPoint> anchors;
    for (int i = 0; i < edit->connectionCount(); ++i) {
        anchors << edit->connection(i)->endPointPos(qdesigner_internal::CETypes::EndPoint::Source)
                << edit->connection(i)->endPointPos(qdesigner_internal::CETypes::EndPoint::Target);
    }
    auto pointOf = [&](QWidget *w) {
        const QRect r = w->rect().adjusted(3, 3, -3, -3);
        QList<QPoint> candidates{r.center()};
        for (int ring = 1; ring <= 6; ++ring) {
            for (int dx : {-1, 0, 1}) {
                for (int dy : {-1, 0, 1}) {
                    if (dx || dy)
                        candidates << QPoint(r.center().x() + dx * ring * 12, r.center().y() + dy * ring * 6);
                }
            }
        }
        for (const QPoint &c : std::as_const(candidates)) {
            if (!r.contains(c))
                continue;
            const QPoint g = edit->mapFromGlobal(w->mapToGlobal(c));
            const bool taken = std::any_of(anchors.cbegin(), anchors.cend(), [&](const QPoint &a2) { return (a2 - g).manhattanLength() < 16; });
            if (!taken)
                return g;
        }
        return edit->mapFromGlobal(w->mapToGlobal(r.center()));
    };
    const QPoint pa = pointOf(a), pb = pointOf(b);
    g_connectPlan = &plan;
    sendMouse(edit, QEvent::MouseMove, pa, Qt::NoButton, Qt::NoButton);
    sendMouse(edit, QEvent::MouseButtonPress, pa, Qt::LeftButton, Qt::LeftButton);
    sendMouse(edit, QEvent::MouseMove, pa + QPoint(3, 3), Qt::NoButton, Qt::LeftButton);
    sendMouse(edit, QEvent::MouseMove, pb, Qt::NoButton, Qt::LeftButton);
    sendMouse(edit, QEvent::MouseButtonRelease, pb, Qt::LeftButton, Qt::NoButton); // opens the dialog (nested loop)
    g_connectPlan = nullptr;
    fw->setCurrentTool(previousTool);
    QCoreApplication::processEvents();
    if (plan.failed)
        throw ProtocolError{QStringLiteral("%1 cannot connect %2 to %3").arg(idOf(a), plan.signal, plan.slot)};
    if (!plan.done || edit->connectionCount() != before + 1)
        throw ProtocolError{QStringLiteral("the connection could not be created")};
    // Another widget stacked over the chosen spot may have caught the drag: never keep a connection between
    // different widgets than the ones asked for.
    {
        auto *created = edit->connection(edit->connectionCount() - 1);
        if (created->object(qdesigner_internal::CETypes::EndPoint::Source) != a
            || created->object(qdesigner_internal::CETypes::EndPoint::Target) != b) {
            fw->commandHistory()->undo();
            throw ProtocolError{QStringLiteral("the connection landed on other widgets (covered by a sibling); nothing was changed")};
        }
    }
    return snapshot(fw);
}

QJsonObject Host::disconnectWidgets(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    auto *edit = signalSlotEditor(fw);
    const QString sender = p.value(QLatin1String("sender")).toString(), receiver = p.value(QLatin1String("receiver")).toString();
    const QString signal = p.value(QLatin1String("signal")).toString(), slot = p.value(QLatin1String("slot")).toString();
    for (int i = 0; i < edit->connectionCount(); ++i) {
        auto *con = edit->connection(i);
        if (idOf(con->object(qdesigner_internal::CETypes::EndPoint::Source)) == sender
            && idOf(con->object(qdesigner_internal::CETypes::EndPoint::Target)) == receiver
            && con->label(qdesigner_internal::CETypes::EndPoint::Source) == signal
            && con->label(qdesigner_internal::CETypes::EndPoint::Target) == slot) {
            edit->selectNone();
            edit->setSelected(con, true);
            edit->deleteSelected();
            return snapshot(fw);
        }
    }
    throw ProtocolError{QStringLiteral("no such connection")};
}

QJsonObject Host::history(const QJsonObject &p)
{
    QUndoStack *stack = form(p)->commandHistory();
    QJsonArray items;
    for (int i = 0; i < stack->count(); ++i)
        items.append(stack->text(i));
    return {{QLatin1String("items"), items}, {QLatin1String("index"), stack->index()}};
}

QJsonObject Host::setCurrentPage(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
    auto *c = w ? qt_extension<QDesignerContainerExtension *>(m_core->extensionManager(), w) : nullptr;
    const int i = p.value(QLatin1String("index")).toInt(-1);
    if (!c || i < 0 || i >= c->count())
        throw ProtocolError{QStringLiteral("bad page")};
    c->setCurrentIndex(i);
    return snapshot(fw);
}

} // namespace qdr
