#include "host.h"

#include <QPainter>

namespace qdr {

void Host::applyStyleTree(QWidget *w, QStyle *style, const QPalette *pal)
{
    w->setStyle(style);
    if (pal)
        w->setPalette(*pal);
    for (QObject *c : w->children())
        if (auto *cw = qobject_cast<QWidget *>(c))
            applyStyleTree(cw, style, pal);
}

QPalette Host::darkPalette()
{
    QPalette p;
    const QColor base(30, 30, 30), window(45, 45, 45), text(220, 220, 220), highlight(0, 120, 212);
    p.setColor(QPalette::Window, window); p.setColor(QPalette::WindowText, text);
    p.setColor(QPalette::Base, base); p.setColor(QPalette::AlternateBase, window);
    p.setColor(QPalette::Text, text); p.setColor(QPalette::Button, window);
    p.setColor(QPalette::ButtonText, text); p.setColor(QPalette::ToolTipBase, window);
    p.setColor(QPalette::ToolTipText, text); p.setColor(QPalette::Highlight, highlight);
    p.setColor(QPalette::HighlightedText, Qt::white); p.setColor(QPalette::PlaceholderText, QColor(140, 140, 140));
    p.setColor(QPalette::Disabled, QPalette::Text, QColor(120, 120, 120));
    p.setColor(QPalette::Disabled, QPalette::ButtonText, QColor(120, 120, 120));
    p.setColor(QPalette::Disabled, QPalette::WindowText, QColor(120, 120, 120));
    return p;
}

void Host::closePopups()
{
    while (QWidget *pop = QApplication::activePopupWidget())
        pop->close();
}

QJsonObject Host::preview(const QJsonObject &p)
{
    closePopups();
    QDesignerFormWindowInterface *fw = form(p);
    QByteArray xml = fw->contents().toUtf8();
    QBuffer buf(&xml);
    buf.open(QIODevice::ReadOnly);
    QFormBuilder builder;
    QWidget *w = builder.load(&buf, nullptr);
    if (!w)
        throw ProtocolError{builder.errorString().isEmpty() ? QStringLiteral("the form could not be built") : builder.errorString()};
    const QString styleName = p.value(QLatin1String("style")).toString();
    const bool dark = p.value(QLatin1String("dark")).toBool();
    QStyle *style = styleName.isEmpty() ? nullptr : QStyleFactory::create(styleName);
    const QPalette pal = darkPalette();
    if (style) {
        style->setParent(w);
        applyStyleTree(w, style, dark ? &pal : nullptr);
    } else if (dark) {
        w->setPalette(pal);
    }
    const qreal scale = qBound(1.0, p.value(QLatin1String("scale")).toDouble(1.0), 4.0);
    w->resize(fw->mainContainer()->size());
    w->ensurePolished();
    // Keep it: the page can now click, type and scroll in it (previewEvent) until it stops the preview.
    const QString docId = p.value(QLatin1String("docId")).toString();
    previewStop(p);
    PreviewSession session;
    session.root = w;
    session.scale = scale;
    m_previews.insert(docId, session);
    QJsonObject out = previewFrame(docId, w->size());
    out.insert(QLatin1String("styles"), stringsToJson(QStyleFactory::keys()));
    return out;
}

/// Renders the live preview, with the open pop-up (a combo box list, a menu) drawn over it.
QJsonObject Host::previewFrame(const QString &docId, const QSize &size) const
{
    const PreviewSession s = m_previews.value(docId);
    if (!s.root)
        throw ProtocolError{QStringLiteral("no preview is open")};
    QPixmap px(s.root->size() * s.scale);
    px.setDevicePixelRatio(s.scale);
    px.fill(Qt::transparent);
    s.root->render(&px);
    if (QWidget *pop = QApplication::activePopupWidget()) {
        QPainter painter(&px);
        pop->render(&painter, pop->pos() - s.root->mapToGlobal(QPoint(0, 0)));
    }
    QByteArray png;
    QBuffer buf(&png);
    buf.open(QIODevice::WriteOnly);
    px.save(&buf, "PNG");
    Q_UNUSED(size);
    return {{QLatin1String("png"), QString::fromLatin1(png.toBase64())}, {QLatin1String("width"), s.root->width()}, {QLatin1String("height"), s.root->height()}};
}

QJsonObject Host::previewStop(const QJsonObject &p)
{
    const auto it = m_previews.find(p.value(QLatin1String("docId")).toString());
    if (it == m_previews.end())
        return {};
    QWidget *root = it->root;
    m_previews.erase(it);
    closePopups();
    delete root;
    return {};
}

static int qtKeyFor(const QString &key, QString *text)
{
    static const QHash<QString, int> table{
        {QStringLiteral("Enter"), Qt::Key_Return}, {QStringLiteral("Backspace"), Qt::Key_Backspace}, {QStringLiteral("Delete"), Qt::Key_Delete},
        {QStringLiteral("Tab"), Qt::Key_Tab}, {QStringLiteral("Escape"), Qt::Key_Escape}, {QStringLiteral("ArrowLeft"), Qt::Key_Left},
        {QStringLiteral("ArrowRight"), Qt::Key_Right}, {QStringLiteral("ArrowUp"), Qt::Key_Up}, {QStringLiteral("ArrowDown"), Qt::Key_Down},
        {QStringLiteral("Home"), Qt::Key_Home}, {QStringLiteral("End"), Qt::Key_End}, {QStringLiteral("PageUp"), Qt::Key_PageUp},
        {QStringLiteral("PageDown"), Qt::Key_PageDown}, {QStringLiteral(" "), Qt::Key_Space}, {QStringLiteral("Shift"), Qt::Key_Shift},
        {QStringLiteral("Control"), Qt::Key_Control}, {QStringLiteral("Alt"), Qt::Key_Alt}};
    const auto it = table.constFind(key);
    if (it != table.cend()) {
        if (it.value() == Qt::Key_Return)
            *text = QStringLiteral("\r");
        else if (it.value() == Qt::Key_Tab)
            *text = QStringLiteral("\t");
        else if (it.value() == Qt::Key_Space)
            *text = QStringLiteral(" ");
        else if (it.value() == Qt::Key_Backspace)
            *text = QStringLiteral("\b");
        return it.value();
    }
    if (key.size() == 1) {
        *text = key;
        const QChar c = key.at(0).toUpper();
        return c.unicode() < 0x80 ? int(c.unicode()) : int(Qt::Key_unknown);
    }
    return Qt::Key_unknown;
}

/// Delivers one mouse, wheel or key event of the page to the live preview and answers with the new picture.
QJsonObject Host::previewEvent(const QJsonObject &p)
{
    const QString docId = p.value(QLatin1String("docId")).toString();
    auto it = m_previews.find(docId);
    if (it == m_previews.end() || !it->root)
        throw ProtocolError{QStringLiteral("no preview is open")};
    PreviewSession &s = it.value();
    const QString type = p.value(QLatin1String("kind")).toString();
    const QPoint pos(qRound(p.value(QLatin1String("x")).toDouble()), qRound(p.value(QLatin1String("y")).toDouble()));
    const Qt::KeyboardModifiers mods(p.value(QLatin1String("mods")).toInt());
    const int buttonBits = p.value(QLatin1String("button")).toInt();
    const Qt::MouseButton button = buttonBits == 2 ? Qt::RightButton : buttonBits == 1 ? Qt::MiddleButton : Qt::LeftButton;
    const Qt::MouseButtons buttons = type == QLatin1String("release") ? Qt::NoButton : (type == QLatin1String("move") ? (s.pressed ? button : Qt::NoButton) : button);
    const QPoint global = s.root->mapToGlobal(pos);

    // A pop-up that is open (a combo box list, a menu) takes the mouse, as it does on a real screen.
    auto targetAt = [&](QPoint *local) -> QWidget * {
        if (QWidget *pop = QApplication::activePopupWidget()) {
            QWidget *t = pop->childAt(pop->mapFromGlobal(global));
            t = t ? t : pop;
            *local = t->mapFromGlobal(global);
            return t;
        }
        QWidget *t = s.root->childAt(pos);
        t = t ? t : s.root.data();
        *local = t->mapFrom(s.root, pos);
        return t;
    };
    auto sendMouse = [&](QEvent::Type t, QWidget *target, const QPoint &local) {
        QMouseEvent ev(t, QPointF(local), QPointF(global), QPointF(global), button, buttons, mods);
        QCoreApplication::sendEvent(target, &ev);
    };

    if (type == QLatin1String("press") || type == QLatin1String("dblclick")) {
        QPoint local;
        QWidget *t = targetAt(&local);
        s.pressed = t;
        if (t->focusPolicy() & Qt::ClickFocus)
            t->setFocus(Qt::MouseFocusReason);
        if (t->focusPolicy() != Qt::NoFocus)
            s.focus = t;
        sendMouse(type == QLatin1String("press") ? QEvent::MouseButtonPress : QEvent::MouseButtonDblClick, t, local);
    } else if (type == QLatin1String("release")) {
        QPoint local;
        QWidget *t = s.pressed ? s.pressed.data() : targetAt(&local);
        local = t->mapFromGlobal(global);
        sendMouse(QEvent::MouseButtonRelease, t, local);
        s.pressed = nullptr;
    } else if (type == QLatin1String("move")) {
        QPoint local;
        QWidget *t = s.pressed ? s.pressed.data() : targetAt(&local);
        local = t->mapFromGlobal(global);
        if (!s.pressed && t != s.hover) {
            if (s.hover) {
                QEvent leave(QEvent::Leave);
                QCoreApplication::sendEvent(s.hover, &leave);
            }
            const QPointF localF(local), globalF(global);
            QEnterEvent enter(localF, globalF, globalF);
            QCoreApplication::sendEvent(t, &enter);
            s.hover = t;
        }
        sendMouse(QEvent::MouseMove, t, local);
    } else if (type == QLatin1String("wheel")) {
        QPoint local;
        QWidget *t = targetAt(&local);
        QWheelEvent ev(QPointF(local), QPointF(global), QPoint(), QPoint(qRound(p.value(QLatin1String("dx")).toDouble()), qRound(-p.value(QLatin1String("dy")).toDouble())),
                       Qt::NoButton, mods, Qt::NoScrollPhase, false);
        QCoreApplication::sendEvent(t, &ev);
    } else if (type == QLatin1String("keydown") || type == QLatin1String("keyup")) {
        QString text;
        const int key = qtKeyFor(p.value(QLatin1String("key")).toString(), &text);
        QWidget *t = QApplication::activePopupWidget() ? QApplication::activePopupWidget() : (s.focus ? s.focus.data() : s.root.data());
        if (key == Qt::Key_Tab && type == QLatin1String("keydown")) {
            // Tab walks the focus chain like it does in the application.
            QWidget *cur = s.focus ? s.focus.data() : s.root.data();
            QWidget *next = cur;
            const bool backwards = mods & Qt::ShiftModifier;
            for (int guard = 0; guard < 500; ++guard) {
                next = backwards ? next->previousInFocusChain() : next->nextInFocusChain();
                if (next == cur)
                    break;
                if ((next->focusPolicy() & Qt::TabFocus) && next->isEnabled() && !next->isHidden() && s.root->isAncestorOf(next)) {
                    next->setFocus(Qt::TabFocusReason);
                    s.focus = next;
                    break;
                }
            }
        } else if (key != Qt::Key_unknown) {
            QKeyEvent ev(type == QLatin1String("keydown") ? QEvent::KeyPress : QEvent::KeyRelease, key, mods, text);
            QCoreApplication::sendEvent(t, &ev);
        }
    }
    QCoreApplication::processEvents(QEventLoop::ExcludeUserInputEvents);
    return previewFrame(docId, s.root->size());
}

} // namespace qdr
