#include "host.h"

namespace qdr {

namespace {

/// Replaces the custom slots and signals of an object; the engine edits them with no undo, this makes it one step.
class CustomMethodsCommand : public QUndoCommand
{
public:
    CustomMethodsCommand(QDesignerFormWindowInterface *fw, QObject *o, const QStringList &slotList, const QStringList &signalList)
        : QUndoCommand(QStringLiteral("Edit signals and slots")), m_fw(fw), m_object(o), m_slots(slotList), m_signals(signalList)
    {
        if (auto *item = item0()) {
            m_oldSlots = item->fakeSlots();
            m_oldSignals = item->fakeSignals();
        }
    }
    void redo() override { apply(m_slots, m_signals); }
    void undo() override { apply(m_oldSlots, m_oldSignals); }

private:
    qdesigner_internal::MetaDataBaseItem *item0() const
    {
        auto *db = m_fw && m_object ? qobject_cast<qdesigner_internal::MetaDataBase *>(m_fw->core()->metaDataBase()) : nullptr;
        return db ? db->metaDataBaseItem(m_object) : nullptr;
    }
    void apply(const QStringList &s, const QStringList &g)
    {
        if (auto *item = item0()) {
            item->setFakeSlots(s);
            item->setFakeSignals(g);
        }
    }
    QPointer<QDesignerFormWindowInterface> m_fw;
    QPointer<QObject> m_object;
    QStringList m_slots, m_signals, m_oldSlots, m_oldSignals;
};

QWidget *methodsOwner(Host *, QDesignerFormWindowInterface *fw, const QJsonObject &p, QWidget *(Host::*find)(QDesignerFormWindowInterface *, const QString &) const, Host *h)
{
    const QString name = p.value(QLatin1String("name")).toString();
    return name.isEmpty() ? fw->mainContainer() : (h->*find)(fw, name);
}

} // namespace

QJsonObject Host::customMethods(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *w = methodsOwner(this, fw, p, &Host::widgetByName, this);
    auto *db = qobject_cast<qdesigner_internal::MetaDataBase *>(m_core->metaDataBase());
    auto *item = w && db ? db->metaDataBaseItem(w) : nullptr;
    if (!item)
        throw ProtocolError{QStringLiteral("unknown object")};
    return {{QLatin1String("name"), idOf(w)}, {QLatin1String("slots"), stringsToJson(item->fakeSlots())}, {QLatin1String("signals"), stringsToJson(item->fakeSignals())}};
}

/// Sets an object's custom slots and signals (`slots`, `signals`: signatures like "save(bool)"), as Designer's dialog does.
QJsonObject Host::setCustomMethods(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QWidget *w = methodsOwner(this, fw, p, &Host::widgetByName, this);
    if (!w)
        throw ProtocolError{QStringLiteral("unknown object")};
    static const QRegularExpression signature(QStringLiteral("^[\\w+_]+\\(([\\w+:]\\*?,?)*\\)$"));
    auto clean = [&](const QString &key) {
        QStringList out;
        for (const QJsonValue &v : p.value(key).toArray()) {
            const QString s = v.toString().trimmed().remove(QLatin1Char(' '));
            if (!signature.match(s).hasMatch())
                throw ProtocolError{QStringLiteral("not a valid signature: ") + s};
            if (out.contains(s))
                throw ProtocolError{QStringLiteral("duplicate: ") + s};
            out << s;
        }
        return out;
    };
    const QStringList slotList = clean(QStringLiteral("slots")), signalList = clean(QStringLiteral("signals"));
    fw->commandHistory()->push(new CustomMethodsCommand(fw, w, slotList, signalList));
    return snapshot(fw);
}

} // namespace qdr
