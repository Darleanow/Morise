#include "host.h"

namespace qdr {

ConnectPlan *g_connectPlan = nullptr;

// Messages the engine would show in a modal box are recorded and sent back to the extension.
QStringList &pendingMessages()
{
    static QStringList list;
    return list;
}

class HeadlessDialogGui : public QDesignerDialogGuiInterface
{
public:
    QMessageBox::StandardButton message(QWidget *, Message, QMessageBox::Icon, const QString &title, const QString &text,
                                        QMessageBox::StandardButtons buttons, QMessageBox::StandardButton) override
    {
        return record(title, text, QString(), buttons);
    }
    QMessageBox::StandardButton message(QWidget *, Message, QMessageBox::Icon, const QString &title, const QString &text,
                                        const QString &info, QMessageBox::StandardButtons buttons, QMessageBox::StandardButton) override
    {
        return record(title, text, info, buttons);
    }
    QMessageBox::StandardButton message(QWidget *, Message, QMessageBox::Icon, const QString &title, const QString &text,
                                        const QString &info, const QString &detail, QMessageBox::StandardButtons buttons,
                                        QMessageBox::StandardButton) override
    {
        return record(title, text, info + QLatin1Char(' ') + detail, buttons);
    }
    QString getExistingDirectory(QWidget *, const QString &, const QString &, QFileDialog::Options) override { return {}; }
    QString getOpenFileName(QWidget *, const QString &, const QString &, const QString &, QString *, QFileDialog::Options) override { return {}; }
    QStringList getOpenFileNames(QWidget *, const QString &, const QString &, const QString &, QString *, QFileDialog::Options) override { return {}; }
    QString getSaveFileName(QWidget *, const QString &, const QString &, const QString &, QString *, QFileDialog::Options) override { return {}; }

private:
    static QMessageBox::StandardButton record(const QString &title, const QString &text, const QString &info,
                                              QMessageBox::StandardButtons buttons)
    {
        pendingMessages().append((title + QStringLiteral(": ") + text + (info.trimmed().isEmpty() ? QString() : QLatin1Char(' ') + info)).trimmed());
        // Never answer a question affirmatively on the user's behalf.
        if (buttons & QMessageBox::Cancel) return QMessageBox::Cancel;
        if (buttons & QMessageBox::No) return QMessageBox::No;
        if (buttons & QMessageBox::Ok) return QMessageBox::Ok;
        return QMessageBox::NoButton;
    }
};


bool fulfilConnectDialog(QWidget *modal)
{
    auto *signalList = modal->findChild<QListWidget *>(QStringLiteral("signalList"));
    auto *slotList = modal->findChild<QListWidget *>(QStringLiteral("slotList"));
    auto *all = modal->findChild<QCheckBox *>(QStringLiteral("showAllCheckBox"));
    if (!g_connectPlan || !signalList || !slotList)
        return false;
    auto find = [&](QListWidget *l, const QString &text) -> QListWidgetItem * {
        auto items = l->findItems(text, Qt::MatchExactly);
        if (items.isEmpty() && all && !all->isChecked()) {
            all->setChecked(true); // the signal or slot is inherited: show everything
            items = l->findItems(text, Qt::MatchExactly);
        }
        return items.isEmpty() ? nullptr : items.first();
    };
    QListWidgetItem *sig = find(signalList, g_connectPlan->signal);
    if (!sig) {
        g_connectPlan->failed = true;
        return false;
    }
    signalList->setCurrentItem(sig);
    emit signalList->itemClicked(sig); // populates the slot list
    QListWidgetItem *slot = find(slotList, g_connectPlan->slot);
    if (!slot) {
        g_connectPlan->failed = true;
        return false;
    }
    slotList->setCurrentItem(slot);
    emit slotList->itemClicked(slot);
    g_connectPlan->done = true;
    if (auto *d = qobject_cast<QDialog *>(modal))
        d->accept();
    return true;
}

// Safety net for dialogs the engine opens without going through dialogGui(): a modal widget would
// block the single-threaded backend forever, so it is recorded and dismissed.
void installModalGuard(QObject *parent)
{
    auto *timer = new QTimer(parent);
    timer->setInterval(20);
    QObject::connect(timer, &QTimer::timeout, timer, [] {
        while (QWidget *modal = QApplication::activeModalWidget()) {
            if (g_connectPlan && fulfilConnectDialog(modal))
                continue;
            QStringList texts;
            for (const QLabel *l : modal->findChildren<QLabel *>())
                if (!l->text().trimmed().isEmpty())
                    texts << l->text().trimmed();
            pendingMessages().append(modal->windowTitle() + QStringLiteral(": ") + texts.join(QLatin1Char(' ')) + QStringLiteral(" [dialog dismissed]"));
            if (auto *d = qobject_cast<QDialog *>(modal))
                d->reject();
            else
                modal->close();
            if (QApplication::activeModalWidget() == modal)
                modal->hide(); // could not be dismissed: avoid an endless loop
        }
    });
    timer->start();
}

QDesignerDialogGuiInterface *createHeadlessDialogGui()
{
    return new HeadlessDialogGui;
}

} // namespace qdr
