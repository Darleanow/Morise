#include "host.h"

namespace qdr {

QStringList Host::jsonToStrings(const QJsonValue &v)
{
    QStringList out;
    for (const QJsonValue &x : v.toArray())
        out << x.toString();
    return out;
}

QStringList Host::enumKeys(const QMetaEnum &me)
{
    QStringList out;
    for (int i = 0; i < me.keyCount(); ++i)
        out << QString::fromLatin1(me.key(i));
    return out;
}

QString Host::thumbnailFor(QDesignerFormWindowInterface *fw, const QString &path) const
{
    if (path.isEmpty())
        return {};
    const QString abs = path.startsWith(QLatin1Char(':')) || QFileInfo(path).isAbsolute() ? path : fw->absoluteDir().absoluteFilePath(path);
    QPixmap px(abs);
    if (px.isNull())
        return {};
    return iconDataUrl(QIcon(px.scaled(48, 48, Qt::KeepAspectRatio, Qt::SmoothTransformation)), 48);
}

const std::vector<Host::PaletteRole> &Host::paletteRoles()
{
    static const std::vector<PaletteRole> roles{
        {"Window", QPalette::Window}, {"WindowText", QPalette::WindowText}, {"Base", QPalette::Base}, {"AlternateBase", QPalette::AlternateBase},
        {"ToolTipBase", QPalette::ToolTipBase}, {"ToolTipText", QPalette::ToolTipText}, {"PlaceholderText", QPalette::PlaceholderText},
        {"Text", QPalette::Text}, {"Button", QPalette::Button}, {"ButtonText", QPalette::ButtonText}, {"BrightText", QPalette::BrightText},
        {"Light", QPalette::Light}, {"Midlight", QPalette::Midlight}, {"Dark", QPalette::Dark}, {"Mid", QPalette::Mid}, {"Shadow", QPalette::Shadow},
        {"Highlight", QPalette::Highlight}, {"HighlightedText", QPalette::HighlightedText}, {"Link", QPalette::Link}, {"LinkVisited", QPalette::LinkVisited}};
    return roles;
}

const std::vector<Host::PaletteGroup> &Host::paletteGroups()
{
    static const std::vector<PaletteGroup> groups{{"Active", QPalette::Active}, {"Inactive", QPalette::Inactive}, {"Disabled", QPalette::Disabled}};
    return groups;
}

QJsonObject Host::describeValue(const QVariant &v, QDesignerFormWindowInterface *fw) const
{
    auto make = [](const char *kind, const QJsonValue &value) {
        return QJsonObject{{QLatin1String("kind"), QLatin1String(kind)}, {QLatin1String("value"), value}};
    };
    if (v.canConvert<PropertySheetStringValue>())
        return make("string", v.value<PropertySheetStringValue>().value());
    if (v.canConvert<PropertySheetStringListValue>())
        return make("stringlist", stringsToJson(v.value<PropertySheetStringListValue>().value()));
    if (v.canConvert<PropertySheetKeySequenceValue>())
        return make("keysequence", v.value<PropertySheetKeySequenceValue>().value().toString(QKeySequence::PortableText));
    if (v.canConvert<PropertySheetEnumValue>()) {
        const auto e = v.value<PropertySheetEnumValue>();
        QJsonObject o = make("enum", e.metaEnum.valueToKey(e.value));
        o.insert(QLatin1String("choices"), stringsToJson(e.metaEnum.keys()));
        return o;
    }
    if (v.canConvert<PropertySheetFlagValue>()) {
        const auto f = v.value<PropertySheetFlagValue>();
        QJsonObject o = make("flags", stringsToJson(f.metaFlags.flags(f.value)));
        o.insert(QLatin1String("choices"), stringsToJson(f.metaFlags.keys()));
        return o;
    }
    if (v.canConvert<PropertySheetIconValue>() ) {
        const auto icon = v.value<PropertySheetIconValue>();
        const QString path = icon.pixmap(QIcon::Normal, QIcon::Off).path();
        QJsonObject o = make("icon", path);
        o.insert(QLatin1String("thumb"), thumbnailFor(fw, path));
        return o;
    }
    if (v.canConvert<PropertySheetPixmapValue>()) {
        const QString path = v.value<PropertySheetPixmapValue>().path();
        QJsonObject o = make("pixmap", path);
        o.insert(QLatin1String("thumb"), thumbnailFor(fw, path));
        return o;
    }
    switch (v.metaType().id()) {
    case QMetaType::QString: return make("string", v.toString());
    case QMetaType::QByteArray: return make("string", QString::fromUtf8(v.toByteArray()));
    case QMetaType::QStringList: return make("stringlist", stringsToJson(v.toStringList()));
    case QMetaType::Bool: return make("bool", v.toBool());
    case QMetaType::Int: case QMetaType::UInt: case QMetaType::LongLong: case QMetaType::ULongLong:
    case QMetaType::Short: case QMetaType::UShort: case QMetaType::Long: case QMetaType::ULong:
        return make("int", v.toLongLong());
    case QMetaType::Double: case QMetaType::Float: return make("double", v.toDouble());
    case QMetaType::QRect: { const QRect r = v.toRect(); return make("rect", QJsonArray{r.x(), r.y(), r.width(), r.height()}); }
    case QMetaType::QSize: { const QSize s = v.toSize(); return make("size", QJsonArray{s.width(), s.height()}); }
    case QMetaType::QPoint: { const QPoint pt = v.toPoint(); return make("point", QJsonArray{pt.x(), pt.y()}); }
    case QMetaType::QRectF: { const QRectF r = v.toRectF(); return make("rectf", QJsonArray{r.x(), r.y(), r.width(), r.height()}); }
    case QMetaType::QSizeF: { const QSizeF s = v.toSizeF(); return make("sizef", QJsonArray{s.width(), s.height()}); }
    case QMetaType::QPointF: { const QPointF pt = v.toPointF(); return make("pointf", QJsonArray{pt.x(), pt.y()}); }
    case QMetaType::QColor: return make("color", v.value<QColor>().name(QColor::HexArgb));
    case QMetaType::QUrl: return make("url", v.toUrl().toString());
    case QMetaType::QDate: return make("date", v.toDate().toString(Qt::ISODate));
    case QMetaType::QTime: return make("time", v.toTime().toString(Qt::ISODate));
    case QMetaType::QDateTime: return make("datetime", v.toDateTime().toString(Qt::ISODate));
    case QMetaType::QKeySequence: return make("keysequence", v.value<QKeySequence>().toString(QKeySequence::PortableText));
    case QMetaType::QSizePolicy: {
        const QSizePolicy sp = v.value<QSizePolicy>();
        const QMetaEnum me = QMetaEnum::fromType<QSizePolicy::Policy>();
        QJsonObject o = make("sizePolicy", QJsonObject{
            {QLatin1String("h"), QString::fromLatin1(me.valueToKey(sp.horizontalPolicy()))},
            {QLatin1String("v"), QString::fromLatin1(me.valueToKey(sp.verticalPolicy()))},
            {QLatin1String("hs"), sp.horizontalStretch()}, {QLatin1String("vs"), sp.verticalStretch()}});
        o.insert(QLatin1String("choices"), stringsToJson(enumKeys(me)));
        return o;
    }
    case QMetaType::QFont: {
        const QFont f = v.value<QFont>();
        QJsonObject o = make("font", QJsonObject{
            {QLatin1String("family"), f.family()}, {QLatin1String("pointSize"), f.pointSize()}, {QLatin1String("bold"), f.bold()},
            {QLatin1String("italic"), f.italic()}, {QLatin1String("underline"), f.underline()}, {QLatin1String("strikeOut"), f.strikeOut()}});
        return o;
    }
    case QMetaType::QCursor: {
        const QMetaEnum me = QMetaEnum::fromType<Qt::CursorShape>();
        QJsonObject o = make("enum", QString::fromLatin1(me.valueToKey(v.value<QCursor>().shape())));
        o.insert(QLatin1String("choices"), stringsToJson(enumKeys(me)));
        return o;
    }
    case QMetaType::QPalette: {
        // Colours per group and role, plus the roles this palette sets itself (the others follow the style).
        const QPalette pal = v.value<QPalette>();
        QJsonObject groups;
        QJsonArray set;
        for (const auto &g : paletteGroups()) {
            QJsonObject colors;
            for (const auto &r : paletteRoles()) {
                colors.insert(QLatin1String(r.name), pal.color(g.group, r.role).name(QColor::HexArgb));
                if (g.group == QPalette::Active && pal.isBrushSet(g.group, r.role))
                    set.append(QLatin1String(r.name));
            }
            groups.insert(QLatin1String(g.name), colors);
        }
        return make("palette", QJsonObject{{QLatin1String("groups"), groups}, {QLatin1String("set"), set}});
    }
    case QMetaType::QLocale: {
        const QLocale l = v.toLocale();
        return make("locale", QJsonObject{{QLatin1String("language"), QString::fromLatin1(QMetaEnum::fromType<QLocale::Language>().valueToKey(l.language()))},
                                           {QLatin1String("country"), QString::fromLatin1(QMetaEnum::fromType<QLocale::Country>().valueToKey(l.territory()))}});
    }
    default: break;
    }
    QJsonObject o = make("unsupported", v.toString());
    o.insert(QLatin1String("typeName"), QString::fromUtf8(v.typeName() ? v.typeName() : ""));
    return o;
}

QVariant Host::parseValue(const QVariant &current, const QJsonValue &val) const
{
    if (current.canConvert<PropertySheetStringValue>()) {
        // Keep the translatable/comment/disambiguation data the engine stores with the text.
        auto s = current.value<PropertySheetStringValue>();
        s.setValue(val.toString());
        return QVariant::fromValue(s);
    }
    if (current.canConvert<PropertySheetStringListValue>()) {
        auto s = current.value<PropertySheetStringListValue>();
        s.setValue(jsonToStrings(val));
        return QVariant::fromValue(s);
    }
    if (current.canConvert<PropertySheetKeySequenceValue>()) {
        auto s = current.value<PropertySheetKeySequenceValue>();
        s.setValue(QKeySequence::fromString(val.toString(), QKeySequence::PortableText));
        return QVariant::fromValue(s);
    }
    if (current.canConvert<PropertySheetEnumValue>()) {
        auto e = current.value<PropertySheetEnumValue>();
        bool ok = false;
        const int v = e.metaEnum.keyToValue(val.toString(), &ok);
        if (!ok)
            throw ProtocolError{QStringLiteral("invalid enum key")};
        return QVariant::fromValue(PropertySheetEnumValue(v, e.metaEnum));
    }
    if (current.canConvert<PropertySheetFlagValue>()) {
        auto f = current.value<PropertySheetFlagValue>();
        uint bits = 0;
        for (const QString &key : jsonToStrings(val)) {
            bool ok = false;
            const uint v = f.metaFlags.keyToValue(key, &ok);
            if (!ok)
                throw ProtocolError{QStringLiteral("invalid flag: ") + key};
            bits |= v;
        }
        return QVariant::fromValue(PropertySheetFlagValue(int(bits), f.metaFlags));
    }
    if (current.canConvert<PropertySheetIconValue>()) {
        const QString path = val.toString();
        return QVariant::fromValue(path.isEmpty() ? PropertySheetIconValue() : PropertySheetIconValue(PropertySheetPixmapValue(path)));
    }
    if (current.canConvert<PropertySheetPixmapValue>())
        return QVariant::fromValue(PropertySheetPixmapValue(val.toString()));
    switch (current.metaType().id()) {
    case QMetaType::QString: return val.toString();
    case QMetaType::QByteArray: return val.toString().toUtf8();
    case QMetaType::QStringList: return jsonToStrings(val);
    case QMetaType::Bool: return val.toBool();
    case QMetaType::Int: case QMetaType::UInt: case QMetaType::LongLong: case QMetaType::ULongLong:
    case QMetaType::Short: case QMetaType::UShort: case QMetaType::Long: case QMetaType::ULong: {
        QVariant n(qlonglong(val.toDouble()));
        n.convert(current.metaType());
        return n;
    }
    case QMetaType::Double: return val.toDouble();
    case QMetaType::Float: return float(val.toDouble());
    case QMetaType::QRect: { const auto a = numbers(val); return QRect(a[0].toInt(), a[1].toInt(), a[2].toInt(), a[3].toInt()); }
    case QMetaType::QSize: { const auto a = numbers(val); return QSize(a[0].toInt(), a[1].toInt()); }
    case QMetaType::QPoint: { const auto a = numbers(val); return QPoint(a[0].toInt(), a[1].toInt()); }
    case QMetaType::QRectF: { const auto a = numbers(val); return QRectF(a[0].toDouble(), a[1].toDouble(), a[2].toDouble(), a[3].toDouble()); }
    case QMetaType::QSizeF: { const auto a = numbers(val); return QSizeF(a[0].toDouble(), a[1].toDouble()); }
    case QMetaType::QPointF: { const auto a = numbers(val); return QPointF(a[0].toDouble(), a[1].toDouble()); }
    case QMetaType::QColor: {
        const QColor c(val.toString());
        if (!c.isValid())
            throw ProtocolError{QStringLiteral("invalid colour")};
        return c;
    }
    case QMetaType::QUrl: return QUrl(val.toString());
    case QMetaType::QDate: return QDate::fromString(val.toString(), Qt::ISODate);
    case QMetaType::QTime: return QTime::fromString(val.toString(), Qt::ISODate);
    case QMetaType::QDateTime: return QDateTime::fromString(val.toString(), Qt::ISODate);
    case QMetaType::QKeySequence: return QKeySequence::fromString(val.toString(), QKeySequence::PortableText);
    case QMetaType::QPalette: {
        // Only the colours the page changed: everything else stays as the widget has it.
        QPalette pal = current.value<QPalette>();
        const QJsonObject groups = val.toObject().value(QLatin1String("groups")).toObject();
        for (const auto &g : paletteGroups()) {
            const QJsonObject colors = groups.value(QLatin1String(g.name)).toObject();
            for (const auto &r : paletteRoles()) {
                if (!colors.contains(QLatin1String(r.name)))
                    continue;
                const QColor c(colors.value(QLatin1String(r.name)).toString());
                if (!c.isValid())
                    throw ProtocolError{QStringLiteral("invalid colour")};
                pal.setBrush(g.group, r.role, c);
            }
        }
        return pal;
    }
    case QMetaType::QLocale: {
        const QJsonObject o = val.toObject();
        bool ok1 = false, ok2 = false;
        const int lang = QMetaEnum::fromType<QLocale::Language>().keyToValue(o.value(QLatin1String("language")).toString().toLatin1().constData(), &ok1);
        const int country = QMetaEnum::fromType<QLocale::Country>().keyToValue(o.value(QLatin1String("country")).toString().toLatin1().constData(), &ok2);
        if (!ok1 || !ok2)
            throw ProtocolError{QStringLiteral("unknown language or country")};
        return QLocale(QLocale::Language(lang), QLocale::Country(country));
    }
    case QMetaType::QSizePolicy: {
        const QMetaEnum me = QMetaEnum::fromType<QSizePolicy::Policy>();
        const QJsonObject o = val.toObject();
        bool okH = false, okV = false;
        const int h = me.keyToValue(o.value(QLatin1String("h")).toString().toLatin1().constData(), &okH);
        const int v = me.keyToValue(o.value(QLatin1String("v")).toString().toLatin1().constData(), &okV);
        if (!okH || !okV)
            throw ProtocolError{QStringLiteral("invalid size policy")};
        QSizePolicy sp = current.value<QSizePolicy>();
        sp.setHorizontalPolicy(QSizePolicy::Policy(h));
        sp.setVerticalPolicy(QSizePolicy::Policy(v));
        sp.setHorizontalStretch(qBound(0, o.value(QLatin1String("hs")).toInt(), 255));
        sp.setVerticalStretch(qBound(0, o.value(QLatin1String("vs")).toInt(), 255));
        return sp;
    }
    case QMetaType::QFont: {
        const QJsonObject o = val.toObject();
        QFont f = current.value<QFont>();
        if (o.contains(QLatin1String("family"))) f.setFamily(o.value(QLatin1String("family")).toString());
        if (o.contains(QLatin1String("pointSize")) && o.value(QLatin1String("pointSize")).toInt() > 0) f.setPointSize(o.value(QLatin1String("pointSize")).toInt());
        if (o.contains(QLatin1String("bold"))) f.setBold(o.value(QLatin1String("bold")).toBool());
        if (o.contains(QLatin1String("italic"))) f.setItalic(o.value(QLatin1String("italic")).toBool());
        if (o.contains(QLatin1String("underline"))) f.setUnderline(o.value(QLatin1String("underline")).toBool());
        if (o.contains(QLatin1String("strikeOut"))) f.setStrikeOut(o.value(QLatin1String("strikeOut")).toBool());
        return f;
    }
    case QMetaType::QCursor: {
        const QMetaEnum me = QMetaEnum::fromType<Qt::CursorShape>();
        bool ok = false;
        const int v = me.keyToValue(val.toString().toLatin1().constData(), &ok);
        if (!ok)
            throw ProtocolError{QStringLiteral("invalid cursor")};
        return QCursor(Qt::CursorShape(v));
    }
    default:
        throw ProtocolError{QStringLiteral("property type not editable yet: ") + QString::fromUtf8(current.typeName())};
    }
}

QDesignerPropertySheetExtension *Host::sheetOf(QObject *o) const
{
    auto *sheet = qt_extension<QDesignerPropertySheetExtension *>(m_core->extensionManager(), o);
    if (!sheet)
        throw ProtocolError{QStringLiteral("no property sheet")};
    return sheet;
}

QObject *Host::requireObject(QDesignerFormWindowInterface *fw, const QString &name) const
{
    QObject *o = objectByName(fw, name);
    if (!o)
        throw ProtocolError{QStringLiteral("unknown object: ") + name};
    return o;
}

QJsonObject Host::properties(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QObject *o = requireObject(fw, p.value(QLatin1String("name")).toString());
    auto *sheet = sheetOf(o);
    QJsonArray props;
    for (int i = 0; i < sheet->count(); ++i) {
        if (!sheet->isVisible(i))
            continue;
        QJsonObject d = describeValue(sheet->property(i), fw);
        d.insert(QLatin1String("name"), sheet->propertyName(i));
        d.insert(QLatin1String("group"), sheet->propertyGroup(i));
        d.insert(QLatin1String("changed"), sheet->isChanged(i));
        d.insert(QLatin1String("enabled"), sheet->isEnabled(i));
        d.insert(QLatin1String("attribute"), sheet->isAttribute(i));
        d.insert(QLatin1String("resettable"), sheet->hasReset(i));
        d.insert(QLatin1String("dynamic"), sheet->isAttribute(i) ? false : sheet->propertyGroup(i) == QLatin1String("Dynamic Properties"));
        props.append(d);
    }
    const auto *db = m_core->widgetDataBase();
    const int dbIndex = qobject_cast<QWidget *>(o) ? db->indexOfObject(o) : -1;
    return {{QLatin1String("class"), dbIndex >= 0 ? db->item(dbIndex)->name() : QString::fromUtf8(o->metaObject()->className())},
            {QLatin1String("isLayout"), qobject_cast<QLayout *>(o) != nullptr},
            {QLatin1String("items"), itemTexts(o)},
            {QLatin1String("contents"), gridContents(o)},
            {QLatin1String("menus"), menusOf(o)},
            {QLatin1String("properties"), props}};
}

QJsonValue Host::itemTexts(QObject *o)
{
    QJsonArray out;
    if (auto *c = qobject_cast<QComboBox *>(o)) {
        for (int i = 0; i < c->count(); ++i)
            out.append(c->itemText(i));
        return out;
    }
    if (auto *l = qobject_cast<QListWidget *>(o)) {
        for (int i = 0; i < l->count(); ++i)
            out.append(l->item(i)->text());
        return out;
    }
    return QJsonValue(QJsonValue::Null);
}

QJsonObject Host::setItems(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QObject *o = requireObject(fw, p.value(QLatin1String("name")).toString());
    QStringList texts;
    for (const QJsonValue &v : p.value(QLatin1String("items")).toArray())
        texts << v.toString();
    qdesigner_internal::ListContents oldC, newC;
    auto *combo = qobject_cast<QComboBox *>(o);
    auto *list = qobject_cast<QListWidget *>(o);
    if (!combo && !list)
        throw ProtocolError{QStringLiteral("this widget has no item list")};
    if (combo)
        oldC.createFromComboBox(combo);
    else
        oldC.createFromListWidget(list, false);
    for (int i = 0; i < texts.size(); ++i) {
        const QString oldText = i >= oldC.m_items.size() ? QString()
            : combo ? combo->itemText(i) : list->item(i)->text();
        if (i < oldC.m_items.size() && oldText == texts.at(i)) {
            newC.m_items.append(oldC.m_items.at(i)); // icon, tool tip, flags... stay
            continue;
        }
        qdesigner_internal::ItemData d;
        if (i < oldC.m_items.size())
            d = oldC.m_items.at(i); // renamed: keep the other roles
        d.m_properties.insert(Qt::DisplayPropertyRole, QVariant::fromValue(qdesigner_internal::PropertySheetStringValue(texts.at(i))));
        newC.m_items.append(d);
    }
    if (newC == oldC)
        return snapshot(fw);
    auto *cmd = new qdesigner_internal::ChangeListContentsCommand(fw);
    cmd->setText(QStringLiteral("Edit items of %1").arg(idOf(o)));
    if (combo)
        cmd->init(combo, oldC, newC);
    else
        cmd->init(list, oldC, newC);
    fw->commandHistory()->push(cmd);
    return snapshot(fw);
}

} // namespace qdr
