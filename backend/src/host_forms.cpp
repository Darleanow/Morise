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
            {QLatin1String("resourceFiles"), stringsToJson(fw->resourceFiles())}};
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
