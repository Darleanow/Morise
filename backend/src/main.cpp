#include "host.h"

#include <csignal>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <cstring>
#include <execinfo.h>
#include <fcntl.h>
#include <unistd.h>

static void writeLine(const QJsonObject &o)
{
    const QByteArray line = QJsonDocument(o).toJson(QJsonDocument::Compact) + '\n';
    std::fwrite(line.constData(), 1, size_t(line.size()), stdout);
    std::fflush(stdout);
}

// A crash of the engine is reported to the file named by QDR_CRASH_LOG (if set): the call stack and the request that
// was running. The process then dies as before, so the extension still sees the exit and restarts it.
static char g_lastRequest[512];
static int g_crashFd = -1;

static void onCrash(int sig)
{
    if (g_crashFd >= 0) {
        const char head[] = "crash, last request: ";
        (void)!write(g_crashFd, head, sizeof head - 1);
        (void)!write(g_crashFd, g_lastRequest, strnlen(g_lastRequest, sizeof g_lastRequest));
        (void)!write(g_crashFd, "\n", 1);
        // A runaway recursion has thousands of frames: keep the top (where it died) and the bottom (what started it).
        static void *frames[8192];
        const int n = backtrace(frames, 8192);
        const int top = n < 30 ? n : 30, bottom = n < 60 ? 0 : 30;
        backtrace_symbols_fd(frames, top, g_crashFd);
        if (bottom > 0) {
            (void)!write(g_crashFd, "... (frames skipped) ...\n", 25);
            backtrace_symbols_fd(frames + n - bottom, bottom, g_crashFd);
        }
    }
    signal(sig, SIG_DFL);
    raise(sig);
}

int main(int argc, char **argv)
{
    if (const char *log = std::getenv("QDR_CRASH_LOG")) {
        g_crashFd = open(log, O_WRONLY | O_CREAT | O_APPEND, 0644);
        // A stack overflow (runaway recursion in the engine) needs a stack of its own to report from.
        static char altStack[64 * 1024];
        stack_t ss{};
        ss.ss_sp = altStack;
        ss.ss_size = sizeof altStack;
        sigaltstack(&ss, nullptr);
        struct sigaction sa{};
        sa.sa_handler = onCrash;
        sa.sa_flags = SA_ONSTACK;
        sigemptyset(&sa.sa_mask);
        sigaction(SIGSEGV, &sa, nullptr);
        sigaction(SIGABRT, &sa, nullptr);
    }
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

    // stdin is read on a helper thread; every request is executed on the Qt main thread, one at a time. The engine spins
    // the event loop while it works (to let Designer settle), which would otherwise start the next request in the middle of
    // the current one: requests wait in a queue and only the outermost drain runs them.
    struct Pending {
        std::mutex lock;
        std::deque<QByteArray> lines;
    };
    auto pending = std::make_shared<Pending>();
    auto handleLine = [&host](const QByteArray &raw) {
        std::strncpy(g_lastRequest, raw.constData(), sizeof g_lastRequest - 1);
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
    };
    auto draining = std::make_shared<bool>(false);
    auto drain = [pending, draining, handleLine] {
        if (*draining)
            return; // a request is running: the outer drain picks this one up afterwards
        *draining = true;
        struct Reset { bool *flag; ~Reset() { *flag = false; } } reset{draining.get()};
        for (;;) {
            QByteArray raw;
            {
                std::lock_guard<std::mutex> g(pending->lock);
                if (pending->lines.empty())
                    return;
                raw = std::move(pending->lines.front());
                pending->lines.pop_front();
            }
            handleLine(raw);
        }
    };
    std::thread reader([&app, pending, draining, drain] {
        std::string line;
        while (std::getline(std::cin, line)) {
            {
                std::lock_guard<std::mutex> g(pending->lock);
                pending->lines.push_back(QByteArray::fromStdString(line));
            }
            QMetaObject::invokeMethod(&app, drain, Qt::QueuedConnection);
        }
        // EOF: the extension closed our stdin. Exit immediately: normal QApplication/FormEditor
        // teardown segfaults (known issue, see poc_main.cpp).
        // Requests that arrived before the EOF are still answered first.
        auto leave = std::make_shared<std::function<void()>>();
        *leave = [pending, draining, leave] {
            bool busy = *draining;
            {
                std::lock_guard<std::mutex> g(pending->lock);
                busy = busy || !pending->lines.empty();
            }
            if (busy) {
                QTimer::singleShot(5, *leave);
                return;
            }
            std::fflush(stdout);
            std::_Exit(0);
        };
        QMetaObject::invokeMethod(&app, *leave, Qt::QueuedConnection);
    });
    reader.detach();
    return app.exec();
}

