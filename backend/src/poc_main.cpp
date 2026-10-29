// Proof of feasibility: drive the real QtDesigner form engine headlessly.
// Load a .ui, grab a render, change a property through the undo stack, save.
#include <QtDesigner/QDesignerComponents>
#include <QtDesigner/QDesignerFormEditorInterface>
#include <QtDesigner/QDesignerFormWindowInterface>
#include <QtDesigner/QDesignerFormWindowManagerInterface>
#include <QtDesigner/QDesignerFormWindowCursorInterface>
#include <QtDesigner/QDesignerIntegration>
#include <QtDesigner/QDesignerWidgetBoxInterface>
#include <QtDesigner/QDesignerPropertyEditorInterface>
#include <QtDesigner/QDesignerObjectInspectorInterface>
#include <QtDesigner/QDesignerActionEditorInterface>

#include <QtDesigner/QDesignerFormEditorPluginInterface>
#include <QApplication>
#include <cstdlib>
#include <QPluginLoader>
#include <QFile>
#include <QTextStream>
#include <QUndoStack>

int main(int argc, char **argv)
{
    QApplication app(argc, argv);
    QTextStream out(stdout);
    if (argc < 4) {
        out << "usage: poc <in.ui> <out.png> <out.ui>\n";
        return 2;
    }

    QDesignerFormEditorInterface *core = QDesignerComponents::createFormEditor(&app);
    QDesignerComponents::createTaskMenu(core, &app);
    QDesignerComponents::initializeResources();
    // Panels are created (never shown) because the engine expects them on the core.
    core->setWidgetBox(QDesignerComponents::createWidgetBox(core, nullptr));
    core->setPropertyEditor(QDesignerComponents::createPropertyEditor(core, nullptr));
    core->setObjectInspector(QDesignerComponents::createObjectInspector(core, nullptr));
    core->setActionEditor(QDesignerComponents::createActionEditor(core, nullptr));
    QDesignerComponents::initializePlugins(core);
    // Mirrors QDesignerWorkbench::initializeCorePlugins(): the signal/slot, buddy and
    // tab order editors are static form-editor plugins that must be initialised.
    for (QObject *plugin : QPluginLoader::staticInstances()) {
        if (auto *p = qobject_cast<QDesignerFormEditorPluginInterface *>(plugin)) {
            if (!p->isInitialized())
                p->initialize(core);
        }
    }
    new QDesignerIntegration(core, &app);

    QDesignerFormWindowInterface *fw = core->formWindowManager()->createFormWindow();
    QFile f(argv[1]);
    if (!f.open(QIODevice::ReadOnly)) { out << "cannot open input\n"; return 1; }
    fw->setFileName(argv[1]);
    QString err;
    if (!fw->setContents(&f, &err)) { out << "load failed: " << err << "\n"; return 1; }
    core->formWindowManager()->setActiveFormWindow(fw);
    out << "main container size right after load: " << fw->mainContainer()->width() << "x"
        << fw->mainContainer()->height() << "\n";
    if (qEnvironmentVariableIsSet("POC_RESIZE")) // host sizes the FormWindow to the form's own size
        fw->resize(fw->mainContainer()->size());
    out << "loaded, main container class: " << fw->mainContainer()->metaObject()->className()
        << ", dirty=" << fw->isDirty() << "\n";

    // Render: this is the real FormWindow widget tree, rendered offscreen.
    if (qEnvironmentVariableIsSet("POC_SHOW")) fw->show();
    const QPixmap px = fw->grab();
    out << "grab: " << px.width() << "x" << px.height() << " saved=" << px.save(argv[2]) << "\n";

    // Property change through the engine's command (undoable).
    QWidget *button = fw->mainContainer()->findChild<QWidget *>("okButton");
    if (!qEnvironmentVariableIsSet("POC_NOOP")) {
        if (!button) { out << "okButton not found\n"; return 1; }
        fw->cursor()->setWidgetProperty(button, "text", QStringLiteral("Valider"));
    }
    out << "after set: dirty=" << fw->isDirty()
        << " undoText='" << fw->commandHistory()->undoText() << "'"
        << " count=" << fw->commandHistory()->count() << "\n";

    QFile o(argv[3]);
    if (!o.open(QIODevice::WriteOnly)) { out << "cannot write output\n"; return 1; }
    o.write(fw->contents().toUtf8());
    o.close();
    out << "saved " << argv[3] << "\n";
    out.flush();
    // KNOWN ISSUE: normal teardown of QApplication + FormEditor segfaults (exit 139). Skipped in the PoC.
    std::_Exit(0);
}
