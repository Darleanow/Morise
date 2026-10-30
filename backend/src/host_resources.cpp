#include "host.h"

namespace qdr {

namespace {

/// Adding or removing a resource file is not an undo step in the engine itself; this makes it one.
class ResourceFileCommand : public QUndoCommand
{
public:
    ResourceFileCommand(QDesignerFormWindowInterface *fw, const QString &stored, bool add)
        : QUndoCommand(add ? QStringLiteral("Add resource file") : QStringLiteral("Remove resource file")), m_fw(fw), m_stored(stored), m_add(add) {}
    void redo() override { apply(m_add); }
    void undo() override { apply(!m_add); }

private:
    void apply(bool add)
    {
        if (!m_fw)
            return;
        QtResourceModel *model = m_fw->core()->resourceModel();
        if (!m_fw->resourceSet() && model) {
            auto *set = model->addResourceSet({});
            m_fw->setResourceSet(set);
        }
        const QString abs = QFileInfo(m_stored).isRelative() ? m_fw->absoluteDir().absoluteFilePath(m_stored) : m_stored;
        const QString clean = QDir::cleanPath(abs);
        if (add)
            m_fw->addResourceFile(m_stored);
        else
            m_fw->removeResourceFile(m_stored);
        // What the engine saves and resolves icons against is the resource set, not the plain list.
        if (m_fw->resourceSet()) {
            QStringList active = m_fw->activeResourceFilePaths();
            active.removeAll(clean);
            if (add)
                active << clean;
            m_fw->activateResourceFilePaths(active);
        }
    }
    QPointer<QDesignerFormWindowInterface> m_fw;
    QString m_stored;
    bool m_add;
};

QJsonObject describeQrc(const QString &path)
{
    QJsonArray prefixes;
    QFile f(path);
    const bool exists = f.open(QIODevice::ReadOnly);
    if (exists) {
        QXmlStreamReader xml(&f);
        QString prefix;
        QJsonArray files, thumbs;
        int shown = 0; // thumbnails are capped: a big resource file must not make every refresh slow
        const QDir dir = QFileInfo(path).absoluteDir();
        bool inFile = false;
        while (!xml.atEnd() && !xml.hasError()) {
            xml.readNext();
            if (xml.isStartElement() && xml.name() == QLatin1String("qresource")) {
                prefix = xml.attributes().value(QLatin1String("prefix")).toString();
                files = QJsonArray();
                thumbs = QJsonArray();
            } else if (xml.isStartElement() && xml.name() == QLatin1String("file")) {
                const QString alias = xml.attributes().value(QLatin1String("alias")).toString();
                const QString text = xml.readElementText();
                files.append(alias.isEmpty() ? text : alias);
                QString thumb;
                if (shown < 120) {
                    QImage img(dir.absoluteFilePath(text));
                    if (!img.isNull()) {
                        ++shown;
                        QBuffer buf;
                        buf.open(QIODevice::WriteOnly);
                        img.scaled(32, 32, Qt::KeepAspectRatio, Qt::SmoothTransformation).save(&buf, "PNG");
                        thumb = QStringLiteral("data:image/png;base64,") + QString::fromLatin1(buf.data().toBase64());
                    }
                }
                thumbs.append(thumb);
                inFile = true;
            } else if (xml.isEndElement() && xml.name() == QLatin1String("qresource")) {
                prefixes.append(QJsonObject{{QLatin1String("prefix"), prefix}, {QLatin1String("files"), files}, {QLatin1String("thumbs"), thumbs}});
            }
        }
        Q_UNUSED(inFile);
    }
    return {{QLatin1String("path"), path}, {QLatin1String("exists"), exists}, {QLatin1String("prefixes"), prefixes}};
}

} // namespace

/// The resource files the form uses with what they contain, so the page can offer their icons.
QJsonObject Host::resources(const QJsonObject &p)
{
    QDesignerFormWindowInterface *fw = form(p);
    QJsonArray files;
    for (const QString &path : fw->resourceFiles()) {
        const QString abs = QFileInfo(path).isRelative() ? fw->absoluteDir().absoluteFilePath(path) : path;
        QJsonObject o = describeQrc(abs);
        o.insert(QLatin1String("path"), path);
        files.append(o);
    }
    return {{QLatin1String("files"), files}};
}

QJsonObject Host::changeResource(const QJsonObject &p, bool add)
{
    QDesignerFormWindowInterface *fw = form(p);
    const QString path = p.value(QLatin1String("path")).toString();
    if (path.isEmpty())
        throw ProtocolError{QStringLiteral("a resource file needs a path")};
    if (add && !QFileInfo::exists(QFileInfo(path).isRelative() ? fw->absoluteDir().absoluteFilePath(path) : path))
        throw ProtocolError{QStringLiteral("the resource file does not exist: ") + path};
    if (add == fw->resourceFiles().contains(path))
        return snapshot(fw);
    // Stored the way Designer saves it: relative to the form when the form has a place on disk.
    QString stored = path;
    if (add && !fw->fileName().isEmpty() && QFileInfo(path).isAbsolute())
        stored = fw->absoluteDir().relativeFilePath(path);
    auto *cmd = new ResourceFileCommand(fw, add ? stored : path, add);
    fw->commandHistory()->push(cmd);
    return snapshot(fw);
}

} // namespace qdr
