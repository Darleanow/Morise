// Headless host around the real QtDesigner form engine.
// Protocol: one JSON object per line on stdin ({id, method, params}) and stdout ({id, result|error}).
// Diagnostics from Qt go to stderr only; stdout is reserved for protocol messages.
#include <QtDesigner/QDesignerComponents>
#include <QtDesigner/QDesignerFormEditorInterface>
#include <QtDesigner/QDesignerFormEditorPluginInterface>
#include <QtDesigner/QDesignerFormWindowCursorInterface>
#include <QtDesigner/QDesignerFormWindowInterface>
#include <QtDesigner/QDesignerFormWindowManagerInterface>
#include <QtDesigner/QDesignerIntegration>
#include <QtDesigner/QDesignerPropertySheetExtension>
#include <QtDesigner/QExtensionManager>
#include <QtDesigner/QDesignerWidgetBoxInterface>
#include <QtDesigner/QDesignerWidgetFactoryInterface>
#include <QtDesigner/QDesignerContainerExtension>
#include <QtDesigner/QDesignerMetaDataBaseInterface>
#include <QtDesigner/QDesignerPromotionInterface>
#include <QtDesigner/QDesignerTaskMenuExtension>
#include <QtDesigner/QFormBuilder>
#include <QtDesigner/QDesignerFormWindowToolInterface>
#include <QtDesigner/private/abstractdialoggui_p.h>
#include <QtDesigner/private/connectionedit_p.h>
#include <QtDesigner/private/qdesigner_command_p.h>
#include <QtDesigner/private/qdesigner_command2_p.h>
#include <qdesigner_propertycommand_p.h>
#include <QtDesigner/QDesignerWidgetDataBaseInterface>
#include <QtDesigner/private/formwindowbase_p.h>
#include <QtDesigner/private/iconloader_p.h>
#include <QtDesigner/private/layoutinfo_p.h>
#include <QtDesigner/private/qdesigner_dnditem_p.h>
#include <QtDesigner/private/qdesigner_utils_p.h>
#include <QtDesigner/private/qdesigner_widgetbox_p.h>
#include <QtDesigner/private/ui4_p.h>

#include <QAction>
#include <QApplication>
#include <QCheckBox>
#include <QDialogButtonBox>
#include <QListWidget>
#include <QTableWidget>
#include <QTreeWidget>
#include <QMouseEvent>
#include <QCursor>
#include <QDate>
#include <QDateTime>
#include <QFont>
#include <QFontDatabase>
#include <QPalette>
#include <QSizePolicy>
#include <QStyle>
#include <QStyleFactory>
#include <QUrl>
#include <QDialog>
#include <QLabel>
#include <QTimer>
#include <QBuffer>
#include <QMetaMethod>
#include <QRegularExpression>
#include <QXmlStreamReader>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QKeySequence>
#include <QComboBox>
#include <QDockWidget>
#include <QListWidget>
#include <QMainWindow>
#include <QStatusBar>
#include <QToolBar>
#include <QMenuBar>
#include <QScrollArea>
#include <QMenu>
#include <QLayout>
#include <QPointer>
#include <QSet>
#include <QPluginLoader>
#include <QUndoStack>

#include <algorithm>
#include <functional>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>

using qdesigner_internal::DesignerMetaEnum;
using qdesigner_internal::PropertySheetEnumValue;
using qdesigner_internal::PropertySheetFlagValue;
using qdesigner_internal::PropertySheetStringValue;
using qdesigner_internal::PropertySheetStringListValue;
using qdesigner_internal::PropertySheetKeySequenceValue;
using qdesigner_internal::PropertySheetIconValue;
using qdesigner_internal::PropertySheetPixmapValue;

namespace {

// A widget-box drop: a copy-drop item whose "decoration" only carries the target rectangle,
// which FormWindowBase::dropWidgets reads to place the new widget.
class PaletteDropItem : public qdesigner_internal::QDesignerDnDItem
{
public:
    PaletteDropItem(DomUI *ui, QWidget *decoration, const QPoint &global)
        : QDesignerDnDItem(CopyDrop)
    {
        init(ui, nullptr, decoration, global);
    }
};

/// A drag of a widget that already lives in the form (Designer's "same form move"), driven without a QDrag.
class MoveDropItem : public qdesigner_internal::QDesignerDnDItem
{
public:
    MoveDropItem(QWidget *widget, QWidget *decoration, const QPoint &global)
        : QDesignerDnDItem(MoveDrop)
    {
        init(new DomUI, widget, decoration, global);
    }
};

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

// Answers the engine's connect dialog on behalf of the page: the signal and slot were chosen in the page.
struct ConnectPlan {
    QString signal, slot;
    bool done = false;
    bool failed = false;
};
ConnectPlan *g_connectPlan = nullptr;

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

struct ProtocolError {
    QString message;
};

/// The name the page uses for a widget. Spacers have no objectName in Designer: their name is `spacerName`.
QString idOf(const QObject *o)
{
    if (!o)
        return {};
    const QString n = o->objectName();
    if (!n.isEmpty())
        return n;
    const QVariant v = o->property("spacerName");
    return v.isValid() ? v.toString() : QString();
}

class Host
{
public:
    explicit Host(QObject *parent)
    {
        m_core = QDesignerComponents::createFormEditor(parent);
        QDesignerComponents::createTaskMenu(m_core, parent);
        QDesignerComponents::initializeResources();
        // The engine expects these panels on the core; they are never shown.
        m_core->setWidgetBox(QDesignerComponents::createWidgetBox(m_core, nullptr));
        m_core->setPropertyEditor(QDesignerComponents::createPropertyEditor(m_core, nullptr));
        m_core->setObjectInspector(QDesignerComponents::createObjectInspector(m_core, nullptr));
        m_core->setActionEditor(QDesignerComponents::createActionEditor(m_core, nullptr));
        QDesignerComponents::initializePlugins(m_core);
        // Mirrors QDesignerWorkbench::initializeCorePlugins(): without it the signal/slot,
        // buddy and tab order editors are inactive and <connections> are dropped on save.
        for (QObject *plugin : QPluginLoader::staticInstances()) {
            if (auto *p = qobject_cast<QDesignerFormEditorPluginInterface *>(plugin)) {
                if (!p->isInitialized())
                    p->initialize(m_core);
            }
        }
        new QDesignerIntegration(m_core, parent);
        m_core->setDialogGui(new HeadlessDialogGui);
        installModalGuard(parent);
    }

