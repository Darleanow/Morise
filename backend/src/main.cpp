#include "host.h"

static void writeLine(const QJsonObject &o)
{
    const QByteArray line = QJsonDocument(o).toJson(QJsonDocument::Compact) + '\n';
    std::fwrite(line.constData(), 1, size_t(line.size()), stdout);
    std::fflush(stdout);
}

int main(int argc, char **argv)
{
    qputenv("QT_QPA_PLATFORM", qgetenv("QT_QPA_PLATFORM").isEmpty() ? "offscreen" : qgetenv("QT_QPA_PLATFORM"));
    // Snapshot pixels must map 1:1 to widget coordinates regardless of the user's shell
    // (e.g. an exported QT_SCALE_FACTOR made grab() return a 1.75x image).
    qputenv("QT_ENABLE_HIGHDPI_SCALING", "0");
    qunsetenv("QT_SCALE_FACTOR");
    qunsetenv("QT_SCREEN_SCALE_FACTORS");
    qunsetenv("QT_AUTO_SCREEN_SCALE_FACTOR");
    QApplication app(argc, argv);
    // The forms are never shown: closing the one dialog the engine opens (e.g. to connect a signal) would
    // otherwise count as closing the last window and end the event loop.
    app.setQuitOnLastWindowClosed(false);
    qdr::Host host(&app);
    writeLine({{QLatin1String("event"), QLatin1String("ready")}, {QLatin1String("qt"), QString::fromLatin1(qVersion())}});

    // stdin is read on a helper thread; every request is executed on the Qt main thread.
    std::thread reader([&app, &host] {
        std::string line;
        while (std::getline(std::cin, line)) {
            QMetaObject::invokeMethod(&app, [&host, raw = QByteArray::fromStdString(line)] {
                QJsonParseError pe;
                const QJsonDocument doc = QJsonDocument::fromJson(raw, &pe);
                if (!doc.isObject()) {
                    writeLine({{QLatin1String("error"), QStringLiteral("invalid JSON: ") + pe.errorString()}});
                    return;
                }
                const QJsonObject req = doc.object();
                QJsonObject resp{{QLatin1String("id"), req.value(QLatin1String("id"))}};
                try {
                    QJsonObject result = host.handle(req.value(QLatin1String("method")).toString(),
                                                     req.value(QLatin1String("params")).toObject());
                    // Engine messages that would have been modal dialogs travel with the result.
                    if (!qdr::pendingMessages().isEmpty())
                        result.insert(QLatin1String("messages"), QJsonArray::fromStringList(qdr::pendingMessages()));
                    resp.insert(QLatin1String("result"), result);
                } catch (const qdr::ProtocolError &e) {
                    resp.insert(QLatin1String("error"), e.message);
                }
                qdr::pendingMessages().clear();
                writeLine(resp);
            }, Qt::QueuedConnection);
        }
        // EOF: the extension closed our stdin. Exit immediately: normal QApplication/FormEditor
        // teardown segfaults (known issue, see poc_main.cpp).
        QMetaObject::invokeMethod(&app, [] { std::fflush(stdout); std::_Exit(0); }, Qt::QueuedConnection);
    });
    reader.detach();
    return app.exec();
}

