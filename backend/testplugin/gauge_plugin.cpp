#include <QtDesigner/QDesignerCustomWidgetInterface>
#include <QLabel>
#include <QPainter>
#include <QtPlugin>

class Gauge : public QLabel
{
    Q_OBJECT
    Q_PROPERTY(int level READ level WRITE setLevel)
public:
    explicit Gauge(QWidget *parent = nullptr) : QLabel(parent) { setText(QStringLiteral("Gauge")); setFrameShape(QFrame::Box); }
    int level() const { return m_level; }
    void setLevel(int v) { m_level = v; setText(QStringLiteral("Gauge %1").arg(v)); }
private:
    int m_level = 0;
};

class DemoPlugin : public QObject, public QDesignerCustomWidgetInterface
{
    Q_OBJECT
    Q_PLUGIN_METADATA(IID "org.qt-project.Qt.QDesignerCustomWidgetInterface")
    Q_INTERFACES(QDesignerCustomWidgetInterface)
public:
    explicit DemoPlugin(QObject *parent = nullptr) : QObject(parent) {}
    QString name() const override { return QStringLiteral("Gauge"); }
    QString group() const override { return QStringLiteral("Demo Widgets"); }
    QString toolTip() const override { return QStringLiteral("A demo gauge"); }
    QString whatsThis() const override { return QString(); }
    QString includeFile() const override { return QStringLiteral("gauge.h"); }
    QIcon icon() const override { return QIcon(); }
    bool isContainer() const override { return false; }
    QWidget *createWidget(QWidget *parent) override { return new Gauge(parent); }
    QString domXml() const override { return QStringLiteral("<ui language=\"c++\"><widget class=\"Gauge\" name=\"gauge\"><property name=\"geometry\"><rect><x>0</x><y>0</y><width>100</width><height>30</height></rect></property></widget></ui>"); }
};

#include "gauge_plugin.moc"