    QJsonObject handle(const QString &method, const QJsonObject &p)
    {
        // A gesture left open (the page vanished mid-drag) must never swallow later commands into its macro.
        static const QStringList keepsGestureOpen{QStringLiteral("gesture"), QStringLiteral("setProperty"), QStringLiteral("snapshot"),
            QStringLiteral("view"), QStringLiteral("select"), QStringLiteral("hitTest"), QStringLiteral("properties"),
            QStringLiteral("describe"), QStringLiteral("connections"), QStringLiteral("palette"), QStringLiteral("setGeometries"), QStringLiteral("history"),
            QStringLiteral("preview"), QStringLiteral("reparent"), QStringLiteral("taskActions"), QStringLiteral("containerInfo"), QStringLiteral("tabOrder"),
            QStringLiteral("formInfo")};
        if (!keepsGestureOpen.contains(method)) {
            const auto it = m_forms.constFind(p.value(QLatin1String("docId")).toString());
            if (it != m_forms.constEnd())
                endGesture(it.value());
        }
        if (method == QLatin1String("open")) return open(p);
        if (method == QLatin1String("close")) return close(p);
        if (method == QLatin1String("snapshot")) return snapshot(form(p));
        if (method == QLatin1String("select")) return select(p);
        if (method == QLatin1String("hitTest")) return hitTest(p);
        if (method == QLatin1String("properties")) return properties(p);
        if (method == QLatin1String("setProperty")) return setProperty(p);
        if (method == QLatin1String("resetProperty")) return resetProperty(p);
        if (method == QLatin1String("palette")) return palette();
        if (method == QLatin1String("gesture")) return gestureCmd(p);
        if (method == QLatin1String("describe")) return describe(p);
        if (method == QLatin1String("history")) return history(p);
        if (method == QLatin1String("setGeometries")) return setGeometries(p);
        if (method == QLatin1String("reparent")) return reparent(p);
        if (method == QLatin1String("moveWidget")) return moveWidget(p);
        if (method == QLatin1String("setItems")) return setItems(p);
        if (method == QLatin1String("setContents")) return setContents(p);
        if (method == QLatin1String("preview")) return preview(p);
        if (method == QLatin1String("taskActions")) return taskActions(p);
        if (method == QLatin1String("taskAction")) return taskAction(p);
        if (method == QLatin1String("containerInfo")) return containerInfo(p);
        if (method == QLatin1String("setCurrentPage")) return setCurrentPage(p);
        if (method == QLatin1String("pageOp")) return pageOp(p);
        if (method == QLatin1String("connect")) return connectWidgets(p);
        if (method == QLatin1String("disconnect")) return disconnectWidgets(p);
        if (method == QLatin1String("tabOrder")) return tabOrder(p);
        if (method == QLatin1String("setTabOrder")) return setTabOrder(p);
        if (method == QLatin1String("promote")) return promote(p);
        if (method == QLatin1String("demote")) return demote(p);
        if (method == QLatin1String("formInfo")) return formInfo(p);
        if (method == QLatin1String("setFormInfo")) return setFormInfo(p);
        if (method == QLatin1String("addDynamicProperty")) return addDynamicProperty(p);
        if (method == QLatin1String("removeDynamicProperty")) return removeDynamicProperty(p);
        if (method == QLatin1String("connections")) return connections(p);
        if (method == QLatin1String("view")) {
            QDesignerFormWindowInterface *fw = form(p);
            m_scales.insert(fw, qBound(1.0, p.value(QLatin1String("scale")).toDouble(1.0), 4.0));
            return snapshot(fw);
        }
        if (method == QLatin1String("addWidget")) return addWidget(p);
        if (method == QLatin1String("action")) return action(p);
        if (method == QLatin1String("undo")) { form(p)->commandHistory()->undo(); return snapshot(form(p)); }
        if (method == QLatin1String("redo")) { form(p)->commandHistory()->redo(); return snapshot(form(p)); }
        if (method == QLatin1String("contents")) return contents(p);
        if (method == QLatin1String("markSaved")) {
            form(p)->commandHistory()->setClean();
            return snapshot(form(p));
        }
        throw ProtocolError{QStringLiteral("unknown method: ") + method};
    }

private:
    QDesignerFormWindowInterface *form(const QJsonObject &p) const
    {
        const auto it = m_forms.constFind(p.value(QLatin1String("docId")).toString());
        if (it == m_forms.constEnd())
            throw ProtocolError{QStringLiteral("unknown docId")};
        return it.value();
    }

    /// A widget the page lists: the managed ones, plus the parts of a main window Designer shows in its object
    /// inspector without managing them (menu bar, tool bars, status bar, central widget).
    bool listed(QDesignerFormWindowInterface *fw, QWidget *w) const
    {
        if (fw->isManaged(w))
            return true;
        if (!m_core->metaDataBase()->item(w))
            return false;
        if (qobject_cast<QMenuBar *>(w) || qobject_cast<QToolBar *>(w) || qobject_cast<QStatusBar *>(w))
            return true;
        const auto *mw = qobject_cast<QMainWindow *>(fw->mainContainer());
        return mw && mw->centralWidget() == w;
    }

    QWidget *widgetByName(QDesignerFormWindowInterface *fw, const QString &name) const
    {
        if (name.isEmpty())
            return nullptr;
        QWidget *root = fw->mainContainer();
        if (idOf(root) == name)
            return root;
        for (QWidget *w : root->findChildren<QWidget *>())
            if (listed(fw, w) && idOf(w) == name)
                return w;
        return nullptr;
    }

    /// A widget, or a layout (Designer lists layouts as objects with their own property sheet).
    QObject *objectByName(QDesignerFormWindowInterface *fw, const QString &name) const
    {
        if (QWidget *w = widgetByName(fw, name))
            return w;
        for (QLayout *l : fw->mainContainer()->findChildren<QLayout *>(name)) {
            if (l->objectName() == name)
                return l;
        }
        return nullptr;
    }

    /// Old forms can hold spacers (or other widgets) without a name; the page addresses objects by name.
    void nameUnnamedWidgets(QDesignerFormWindowInterface *fw) const
    {
        QSet<QString> used;
        const QList<QWidget *> all = fw->mainContainer()->findChildren<QWidget *>();
        for (QWidget *w : all)
            if (fw->isManaged(w) && !idOf(w).isEmpty())
                used.insert(idOf(w));
        for (QWidget *w : all) {
            if (!fw->isManaged(w) || !idOf(w).isEmpty())
                continue;
            const bool spacer = w->property("spacerName").isValid();
            const QString base = spacer ? QStringLiteral("spacer") : QStringLiteral("widget");
            QString candidate = base;
            for (int i = 2; used.contains(candidate); ++i)
                candidate = base + QString::number(i);
            used.insert(candidate);
            if (spacer)
                w->setProperty("spacerName", candidate);
            else
                w->setObjectName(candidate);
        }
    }

    QJsonObject open(const QJsonObject &p)
    {
        const QString id = p.value(QLatin1String("docId")).toString();
        if (id.isEmpty())
            throw ProtocolError{QStringLiteral("docId required")};
        if (m_forms.contains(id))
            throw ProtocolError{QStringLiteral("docId already open")};

        QDesignerFormWindowInterface *fw = m_core->formWindowManager()->createFormWindow();
        const QString path = p.value(QLatin1String("path")).toString();
        if (!path.isEmpty())
            fw->setFileName(path); // lets relative resources resolve against the .ui location
        QByteArray xml = p.value(QLatin1String("xml")).toString().toUtf8();
        QBuffer buf(&xml);
        buf.open(QIODevice::ReadOnly);
        QString err;
        if (!fw->setContents(&buf, &err)) {
            delete fw;
            throw ProtocolError{err.isEmpty() ? QStringLiteral("load failed") : err};
        }
        // The engine lays the main container out through the FormWindow; the host must give
        // it the form's own size or the saved <geometry> is rewritten (verified on sample.ui).
        nameUnnamedWidgets(fw);
        fw->resize(fw->mainContainer()->size());
        m_core->formWindowManager()->setActiveFormWindow(fw);
        m_forms.insert(id, fw);
        return snapshot(fw);
    }

