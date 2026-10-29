#include "host.h"

namespace qdr {

QJsonArray Host::textsOf(const QTreeWidgetItem *it, int columns)
{
    QJsonArray a;
    for (int c = 0; c < columns; ++c)
        a.append(it->text(c));
    return a;
}

QJsonArray Host::treeItems(const QTreeWidget *t, const QTreeWidgetItem *parent)
{
    QJsonArray out;
    const int n = parent ? parent->childCount() : t->topLevelItemCount();
    for (int i = 0; i < n; ++i) {
        const QTreeWidgetItem *it = parent ? parent->child(i) : t->topLevelItem(i);
        out.append(QJsonObject{{QLatin1String("cells"), textsOf(it, t->columnCount())}, {QLatin1String("children"), treeItems(t, it)}});
    }
    return out;
}

QJsonValue Host::gridContents(QObject *o)
{
    if (auto *t = qobject_cast<QTreeWidget *>(o)) {
        QJsonArray cols;
        for (int c = 0; c < t->columnCount(); ++c)
            cols.append(t->headerItem() ? t->headerItem()->text(c) : QString());
        return QJsonObject{{QLatin1String("kind"), QLatin1String("tree")}, {QLatin1String("columns"), cols}, {QLatin1String("items"), treeItems(t, nullptr)}};
    }
    if (auto *t = qobject_cast<QTableWidget *>(o)) {
        QJsonArray cols, rows, cells;
        for (int c = 0; c < t->columnCount(); ++c)
            cols.append(t->horizontalHeaderItem(c) ? t->horizontalHeaderItem(c)->text() : QString());
        for (int r = 0; r < t->rowCount(); ++r) {
            rows.append(t->verticalHeaderItem(r) ? t->verticalHeaderItem(r)->text() : QString());
            QJsonArray line;
            for (int c = 0; c < t->columnCount(); ++c)
                line.append(t->item(r, c) ? t->item(r, c)->text() : QString());
            cells.append(line);
        }
        return QJsonObject{{QLatin1String("kind"), QLatin1String("table")}, {QLatin1String("columns"), cols}, {QLatin1String("rows"), rows}, {QLatin1String("cells"), cells}};
    }
    return QJsonValue(QJsonValue::Null);
}

qdesigner_internal::ItemData Host::itemWith(const QString &text, const qdesigner_internal::ItemData *old)
{
    qdesigner_internal::ItemData d;
    if (old)
        d = *old;
    if (text.isEmpty() && !old)
        return d; // nothing to store
    d.m_properties.insert(Qt::DisplayPropertyRole, QVariant::fromValue(qdesigner_internal::PropertySheetStringValue(text)));
    return d;
}

qdesigner_internal::ListContents Host::headerWith(const QJsonArray &texts, const qdesigner_internal::ListContents &old)
{
    qdesigner_internal::ListContents out;
    for (int i = 0; i < texts.size(); ++i)
        out.m_items.append(itemWith(texts.at(i).toString(), i < old.m_items.size() && old.m_items.at(i).isValid() ? &old.m_items.at(i) : nullptr));
    return out;
}

qdesigner_internal::TreeWidgetContents::ItemContents Host::treeItemFrom(const QJsonObject &o, int columns, const qdesigner_internal::TreeWidgetContents::ItemContents *old)
{
    qdesigner_internal::TreeWidgetContents::ItemContents out;
    if (old)
        out.m_itemFlags = old->m_itemFlags;
    const QJsonArray cells = o.value(QLatin1String("cells")).toArray();
    for (int c = 0; c < columns; ++c) {
        const bool hasOld = old && c < old->m_items.size() && old->m_items.at(c).isValid();
        out.m_items.append(itemWith(c < cells.size() ? cells.at(c).toString() : QString(), hasOld ? &old->m_items.at(c) : nullptr));
    }
    const QJsonArray kids = o.value(QLatin1String("children")).toArray();
    for (int i = 0; i < kids.size(); ++i)
        out.m_children.append(treeItemFrom(kids.at(i).toObject(), columns, old && i < old->m_children.size() ? &old->m_children.at(i) : nullptr));
    return out;
}

QJsonObject Host::setContents(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QObject *o = requireObject(fw, p.value(QLatin1String("name")).toString());
    const QJsonObject c = p.value(QLatin1String("contents")).toObject();
    const QJsonArray cols = c.value(QLatin1String("columns")).toArray();
    if (cols.size() > 200)
        throw ProtocolError{QStringLiteral("too many columns")};
    if (auto *t = qobject_cast<QTreeWidget *>(o)) {
        if (cols.isEmpty())
            throw ProtocolError{QStringLiteral("a tree needs at least one column")};
        qdesigner_internal::TreeWidgetContents oldC, newC;
        oldC.fromTreeWidget(t, false);
        newC.m_headerItem = headerWith(cols, oldC.m_headerItem);
        const QJsonArray items = c.value(QLatin1String("items")).toArray();
        for (int i = 0; i < items.size(); ++i)
            newC.m_rootItems.append(treeItemFrom(items.at(i).toObject(), cols.size(), i < oldC.m_rootItems.size() ? &oldC.m_rootItems.at(i) : nullptr));
        if (newC == oldC)
            return snapshot(fw);
        auto *cmd = new qdesigner_internal::ChangeTreeContentsCommand(fw);
        cmd->setText(QStringLiteral("Edit items of %1").arg(idOf(o)));
        cmd->init(t, oldC, newC);
        fw->commandHistory()->push(cmd);
        return snapshot(fw);
    }
    if (auto *t = qobject_cast<QTableWidget *>(o)) {
        const QJsonArray rows = c.value(QLatin1String("rows")).toArray();
        const QJsonArray cells = c.value(QLatin1String("cells")).toArray();
        if (rows.size() > 5000 || rows.size() * cols.size() > 100000)
            throw ProtocolError{QStringLiteral("the table is too large")};
        qdesigner_internal::TableWidgetContents oldC, newC;
        oldC.fromTableWidget(t, false);
        newC.m_columnCount = cols.size();
        newC.m_rowCount = rows.size();
        newC.m_horizontalHeader = headerWith(cols, oldC.m_horizontalHeader);
        newC.m_verticalHeader = headerWith(rows, oldC.m_verticalHeader);
        for (int r = 0; r < rows.size(); ++r) {
            const QJsonArray line = r < cells.size() ? cells.at(r).toArray() : QJsonArray();
            for (int col = 0; col < cols.size(); ++col) {
                const QString text = col < line.size() ? line.at(col).toString() : QString();
                const auto it = oldC.m_items.constFind({r, col});
                const qdesigner_internal::ItemData d = itemWith(text, it != oldC.m_items.cend() ? &it.value() : nullptr);
                if (d.isValid())
                    newC.m_items.insert({r, col}, d);
            }
        }
        if (newC == oldC)
            return snapshot(fw);
        auto *cmd = new qdesigner_internal::ChangeTableContentsCommand(fw);
        cmd->setText(QStringLiteral("Edit cells of %1").arg(idOf(o)));
        cmd->init(t, oldC, newC);
        fw->commandHistory()->push(cmd);
        return snapshot(fw);
    }
    throw ProtocolError{QStringLiteral("this widget has no editable contents")};
}

QObjectList Host::targets(QDesignerFormWindowInterface *fw, const QJsonObject &p) const
{
    QObjectList out;
    const QJsonArray names = p.value(QLatin1String("names")).toArray();
    if (!names.isEmpty()) {
        for (const QJsonValue &n : names)
            out << requireObject(fw, n.toString());
    } else {
        out << requireObject(fw, p.value(QLatin1String("name")).toString());
    }
    return out;
}

QJsonObject Host::setProperty(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QObjectList objs = targets(fw, p);
    const QString prop = p.value(QLatin1String("property")).toString();
    auto *sheet = sheetOf(objs.first());
    const int idx = sheet->indexOf(prop);
    if (idx < 0)
        throw ProtocolError{QStringLiteral("unknown property: ") + prop};
    const QVariant next = parseValue(sheet->property(idx), p.value(QLatin1String("value")));

    QWidget *single = objs.size() == 1 ? qobject_cast<QWidget *>(objs.first()) : nullptr;
    if (single) {
        fw->cursor()->setWidgetProperty(single, prop, next);
    } else {
        auto *cmd = new qdesigner_internal::SetPropertyCommand(fw);
        if (!cmd->init(objs, prop, next)) {
            delete cmd;
            throw ProtocolError{QStringLiteral("the property cannot be set on this selection")};
        }
        fw->commandHistory()->push(cmd);
    }
    return snapshot(fw);
}

QJsonObject Host::resetProperty(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QObject *o = requireObject(fw, p.value(QLatin1String("name")).toString());
    const QString prop = p.value(QLatin1String("property")).toString();
    if (QWidget *w = qobject_cast<QWidget *>(o)) {
        fw->cursor()->resetWidgetProperty(w, prop);
    } else {
        auto *cmd = new qdesigner_internal::ResetPropertyCommand(fw);
        if (!cmd->init(o, prop)) {
            delete cmd;
            throw ProtocolError{QStringLiteral("cannot reset this property")};
        }
        fw->commandHistory()->push(cmd);
    }
    return snapshot(fw);
}

} // namespace qdr
