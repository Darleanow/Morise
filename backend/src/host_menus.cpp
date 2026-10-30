#include "host.h"

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

bool isPlaceholder(const QAction *a)
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