    // A drag is one undo step: its many live geometry commands are grouped into a single macro. Without it,
    // Designer merges consecutive commands on the same property, even across separate gestures.
    void endGesture(QDesignerFormWindowInterface *fw)
    {
        if (m_gestures.remove(fw))
            fw->endCommand();
    }

    QJsonObject gestureCmd(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        const QString phase = p.value(QLatin1String("phase")).toString();
        if (phase == QLatin1String("begin")) {
            endGesture(fw);
            fw->beginCommand(p.value(QLatin1String("label")).toString());
            m_gestures.insert(fw);
        } else if (phase == QLatin1String("end")) {
            endGesture(fw);
        } else {
            throw ProtocolError{QStringLiteral("unknown gesture phase")};
        }
        return snapshot(fw);
    }

    QJsonObject close(const QJsonObject &p)
    {
        const auto it = m_forms.find(p.value(QLatin1String("docId")).toString());
        if (it == m_forms.end())
            return {};
        QDesignerFormWindowInterface *fw = it.value();
        endGesture(fw);
        m_forms.erase(it);
        m_scales.remove(fw);
        fw->clearSelection(false);
        m_core->formWindowManager()->removeFormWindow(fw);
        fw->hide();
        fw->deleteLater();
        QCoreApplication::sendPostedEvents(nullptr, QEvent::DeferredDelete);
        return {};
    }

    QJsonObject contents(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        return {{QLatin1String("xml"), fw->contents()}, {QLatin1String("warnings"), QJsonArray::fromStringList(fw->checkContents())}};
    }

    QJsonObject snapshot(QDesignerFormWindowInterface *fw)
    {
        QCoreApplication::processEvents();
        // Render at the viewer's pixel density so text stays crisp on HiDPI screens and when zoomed.
        // Reported sizes and all coordinates stay in logical (1x) units.
        const qreal scale = m_scales.value(fw, 1.0);
        QPixmap px(fw->size() * scale);
        px.setDevicePixelRatio(scale);
        px.fill(Qt::transparent);
        fw->render(&px);
        QByteArray png;
        QBuffer b(&png);
        b.open(QIODevice::WriteOnly);
        px.save(&b, "PNG");

        QJsonArray objects;
        QWidget *root = fw->mainContainer();
        auto describeWidget = [&](QWidget *w) {
            QWidget *parent = w->parentWidget();
            while (parent && !listed(fw, parent))
                parent = parent->parentWidget();
            const QPoint tl = w->mapTo(fw, QPoint(0, 0));
            const QPoint origin = w->parentWidget() ? w->parentWidget()->mapTo(fw, QPoint(0, 0)) : QPoint(0, 0);
            objects.append(QJsonObject{
                {QLatin1String("name"), idOf(w)},
                {QLatin1String("class"), QString::fromUtf8(w->metaObject()->className())},
                {QLatin1String("parent"), (w == root || !parent) ? QJsonValue() : QJsonValue(idOf(parent))},
                {QLatin1String("gx"), origin.x()}, {QLatin1String("gy"), origin.y()},
                {QLatin1String("laidOut"), w != root && qdesigner_internal::LayoutInfo::isWidgetLaidout(m_core, w)},
                {QLatin1String("x"), tl.x()}, {QLatin1String("y"), tl.y()},
                {QLatin1String("w"), w->width()}, {QLatin1String("h"), w->height()}});
        };
        describeWidget(root);
        for (QWidget *w : root->findChildren<QWidget *>())
            if (listed(fw, w))
                describeWidget(w);

        QJsonArray layouts;
        // Layouts nest (a horizontal layout inside a vertical one): walk the tree so each is reported.
        std::function<void(QWidget *, QLayout *, const QString &)> addLayout = [&](QWidget *w, QLayout *l, const QString &parentName) {
            const auto type = qdesigner_internal::LayoutInfo::layoutType(m_core, l);
            const QRect r = l->contentsRect().isValid() && !parentName.isEmpty() ? l->geometry() : l->contentsRect();
            const QPoint tl = w->mapTo(fw, r.topLeft());
            layouts.append(QJsonObject{
                {QLatin1String("owner"), idOf(w)}, {QLatin1String("name"), l->objectName()},
                {QLatin1String("parent"), parentName.isEmpty() ? QJsonValue() : QJsonValue(parentName)},
                {QLatin1String("kind"), qdesigner_internal::LayoutInfo::layoutName(type)},
                {QLatin1String("x"), tl.x()}, {QLatin1String("y"), tl.y()}, {QLatin1String("w"), r.width()}, {QLatin1String("h"), r.height()}});
            for (int i = 0; i < l->count(); ++i)
                if (QLayout *sub = l->itemAt(i)->layout())
                    addLayout(w, sub, l->objectName());
        };
        auto describeLayout = [&](QWidget *w) {
            QLayout *l = nullptr;
            const auto type = qdesigner_internal::LayoutInfo::managedLayoutType(m_core, w, &l);
            if (type == qdesigner_internal::LayoutInfo::NoLayout)
                return;
            if (l) {
                addLayout(w, l, QString());
                return;
            }
            // splitters are their own layout
            const QPoint tl = w->mapTo(fw, QPoint(0, 0));
            layouts.append(QJsonObject{
                {QLatin1String("owner"), idOf(w)}, {QLatin1String("name"), idOf(w)}, {QLatin1String("parent"), QJsonValue()},
                {QLatin1String("kind"), qdesigner_internal::LayoutInfo::layoutName(type)},
                {QLatin1String("x"), tl.x()}, {QLatin1String("y"), tl.y()}, {QLatin1String("w"), w->width()}, {QLatin1String("h"), w->height()}});
        };
        describeLayout(root);
        for (QWidget *w : root->findChildren<QWidget *>())
            if (fw->isManaged(w))
                describeLayout(w);

        QJsonArray selection;
        QDesignerFormWindowCursorInterface *cur = fw->cursor();
        for (int i = 0; i < cur->selectedWidgetCount(); ++i)
            selection.append(idOf(cur->selectedWidget(i)));

        QJsonObject actions;
        m_core->formWindowManager()->setActiveFormWindow(fw);
        QCoreApplication::processEvents();
        for (const auto &d : actionDefs()) {
            QAction *a = m_core->formWindowManager()->action(d.id);
            actions.insert(QLatin1String(d.name), a && a->isEnabled());
        }
        QUndoStack *stack = fw->commandHistory();
        return {
            {QLatin1String("actions"), actions},
            {QLatin1String("formGeometry"), QJsonArray{root->geometry().x(), root->geometry().y(), root->geometry().width(), root->geometry().height()}},
            {QLatin1String("grid"), QJsonArray{fw->grid().x(), fw->grid().y()}},
            {QLatin1String("png"), QString::fromLatin1(png.toBase64())},
            {QLatin1String("width"), fw->width()}, {QLatin1String("height"), fw->height()}, {QLatin1String("dpr"), scale},
            {QLatin1String("objects"), objects}, {QLatin1String("layouts"), layouts}, {QLatin1String("selection"), selection},
            {QLatin1String("dirty"), fw->isDirty()},
            {QLatin1String("undoIndex"), stack->index()}, {QLatin1String("undoCount"), stack->count()},
            {QLatin1String("canUndo"), stack->canUndo()}, {QLatin1String("canRedo"), stack->canRedo()},
            {QLatin1String("undoText"), stack->undoText()}, {QLatin1String("redoText"), stack->redoText()}};
    }

