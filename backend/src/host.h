#pragma once
// The Qt host around Designer's form engine. The class is declared here; its methods are grouped by concern in
// host_*.cpp (core, values, contents, geometry, preview, tasks, connections, forms).
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
#include <QtDesigner/private/qtresourcemodel_p.h>
#include <QtDesigner/private/qdesigner_menu_p.h>
#include <QtDesigner/private/qdesigner_menubar_p.h>
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
#include <QLineEdit>
#include <QEnterEvent>
#include <QPointer>
#include <QWheelEvent>
#include <QUndoCommand>
#include <QXmlStreamReader>
#include <QDockWidget>
#include <QListWidget>
#include <QMainWindow>
#include <QStatusBar>
#include <QToolBar>
#include <QMenuBar>
#include <QScrollArea>
#include <QMenu>
#include <QLayout>
#include <QEnterEvent>
#include <QPointer>
#include <QWheelEvent>
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


namespace qdr {

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

// Answers the engine's connect dialog on behalf of the page: the signal and slot were chosen in the page.
struct ConnectPlan {
    QString signal, slot;
    bool done = false;
    bool failed = false;
};
extern ConnectPlan *g_connectPlan;

QStringList &pendingMessages();
QDesignerDialogGuiInterface *createHeadlessDialogGui();
void installModalGuard(QObject *parent);

struct ProtocolError {
    QString message;
};

/// The name the page uses for a widget. Spacers have no objectName in Designer: their name is `spacerName`.
inline QString idOf(const QObject *o)
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
    explicit Host(QObject *parent);

    QJsonObject handle(const QString &method, const QJsonObject &p);

private:
    QDesignerFormWindowInterface *form(const QJsonObject &p) const;

    /// A widget the page lists: the managed ones, plus the parts of a main window Designer shows in its object
    /// inspector without managing them (menu bar, tool bars, status bar, central widget).
    bool listed(QDesignerFormWindowInterface *fw, QWidget *w) const;

    QWidget *widgetByName(QDesignerFormWindowInterface *fw, const QString &name) const;

    /// A widget, or a layout (Designer lists layouts as objects with their own property sheet).
    QObject *objectByName(QDesignerFormWindowInterface *fw, const QString &name) const;

    /// Old forms can hold spacers (or other widgets) without a name; the page addresses objects by name.
    void nameUnnamedWidgets(QDesignerFormWindowInterface *fw) const;

    QJsonObject open(const QJsonObject &p);

    // A drag is one undo step: its many live geometry commands are grouped into a single macro. Without it,
    // Designer merges consecutive commands on the same property, even across separate gestures.
    void endGesture(QDesignerFormWindowInterface *fw);

    QJsonObject gestureCmd(const QJsonObject &p);

    QJsonObject close(const QJsonObject &p);

    QJsonObject contents(const QJsonObject &p);

    QJsonObject snapshot(QDesignerFormWindowInterface *fw);

    struct ActionDef { const char *name; QDesignerFormWindowManagerInterface::Action id; };
    static const std::vector<ActionDef> &actionDefs();

    static QString iconDataUrl(const QIcon &icon, int size = 20);

    QJsonObject palette();

    // Signals and slots a widget offers, from its QMetaObject: what a developer needs to wire it up.
    QJsonObject describe(const QJsonObject &p);

    // Connections as stored in the document, read from the engine's own serialisation.
    QJsonObject connections(const QJsonObject &p);

    QJsonObject addWidget(const QJsonObject &p);

    QJsonObject action(const QJsonObject &p);

    QJsonObject select(const QJsonObject &p);

    QJsonObject hitTest(const QJsonObject &p);

    // ---- property values: engine types <-> JSON ------------------------------------------------

    static QJsonArray stringsToJson(const QStringList &l) { return QJsonArray::fromStringList(l); }

    static QStringList jsonToStrings(const QJsonValue &v);

    static QStringList enumKeys(const QMetaEnum &me);

    QString thumbnailFor(QDesignerFormWindowInterface *fw, const QString &path) const;

    QJsonObject describeValue(const QVariant &v, QDesignerFormWindowInterface *fw) const;

    static QJsonArray numbers(const QJsonValue &v) { return v.toArray(); }

    /// Builds the value to give the engine from the JSON the page sent, using the current value as a template.
    QVariant parseValue(const QVariant &current, const QJsonValue &val) const;

    QDesignerPropertySheetExtension *sheetOf(QObject *o) const;

    QObject *requireObject(QDesignerFormWindowInterface *fw, const QString &name) const;

    QJsonObject properties(const QJsonObject &p);

    /// Item captions of a combo box or list widget (null when the object has no editable item list).
    static QJsonValue itemTexts(QObject *o);

    /// Replaces the captions of a combo box or list widget through the engine's own command, keeping the
    /// icons and other roles of the items whose caption is unchanged at the same place.
    QJsonObject setItems(const QJsonObject &p);


    // ---- tree and table widget contents (columns, rows, cells), through the engine's own commands ----

    static QJsonArray textsOf(const QTreeWidgetItem *it, int columns);

    static QJsonArray treeItems(const QTreeWidget *t, const QTreeWidgetItem *parent);

    /// Editable contents of a QTreeWidget or QTableWidget, or null for other objects.
    static QJsonValue gridContents(QObject *o);

    /// An item with the given caption: the old item's other roles are kept when the caption is unchanged or renamed.
    static qdesigner_internal::ItemData itemWith(const QString &text, const qdesigner_internal::ItemData *old);

