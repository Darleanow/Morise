#include "host.h"

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

QJsonObject Host::preview(const QJsonObject &p)
{
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
    QPixmap px(w->size() * scale);
    px.setDevicePixelRatio(scale);
    px.fill(Qt::transparent);
    w->render(&px);
    QByteArray png;
    QBuffer out(&png);
    out.open(QIODevice::WriteOnly);
    px.save(&out, "PNG");
    const QSize size = w->size();
    delete w;
    return {{QLatin1String("png"), QString::fromLatin1(png.toBase64())}, {QLatin1String("width"), size.width()},
            {QLatin1String("height"), size.height()}, {QLatin1String("styles"), stringsToJson(QStyleFactory::keys())}};
}

} // namespace qdr