    struct ActionDef { const char *name; QDesignerFormWindowManagerInterface::Action id; };
    static const std::vector<ActionDef> &actionDefs()
    {
        using M = QDesignerFormWindowManagerInterface;
        static const std::vector<ActionDef> defs = {
            {"cut", M::CutAction}, {"copy", M::CopyAction}, {"paste", M::PasteAction},
            {"delete", M::DeleteAction}, {"selectAll", M::SelectAllAction},
            {"lower", M::LowerAction}, {"raise", M::RaiseAction},
            {"layoutHorizontal", M::HorizontalLayoutAction}, {"layoutVertical", M::VerticalLayoutAction},
            {"layoutSplitHorizontal", M::SplitHorizontalAction}, {"layoutSplitVertical", M::SplitVerticalAction},
            {"layoutGrid", M::GridLayoutAction}, {"layoutForm", M::FormLayoutAction},
            {"breakLayout", M::BreakLayoutAction}, {"adjustSize", M::AdjustSizeAction},
            {"simplifyLayout", M::SimplifyLayoutAction}};
        return defs;
    }

    static QString iconDataUrl(const QIcon &icon, int size = 20)
    {
        if (icon.isNull())
            return {};
        QPixmap px = icon.pixmap(QSize(size, size));
        if (px.isNull())
            return {};
        QByteArray png;
        QBuffer b(&png);
        b.open(QIODevice::WriteOnly);
        px.save(&b, "PNG");
        return QStringLiteral("data:image/png;base64,") + QString::fromLatin1(png.toBase64());
    }

    QJsonObject palette()
    {
        QDesignerWidgetBoxInterface *box = m_core->widgetBox();
        static const QRegularExpression classRe(QStringLiteral("<widget\\s+class=\"([^\"]+)\""));
        QJsonArray cats;
        for (int c = 0; c < box->categoryCount(); ++c) {
            const auto cat = box->category(c);
            QJsonArray widgets;
            for (int i = 0; i < box->widgetCount(c); ++i) {
                const auto w = box->widget(c, i);
                const auto m = classRe.match(w.domXml());
                widgets.append(QJsonObject{
                    {QLatin1String("name"), w.name()}, {QLatin1String("index"), i},
                    {QLatin1String("className"), m.hasMatch() ? m.captured(1) : QString()},
                    {QLatin1String("icon"), iconDataUrl(qdesigner_internal::createIconSet(w.iconName()))}});
            }
            cats.append(QJsonObject{{QLatin1String("name"), cat.name()}, {QLatin1String("index"), c}, {QLatin1String("widgets"), widgets}});
        }
        return {{QLatin1String("categories"), cats}, {QLatin1String("fonts"), stringsToJson(QFontDatabase::families())}};
    }

    // Signals and slots a widget offers, from its QMetaObject: what a developer needs to wire it up.
    QJsonObject describe(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
        if (!w)
            throw ProtocolError{QStringLiteral("unknown object")};
        QJsonArray signalsArr, slotsArr;
        const QMetaObject *mo = w->metaObject();
        for (int i = 0; i < mo->methodCount(); ++i) {
            const QMetaMethod m = mo->method(i);
            if (m.access() != QMetaMethod::Public)
                continue;
            if (m.methodType() != QMetaMethod::Signal && m.methodType() != QMetaMethod::Slot)
                continue;
            QJsonArray params;
            const auto types = m.parameterTypes();
            const auto names = m.parameterNames();
            for (int k = 0; k < types.size(); ++k)
                params.append(QJsonObject{{QLatin1String("type"), QString::fromLatin1(types.at(k))},
                                          {QLatin1String("name"), QString::fromLatin1(names.value(k))}});
            QJsonObject o{{QLatin1String("name"), QString::fromLatin1(m.name())},
                          {QLatin1String("signature"), QString::fromLatin1(m.methodSignature())},
                          {QLatin1String("params"), params},
                          {QLatin1String("owner"), QString::fromLatin1(m.enclosingMetaObject()->className())}};
            (m.methodType() == QMetaMethod::Signal ? signalsArr : slotsArr).append(o);
        }
        QJsonArray chain;
        for (const QMetaObject *c = mo; c; c = c->superClass())
            chain.append(QString::fromLatin1(c->className()));
        // The class the .ui records (e.g. QPushButton), not the Designer proxy class.
        const auto *db = m_core->widgetDataBase();
        const int dbIndex = db->indexOfObject(w);
        return {{QLatin1String("name"), idOf(w)},
                {QLatin1String("class"), dbIndex >= 0 ? db->item(dbIndex)->name() : QString::fromUtf8(mo->className())},
                {QLatin1String("hierarchy"), chain}, {QLatin1String("signals"), signalsArr}, {QLatin1String("slots"), slotsArr}};
    }

    // Connections as stored in the document, read from the engine's own serialisation.
    QJsonObject connections(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QXmlStreamReader r(fw->contents());
        QJsonArray out;
        QJsonObject cur;
        bool inConnections = false;
        while (!r.atEnd()) {
            r.readNext();
            if (r.isStartElement()) {
                const auto n = r.name();
                if (n == QLatin1String("connections")) inConnections = true;
                else if (inConnections && n == QLatin1String("connection")) cur = {};
                else if (inConnections && (n == QLatin1String("sender") || n == QLatin1String("signal") || n == QLatin1String("receiver") || n == QLatin1String("slot")))
                    cur.insert(n.toString(), r.readElementText());
            } else if (r.isEndElement()) {
                if (r.name() == QLatin1String("connection") && inConnections && !cur.isEmpty())
                    out.append(cur);
                else if (r.name() == QLatin1String("connections"))
                    inConnections = false;
            }
        }
        return {{QLatin1String("connections"), out}};
    }