    static qdesigner_internal::ListContents headerWith(const QJsonArray &texts, const qdesigner_internal::ListContents &old);

    static qdesigner_internal::TreeWidgetContents::ItemContents treeItemFrom(const QJsonObject &o, int columns, const qdesigner_internal::TreeWidgetContents::ItemContents *old);

    QJsonObject setContents(const QJsonObject &p);
    QJsonObject addMenu(const QJsonObject &p);
    QJsonObject resources(const QJsonObject &p);
    QJsonObject changeResource(const QJsonObject &p, bool add);
    QJsonObject removeMenuEntry(const QJsonObject &p);
    static QJsonValue menusOf(QObject *o);
    QJsonObject addMenuEntry(const QJsonObject &p);

    /// Targets of an edit: `names` (multi-selection) or the single `name`.
    QObjectList targets(QDesignerFormWindowInterface *fw, const QJsonObject &p) const;

    QJsonObject setProperty(const QJsonObject &p);

    QJsonObject resetProperty(const QJsonObject &p);

    // ---- geometry by batch, reparenting, duplicates --------------------------------------------

    QJsonObject setGeometries(const QJsonObject &p);

    /// Moves widgets into another container, as dropping them on it does in Designer. Rects are in form pixels.
    QJsonObject reparent(const QJsonObject &p);

    /// The engine's own hover step picks the layout cell among the *visible* items, and the form is never shown
    /// here, so do the same choice by hand (nearest widget, never `skip`) and tell the layout where to insert.
    void aimLayoutCell(qdesigner_internal::FormWindowBase *base, QWidget *target, const QPoint &global, QWidget *skip, const QString &side = QString());

    /// Drops an existing widget at a form position: into a layout cell, or free in a container. This is the
    /// engine's own move (delete from the old cell, highlight the target cell, insert), so it is one undo step.
    QJsonObject moveWidget(const QJsonObject &p);

    // ---- runtime preview ------------------------------------------------------------------------

    static void applyStyleTree(QWidget *w, QStyle *style, const QPalette *pal);

    static QPalette darkPalette();

    /// The form as the application will show it (no grid, no design-time widgets), in a chosen style.
    QJsonObject preview(const QJsonObject &p);
    QJsonObject previewEvent(const QJsonObject &p);
    QJsonObject previewStop(const QJsonObject &p);
    QJsonObject previewFrame(const QString &docId, const QSize &size) const;

    // ---- container pages and the engine's own task menu -----------------------------------------

    /// Designer registers its own task menus under an internal id, not the public extension id.
    QDesignerTaskMenuExtension *taskMenuOf(QWidget *w) const;
    QJsonArray taskTree(QWidget *w) const;

    QJsonObject taskActions(const QJsonObject &p);

    QJsonObject taskAction(const QJsonObject &p);

    QJsonObject containerInfo(const QJsonObject &p);

    /// Adds or removes a page of a tab widget, stacked widget or tool box through Designer's own helpers (undoable).
    QJsonObject pageOp(const QJsonObject &p);

    // ---- signal/slot connections, through the engine's own connection editor -------------------------

    qdesigner_internal::ConnectionEdit *signalSlotEditor(QDesignerFormWindowInterface *fw, int *toolIndex = nullptr) const;

    /// The engine's connection editor keeps raw pointers to its endpoints. When one of them has left the form
    /// without a widgetRemoved() (seen after a drop), any repaint of the editor dereferences freed memory.
    /// Detect it by pointer comparison only, and refuse instead of crashing.
    static bool hasStaleConnection(QDesignerFormWindowInterface *fw, qdesigner_internal::ConnectionEdit *edit);

    static void refuseStaleConnections(QDesignerFormWindowInterface *fw, qdesigner_internal::ConnectionEdit *edit);

    static void sendMouse(QWidget *w, QEvent::Type type, const QPoint &local, Qt::MouseButton button, Qt::MouseButtons buttons);

    QJsonObject connectWidgets(const QJsonObject &p);

    QJsonObject disconnectWidgets(const QJsonObject &p);

    /// The undo stack as a list, newest last, so the page can offer "go back to this state".
    QJsonObject history(const QJsonObject &p);

    QJsonObject setCurrentPage(const QJsonObject &p);

    // ---- tab order, promotion, form settings -----------------------------------------------------

    QWidgetList currentTabOrder(QDesignerFormWindowInterface *fw) const;

    QJsonObject tabOrder(const QJsonObject &p);

    QJsonObject setTabOrder(const QJsonObject &p);

    QJsonObject promote(const QJsonObject &p);

    QJsonObject demote(const QJsonObject &p);

    QJsonObject formInfo(const QJsonObject &p);

    QJsonObject setFormInfo(const QJsonObject &p);

    QJsonObject addDynamicProperty(const QJsonObject &p);

    QJsonObject removeDynamicProperty(const QJsonObject &p);

    QDesignerFormEditorInterface *m_core = nullptr;
    QHash<QString, QDesignerFormWindowInterface *> m_forms;
    QHash<QDesignerFormWindowInterface *, qreal> m_scales;
    QSet<QDesignerFormWindowInterface *> m_gestures;

    /// The form as the application builds it, kept alive so the page can click, type and scroll in it.
    struct PreviewSession {
        QPointer<QWidget> root;
        QPointer<QWidget> pressed;
        QPointer<QWidget> focus;
        QPointer<QWidget> hover;
        qreal scale = 1;
    };
    QHash<QString, PreviewSession> m_previews;
};

} // namespace qdr