    QJsonObject addWidget(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QDesignerWidgetBoxInterface *box = m_core->widgetBox();
        const int c = p.value(QLatin1String("category")).toInt(-1);
        const int i = p.value(QLatin1String("index")).toInt(-1);
        if (c < 0 || c >= box->categoryCount() || i < 0 || i >= box->widgetCount(c))
            throw ProtocolError{QStringLiteral("unknown palette entry")};
        const auto entry = box->widget(c, i);

        QString err;
        DomUI *ui = qdesigner_internal::QDesignerWidgetBox::xmlToUi(entry.name(), entry.domXml(), true, &err);
        if (!ui)
            throw ProtocolError{err};

        // Designer only allows dock widgets in a main window; elsewhere the engine crashes.
        if (const DomWidget *top = ui->elementWidget(); top && !top->elementWidget().isEmpty()
            && top->elementWidget().first()->attributeClass().endsWith(QLatin1String("DockWidget"))
            && !qobject_cast<QMainWindow *>(fw->mainContainer())) {
            delete ui;
            throw ProtocolError{QStringLiteral("A dock widget can only be added to a main window form (QMainWindow).")};
        }
        // Target: the managed widget under the point (a container is found by the engine).
        const QPoint pos(qRound(p.value(QLatin1String("x")).toDouble()), qRound(p.value(QLatin1String("y")).toDouble()));
        QWidget *target = fw->childAt(pos);
        while (target && !fw->isManaged(target))
            target = target->parentWidget();
        if (!target)
            target = fw->mainContainer();
        // A scroll area or dock widget holds one widget: the engine replaces the old content and frees it
        // without telling the rest of the editor, which then crashes on the dangling pointer.
        if (const auto *sa = qobject_cast<QScrollArea *>(target); sa && sa->widget()) {
            delete ui;
            throw ProtocolError{QStringLiteral("%1 already has content; drop into its content widget or lay it out instead.").arg(idOf(target))};
        }
        if (const auto *dw = qobject_cast<QDockWidget *>(target); dw && dw->widget()) {
            delete ui;
            throw ProtocolError{QStringLiteral("%1 already has content; drop into its content widget instead.").arg(idOf(target))};
        }

        // Size like the engine does for a drag: the widget's size hint, at least 16x16.
        QSize size(16, 16);
        if (const DomWidget *dw = ui->elementWidget(); dw && !dw->elementWidget().isEmpty()) {
            const QString cls = dw->elementWidget().first()->attributeClass();
            if (QWidget *probe = m_core->widgetFactory()->createWidget(cls, nullptr)) {
                // The palette entry carries its caption ("TextLabel"): measure with it, as the engine's own drag does.
                for (const DomProperty *prop : dw->elementWidget().first()->elementProperty()) {
                    if (prop->kind() == DomProperty::String && (prop->attributeName() == QLatin1String("text") || prop->attributeName() == QLatin1String("title")))
                        probe->setProperty(prop->attributeName().toUtf8().constData(), prop->elementString()->text());
                }
                size = size.expandedTo(probe->sizeHint()).expandedTo(probe->minimumSizeHint());
                delete probe;
            }
        }
        const QPoint global = fw->mapToGlobal(pos);
        auto *decoration = new QWidget;
        decoration->setGeometry(QRect(global, size));
        auto *item = new PaletteDropItem(ui, decoration, global);

        auto *base = qobject_cast<qdesigner_internal::FormWindowBase *>(fw);
        if (!base)
            throw ProtocolError{QStringLiteral("form window does not support drops")};
        m_core->formWindowManager()->setActiveFormWindow(fw);
        aimLayoutCell(base, target, global, nullptr);
        const bool ok = base->dropWidgets({item}, target, global);
        delete item;
        if (!ok)
            throw ProtocolError{QStringLiteral("the engine refused the drop at this position")};
        return snapshot(fw);
    }

    QJsonObject action(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        const QString name = p.value(QLatin1String("action")).toString();
        for (const auto &d : actionDefs()) {
            if (name != QLatin1String(d.name))
                continue;
            m_core->formWindowManager()->setActiveFormWindow(fw);
            QCoreApplication::processEvents();
            QAction *a = m_core->formWindowManager()->action(d.id);
            if (!a || !a->isEnabled())
                throw ProtocolError{QStringLiteral("action not available for the current selection: ") + name};
            a->trigger();
            nameUnnamedWidgets(fw); // a layout made from a selection creates an unnamed layout widget
            return snapshot(fw);
        }
        throw ProtocolError{QStringLiteral("unknown action: ") + name};
    }

    QJsonObject select(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        fw->clearSelection(false);
        const QJsonArray names = p.value(QLatin1String("names")).toArray();
        for (const QJsonValue &n : names) {
            if (QWidget *w = widgetByName(fw, n.toString()))
                fw->selectWidget(w, true);
        }
        return snapshot(fw);
    }

    QJsonObject hitTest(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QWidget *w = fw->childAt(qRound(p.value(QLatin1String("x")).toDouble()), qRound(p.value(QLatin1String("y")).toDouble()));
        while (w && !listed(fw, w))
            w = w->parentWidget();
        // The central widget stands for the window itself: clicking on it selects the form, as in Designer.
        if (const auto *mw = qobject_cast<QMainWindow *>(fw->mainContainer()); mw && w && w == mw->centralWidget())
            w = fw->mainContainer();
        return {{QLatin1String("name"), w ? QJsonValue(idOf(w)) : QJsonValue()}};
    }

    // ---- property values: engine types <-> JSON ------------------------------------------------

    static QJsonArray stringsToJson(const QStringList &l) { return QJsonArray::fromStringList(l); }

    static QStringList jsonToStrings(const QJsonValue &v)
    {
        QStringList out;
        for (const QJsonValue &x : v.toArray())
            out << x.toString();
        return out;
    }

    static QStringList enumKeys(const QMetaEnum &me)
    {
        QStringList out;
        for (int i = 0; i < me.keyCount(); ++i)
            out << QString::fromLatin1(me.key(i));
        return out;
    }

    QString thumbnailFor(QDesignerFormWindowInterface *fw, const QString &path) const
    {
        if (path.isEmpty())
            return {};
        const QString abs = path.startsWith(QLatin1Char(':')) || QFileInfo(path).isAbsolute() ? path : fw->absoluteDir().absoluteFilePath(path);
        QPixmap px(abs);
        if (px.isNull())
            return {};
        return iconDataUrl(QIcon(px.scaled(48, 48, Qt::KeepAspectRatio, Qt::SmoothTransformation)), 48);
    }

    QJsonObject describeValue(const QVariant &v, QDesignerFormWindowInterface *fw) const
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
        case QMetaType::QPalette: return make("unsupported", QStringLiteral("custom palette (edit with styleSheet)"));
        default: break;
        }
        QJsonObject o = make("unsupported", v.toString());
        o.insert(QLatin1String("typeName"), QString::fromUtf8(v.typeName() ? v.typeName() : ""));
        return o;
    }

    static QJsonArray numbers(const QJsonValue &v) { return v.toArray(); }

    /// Builds the value to give the engine from the JSON the page sent, using the current value as a template.
    QVariant parseValue(const QVariant &current, const QJsonValue &val) const
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

    QDesignerPropertySheetExtension *sheetOf(QObject *o) const
    {
        auto *sheet = qt_extension<QDesignerPropertySheetExtension *>(m_core->extensionManager(), o);
        if (!sheet)
            throw ProtocolError{QStringLiteral("no property sheet")};
        return sheet;
    }

    QObject *requireObject(QDesignerFormWindowInterface *fw, const QString &name) const
    {
        QObject *o = objectByName(fw, name);
        if (!o)
            throw ProtocolError{QStringLiteral("unknown object: ") + name};
        return o;
    }

    QJsonObject properties(const QJsonObject &p)
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
                {QLatin1String("properties"), props}};
    }

    /// Item captions of a combo box or list widget (null when the object has no editable item list).
    static QJsonValue itemTexts(QObject *o)
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

    /// Replaces the captions of a combo box or list widget through the engine's own command, keeping the
    /// icons and other roles of the items whose caption is unchanged at the same place.
    QJsonObject setItems(const QJsonObject &p)
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


    // ---- tree and table widget contents (columns, rows, cells), through the engine's own commands ----

    static QJsonArray textsOf(const QTreeWidgetItem *it, int columns)
    {
        QJsonArray a;
        for (int c = 0; c < columns; ++c)
            a.append(it->text(c));
        return a;
    }

    static QJsonArray treeItems(const QTreeWidget *t, const QTreeWidgetItem *parent)
    {
        QJsonArray out;
        const int n = parent ? parent->childCount() : t->topLevelItemCount();
        for (int i = 0; i < n; ++i) {
            const QTreeWidgetItem *it = parent ? parent->child(i) : t->topLevelItem(i);
            out.append(QJsonObject{{QLatin1String("cells"), textsOf(it, t->columnCount())}, {QLatin1String("children"), treeItems(t, it)}});
        }
        return out;
    }

    /// Editable contents of a QTreeWidget or QTableWidget, or null for other objects.
    static QJsonValue gridContents(QObject *o)
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

    /// An item with the given caption: the old item's other roles are kept when the caption is unchanged or renamed.
    static qdesigner_internal::ItemData itemWith(const QString &text, const qdesigner_internal::ItemData *old)
    {
        qdesigner_internal::ItemData d;
        if (old)
            d = *old;
        if (text.isEmpty() && !old)
            return d; // nothing to store
        d.m_properties.insert(Qt::DisplayPropertyRole, QVariant::fromValue(qdesigner_internal::PropertySheetStringValue(text)));
        return d;
    }

    static qdesigner_internal::ListContents headerWith(const QJsonArray &texts, const qdesigner_internal::ListContents &old)
    {
        qdesigner_internal::ListContents out;
        for (int i = 0; i < texts.size(); ++i)
            out.m_items.append(itemWith(texts.at(i).toString(), i < old.m_items.size() && old.m_items.at(i).isValid() ? &old.m_items.at(i) : nullptr));
        return out;
    }

    static qdesigner_internal::TreeWidgetContents::ItemContents treeItemFrom(const QJsonObject &o, int columns, const qdesigner_internal::TreeWidgetContents::ItemContents *old)
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

    QJsonObject setContents(const QJsonObject &p)
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

    /// Targets of an edit: `names` (multi-selection) or the single `name`.
    QObjectList targets(QDesignerFormWindowInterface *fw, const QJsonObject &p) const
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

    QJsonObject setProperty(const QJsonObject &p)
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

    QJsonObject resetProperty(const QJsonObject &p)
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

    // ---- geometry by batch, reparenting, duplicates --------------------------------------------

    QJsonObject setGeometries(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        for (const QJsonValue &it : p.value(QLatin1String("items")).toArray()) {
            const QJsonObject o = it.toObject();
            QWidget *w = widgetByName(fw, o.value(QLatin1String("name")).toString());
            const QJsonArray r = o.value(QLatin1String("rect")).toArray();
            if (!w || r.size() != 4)
                throw ProtocolError{QStringLiteral("bad geometry item")};
            fw->cursor()->setWidgetProperty(w, QStringLiteral("geometry"), QRect(r[0].toInt(), r[1].toInt(), r[2].toInt(), r[3].toInt()));
        }
        return snapshot(fw);
    }

    /// Moves widgets into another container, as dropping them on it does in Designer. Rects are in form pixels.
    QJsonObject reparent(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QWidget *parent = widgetByName(fw, p.value(QLatin1String("parent")).toString());
        if (!parent)
            throw ProtocolError{QStringLiteral("unknown parent")};
        QWidget *container = m_core->widgetFactory()->containerOfWidget(parent);
        if (!container || !m_core->widgetDataBase()->isContainer(parent))
            throw ProtocolError{QStringLiteral("the target is not a container")};
        const QPoint origin = container->mapTo(fw, QPoint(0, 0));
        fw->beginCommand(QStringLiteral("Move into %1").arg(idOf(parent)));
        try {
            for (const QJsonValue &it : p.value(QLatin1String("items")).toArray()) {
                const QJsonObject o = it.toObject();
                QWidget *w = widgetByName(fw, o.value(QLatin1String("name")).toString());
                const QJsonArray r = o.value(QLatin1String("rect")).toArray();
                if (!w || r.size() != 4 || w == fw->mainContainer())
                    throw ProtocolError{QStringLiteral("bad item")};
                if (container == w || w->isAncestorOf(container))
                    throw ProtocolError{QStringLiteral("a widget cannot be moved into itself")};
                if (w->parentWidget() != container) {
                    auto *cmd = new qdesigner_internal::ReparentWidgetCommand(fw);
                    cmd->init(w, container);
                    fw->commandHistory()->push(cmd);
                }
                const QRect rect(r[0].toInt() - origin.x(), r[1].toInt() - origin.y(), r[2].toInt(), r[3].toInt());
                fw->cursor()->setWidgetProperty(w, QStringLiteral("geometry"), rect);
            }
        } catch (...) {
            fw->endCommand();
            throw;
        }
        fw->endCommand();
        return snapshot(fw);
    }

    /// The engine's own hover step picks the layout cell among the *visible* items, and the form is never shown
    /// here, so do the same choice by hand (nearest widget, never `skip`) and tell the layout where to insert.
    void aimLayoutCell(qdesigner_internal::FormWindowBase *base, QWidget *target, const QPoint &global, QWidget *skip)
    {
        QWidget *container = base->findContainer(target, false);
        if (!container)
            return;
        auto *deco = qt_extension<QDesignerLayoutDecorationExtension *>(m_core->extensionManager(), container);
        if (!deco)
            return;
        const QPoint pt = container->mapFromGlobal(global);
        int best = -1, bestDist = 0;
        for (QWidget *cand : deco->widgets(qdesigner_internal::LayoutInfo::managedLayout(m_core, container))) {
            if (cand == skip)
                continue;
            const int d = (cand->geometry().center() - pt).manhattanLength();
            if (best == -1 || d < bestDist) {
                best = deco->indexOf(cand);
                bestDist = d;
            }
        }
        if (best >= 0)
            deco->adjustIndicator(pt, best);
    }

    /// Drops an existing widget at a form position: into a layout cell, or free in a container. This is the
    /// engine's own move (delete from the old cell, highlight the target cell, insert), so it is one undo step.
    QJsonObject moveWidget(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
        if (!w || w == fw->mainContainer())
            throw ProtocolError{QStringLiteral("unknown widget")};
        const QPoint pos(qRound(p.value(QLatin1String("x")).toDouble()), qRound(p.value(QLatin1String("y")).toDouble()));
        QWidget *target = fw->childAt(pos);
        while (target && (target == w || w->isAncestorOf(target) || !fw->isManaged(target)))
            target = target->parentWidget();
        if (!target)
            target = fw->mainContainer();
        if (target == w || w->isAncestorOf(target))
            throw ProtocolError{QStringLiteral("a widget cannot be moved into itself")};
        auto *base = qobject_cast<qdesigner_internal::FormWindowBase *>(fw);
        if (!base)
            throw ProtocolError{QStringLiteral("form window does not support drops")};
        if (qobject_cast<QScrollArea *>(target) && static_cast<QScrollArea *>(target)->widget() && w->parentWidget() != target)
            throw ProtocolError{QStringLiteral("%1 already has content").arg(idOf(target))};
        const QPoint global = fw->mapToGlobal(pos);
        auto *decoration = new QWidget;
        decoration->setGeometry(QRect(global - QPoint(w->width() / 2, w->height() / 2), w->size()));
        MoveDropItem item(w, decoration, global);
        m_core->formWindowManager()->setActiveFormWindow(fw);
        aimLayoutCell(base, target, global, w);
        const bool ok = base->dropWidgets({&item}, target, global);
        if (!ok)
            throw ProtocolError{QStringLiteral("the engine refused the move to this position")};
        fw->clearSelection(false);
        fw->selectWidget(w, true);
        return snapshot(fw);
    }

    // ---- runtime preview ------------------------------------------------------------------------

    static void applyStyleTree(QWidget *w, QStyle *style, const QPalette *pal)
    {
        w->setStyle(style);
        if (pal)
            w->setPalette(*pal);
        for (QObject *c : w->children())
            if (auto *cw = qobject_cast<QWidget *>(c))
                applyStyleTree(cw, style, pal);
    }

    static QPalette darkPalette()
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

    /// The form as the application will show it (no grid, no design-time widgets), in a chosen style.
    QJsonObject preview(const QJsonObject &p)
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

    // ---- container pages and the engine's own task menu -----------------------------------------

    /// Designer registers its own task menus under an internal id, not the public extension id.
    QDesignerTaskMenuExtension *taskMenuOf(QWidget *w) const
    {
        return qobject_cast<QDesignerTaskMenuExtension *>(m_core->extensionManager()->extension(w, QStringLiteral("QDesignerInternalTaskMenuExtension")));
    }

    QJsonObject taskActions(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
        if (!w)
            throw ProtocolError{QStringLiteral("unknown object")};
        QJsonArray out;
        if (auto *tm = taskMenuOf(w)) {
            const auto acts = tm->taskActions();
            for (int i = 0; i < acts.size(); ++i) {
                QAction *a = acts.at(i);
                out.append(QJsonObject{{QLatin1String("index"), i}, {QLatin1String("text"), a->text().remove(QLatin1Char('&'))},
                                       {QLatin1String("separator"), a->isSeparator()}, {QLatin1String("enabled"), a->isEnabled()},
                                       {QLatin1String("checkable"), a->isCheckable()}, {QLatin1String("checked"), a->isChecked()},
                                       {QLatin1String("hasMenu"), a->menu() != nullptr}});
            }
        }
        return {{QLatin1String("actions"), out}};
    }

    QJsonObject taskAction(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
        auto *tm = w ? taskMenuOf(w) : nullptr;
        if (!tm)
            throw ProtocolError{QStringLiteral("this widget has no task menu")};
        const auto acts = tm->taskActions();
        int i = p.value(QLatin1String("index")).toInt(-1);
        // By caption, so the page does not depend on how the engine numbers a menu that changes with the form.
        if (const QString text = p.value(QLatin1String("text")).toString(); !text.isEmpty()) {
            i = -1;
            for (int k = 0; k < acts.size(); ++k)
                if (!acts.at(k)->isSeparator() && acts.at(k)->text().remove(QLatin1Char('&')) == text) {
                    i = k;
                    break;
                }
        }
        if (i < 0 || i >= acts.size() || acts.at(i)->isSeparator() || !acts.at(i)->isEnabled())
            throw ProtocolError{QStringLiteral("task action unavailable")};
        m_core->formWindowManager()->setActiveFormWindow(fw);
        fw->clearSelection(false);
        fw->selectWidget(w, true);
        acts.at(i)->trigger();
        return snapshot(fw);
    }

    QJsonObject containerInfo(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
        auto *c = w ? qt_extension<QDesignerContainerExtension *>(m_core->extensionManager(), w) : nullptr;
        if (!c)
            return {{QLatin1String("pages"), QJsonArray()}, {QLatin1String("current"), -1}};
        QJsonArray pages;
        for (int i = 0; i < c->count(); ++i)
            pages.append(idOf(c->widget(i)));
        return {{QLatin1String("pages"), pages}, {QLatin1String("current"), c->currentIndex()}};
    }

    /// Adds or removes a page of a tab widget, stacked widget or tool box through Designer's own helpers (undoable).
    QJsonObject pageOp(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
        if (!w)
            throw ProtocolError{QStringLiteral("unknown object")};
        const QString op = p.value(QLatin1String("op")).toString();
        const char *slot = op == QLatin1String("add") ? "addPage" : op == QLatin1String("addAfter") ? "addPageAfter"
                         : op == QLatin1String("remove") ? "removeCurrentPage" : nullptr;
        if (!slot)
            throw ProtocolError{QStringLiteral("unknown page operation")};
        for (QObject *c : w->findChildren<QObject *>(QString(), Qt::FindDirectChildrenOnly)) {
            if (c->metaObject()->indexOfMethod(slot + QByteArray("()")) < 0)
                continue;
            m_core->formWindowManager()->setActiveFormWindow(fw);
            if (QMetaObject::invokeMethod(c, slot)) {
                QCoreApplication::processEvents();
                return snapshot(fw);
            }
        }
        throw ProtocolError{QStringLiteral("this widget has no pages to edit")};
    }

    // ---- signal/slot connections, through the engine's own connection editor -------------------------

    qdesigner_internal::ConnectionEdit *signalSlotEditor(QDesignerFormWindowInterface *fw, int *toolIndex = nullptr) const
    {
        for (int i = 0; i < fw->toolCount(); ++i) {
            QWidget *e = fw->tool(i)->editor();
            auto *edit = qobject_cast<qdesigner_internal::ConnectionEdit *>(e);
            if (edit && QLatin1String(edit->metaObject()->className()).contains(QLatin1String("SignalSlot"))) {
                if (toolIndex)
                    *toolIndex = i;
                return edit;
            }
        }
        throw ProtocolError{QStringLiteral("the signal/slot editor is not available")};
    }

    /// The engine's connection editor keeps raw pointers to its endpoints. When one of them has left the form
    /// without a widgetRemoved() (seen after a drop), any repaint of the editor dereferences freed memory.
    /// Detect it by pointer comparison only, and refuse instead of crashing.
    static bool hasStaleConnection(QDesignerFormWindowInterface *fw, qdesigner_internal::ConnectionEdit *edit)
    {
        if (edit->connectionCount() == 0)
            return false;
        const auto all = fw->mainContainer()->findChildren<QObject *>();
        for (int i = 0; i < edit->connectionCount(); ++i) {
            for (auto t : {qdesigner_internal::CETypes::EndPoint::Source, qdesigner_internal::CETypes::EndPoint::Target}) {
                QObject *o = edit->connection(i)->object(t);
                if (o != fw->mainContainer() && !all.contains(o))
                    return true;
            }
        }
        return false;
    }

    static void refuseStaleConnections(QDesignerFormWindowInterface *fw, qdesigner_internal::ConnectionEdit *edit)
    {
        if (hasStaleConnection(fw, edit))
            throw ProtocolError{QStringLiteral("a connection refers to a widget that no longer exists; undo to the state before it or reopen the form")};
    }

    static void sendMouse(QWidget *w, QEvent::Type type, const QPoint &local, Qt::MouseButton button, Qt::MouseButtons buttons)
    {
        QMouseEvent ev(type, QPointF(local), QPointF(w->mapToGlobal(local)), QPointF(w->mapToGlobal(local)), button, buttons, Qt::NoModifier);
        QCoreApplication::sendEvent(w, &ev);
    }

    QJsonObject connectWidgets(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QWidget *a = widgetByName(fw, p.value(QLatin1String("sender")).toString());
        QWidget *b = widgetByName(fw, p.value(QLatin1String("receiver")).toString());
        if (!a || !b)
            throw ProtocolError{QStringLiteral("unknown sender or receiver")};
        int toolIndex = 0;
        auto *edit = signalSlotEditor(fw, &toolIndex);
        const int previousTool = fw->currentTool();
        refuseStaleConnections(fw, edit);
        ConnectPlan plan{p.value(QLatin1String("signal")).toString(), p.value(QLatin1String("slot")).toString()};
        m_core->formWindowManager()->setActiveFormWindow(fw);
        fw->setCurrentTool(toolIndex);
        QCoreApplication::processEvents();
        const int before = edit->connectionCount();
        // Existing connections anchor at the widget centre: grabbing there would drag that anchor instead of
        // starting a new connection, so pick a spot in the widget that no anchor occupies.
        QList<QPoint> anchors;
        for (int i = 0; i < edit->connectionCount(); ++i) {
            anchors << edit->connection(i)->endPointPos(qdesigner_internal::CETypes::EndPoint::Source)
                    << edit->connection(i)->endPointPos(qdesigner_internal::CETypes::EndPoint::Target);
        }
        auto pointOf = [&](QWidget *w) {
            const QRect r = w->rect().adjusted(3, 3, -3, -3);
            QList<QPoint> candidates{r.center()};
            for (int ring = 1; ring <= 6; ++ring) {
                for (int dx : {-1, 0, 1}) {
                    for (int dy : {-1, 0, 1}) {
                        if (dx || dy)
                            candidates << QPoint(r.center().x() + dx * ring * 12, r.center().y() + dy * ring * 6);
                    }
                }
            }
            for (const QPoint &c : std::as_const(candidates)) {
                if (!r.contains(c))
                    continue;
                const QPoint g = edit->mapFromGlobal(w->mapToGlobal(c));
                const bool taken = std::any_of(anchors.cbegin(), anchors.cend(), [&](const QPoint &a2) { return (a2 - g).manhattanLength() < 16; });
                if (!taken)
                    return g;
            }
            return edit->mapFromGlobal(w->mapToGlobal(r.center()));
        };
        const QPoint pa = pointOf(a), pb = pointOf(b);
        g_connectPlan = &plan;
        sendMouse(edit, QEvent::MouseMove, pa, Qt::NoButton, Qt::NoButton);
        sendMouse(edit, QEvent::MouseButtonPress, pa, Qt::LeftButton, Qt::LeftButton);
        sendMouse(edit, QEvent::MouseMove, pa + QPoint(3, 3), Qt::NoButton, Qt::LeftButton);
        sendMouse(edit, QEvent::MouseMove, pb, Qt::NoButton, Qt::LeftButton);
        sendMouse(edit, QEvent::MouseButtonRelease, pb, Qt::LeftButton, Qt::NoButton); // opens the dialog (nested loop)
        g_connectPlan = nullptr;
        fw->setCurrentTool(previousTool);
        QCoreApplication::processEvents();
        if (plan.failed)
            throw ProtocolError{QStringLiteral("%1 cannot connect %2 to %3").arg(idOf(a), plan.signal, plan.slot)};
        if (!plan.done || edit->connectionCount() != before + 1)
            throw ProtocolError{QStringLiteral("the connection could not be created")};
        // Another widget stacked over the chosen spot may have caught the drag: never keep a connection between
        // different widgets than the ones asked for.
        {
            auto *created = edit->connection(edit->connectionCount() - 1);
            if (created->object(qdesigner_internal::CETypes::EndPoint::Source) != a
                || created->object(qdesigner_internal::CETypes::EndPoint::Target) != b) {
                fw->commandHistory()->undo();
                throw ProtocolError{QStringLiteral("the connection landed on other widgets (covered by a sibling); nothing was changed")};
            }
        }
        return snapshot(fw);
    }

    QJsonObject disconnectWidgets(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        auto *edit = signalSlotEditor(fw);
        const QString sender = p.value(QLatin1String("sender")).toString(), receiver = p.value(QLatin1String("receiver")).toString();
        const QString signal = p.value(QLatin1String("signal")).toString(), slot = p.value(QLatin1String("slot")).toString();
        for (int i = 0; i < edit->connectionCount(); ++i) {
            auto *con = edit->connection(i);
            if (idOf(con->object(qdesigner_internal::CETypes::EndPoint::Source)) == sender
                && idOf(con->object(qdesigner_internal::CETypes::EndPoint::Target)) == receiver
                && con->label(qdesigner_internal::CETypes::EndPoint::Source) == signal
                && con->label(qdesigner_internal::CETypes::EndPoint::Target) == slot) {
                edit->selectNone();
                edit->setSelected(con, true);
                edit->deleteSelected();
                return snapshot(fw);
            }
        }
        throw ProtocolError{QStringLiteral("no such connection")};
    }

    /// The undo stack as a list, newest last, so the page can offer "go back to this state".
    QJsonObject history(const QJsonObject &p)
    {
        QUndoStack *stack = form(p)->commandHistory();
        QJsonArray items;
        for (int i = 0; i < stack->count(); ++i)
            items.append(stack->text(i));
        return {{QLatin1String("items"), items}, {QLatin1String("index"), stack->index()}};
    }

    QJsonObject setCurrentPage(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QWidget *w = widgetByName(fw, p.value(QLatin1String("name")).toString());
        auto *c = w ? qt_extension<QDesignerContainerExtension *>(m_core->extensionManager(), w) : nullptr;
        const int i = p.value(QLatin1String("index")).toInt(-1);
        if (!c || i < 0 || i >= c->count())
            throw ProtocolError{QStringLiteral("bad page")};
        c->setCurrentIndex(i);
        return snapshot(fw);
    }

    // ---- tab order, promotion, form settings -----------------------------------------------------

    QWidgetList currentTabOrder(QDesignerFormWindowInterface *fw) const
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

    QJsonObject tabOrder(const QJsonObject &p)
    {
        QDesignerFormWindowInterface *fw = form(p);
        QJsonArray names;
        for (QWidget *w : currentTabOrder(fw))
            names.append(idOf(w));
        return {{QLatin1String("order"), names}};
    }

    QJsonObject setTabOrder(const QJsonObject &p)
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

    QJsonObject promote(const QJsonObject &p)
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

    QJsonObject demote(const QJsonObject &p)
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

    QJsonObject formInfo(const QJsonObject &p)
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

    QJsonObject setFormInfo(const QJsonObject &p)
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

    QJsonObject addDynamicProperty(const QJsonObject &p)
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

    QJsonObject removeDynamicProperty(const QJsonObject &p)
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

    QDesignerFormEditorInterface *m_core = nullptr;
    QHash<QString, QDesignerFormWindowInterface *> m_forms;
    QHash<QDesignerFormWindowInterface *, qreal> m_scales;
    QSet<QDesignerFormWindowInterface *> m_gestures;
};

void writeLine(const QJsonObject &o)
{
    const QByteArray line = QJsonDocument(o).toJson(QJsonDocument::Compact) + '\n';
    std::fwrite(line.constData(), 1, size_t(line.size()), stdout);
    std::fflush(stdout);
}

} // namespace

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
    Host host(&app);
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
                    if (!pendingMessages().isEmpty())
                        result.insert(QLatin1String("messages"), QJsonArray::fromStringList(pendingMessages()));
                    resp.insert(QLatin1String("result"), result);
                } catch (const ProtocolError &e) {
                    resp.insert(QLatin1String("error"), e.message);
                }
                pendingMessages().clear();
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
