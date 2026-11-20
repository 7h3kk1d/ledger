// The JS side of FileStore: Ledger's FileStorageAdapter (src/store/fileStorage.ts) calls these
// through Capacitor as `Capacitor.Plugins.LedgerFiles`. Data crosses the bridge as base64.
import Capacitor
import Foundation
import WidgetKit

@objc(LedgerFilesPlugin)
public class LedgerFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LedgerFilesPlugin"
    public let jsName = "LedgerFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadRange", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeRange", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "location", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publishWidget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeWidgetChanges", returnType: CAPPluginReturnPromise),
    ]

    private let store = FileStore(root: FileStore.defaultRoot())
    /// One at a time, in the order JS asked: automerge-repo expects its writes to land in order.
    private let queue = DispatchQueue(label: "me.bandukwala.Ledger.files")

    private func key(_ call: CAPPluginCall, _ name: String) -> [String]? {
        guard let key = call.getArray(name, String.self) else {
            call.reject("\(name) must be an array of strings")
            return nil
        }
        return key
    }

    private func run(_ call: CAPPluginCall, _ body: @escaping () throws -> [String: Any]) {
        queue.async {
            do { call.resolve(try body()) } catch { call.reject("\(call.methodName): \(error.localizedDescription)") }
        }
    }

    @objc func load(_ call: CAPPluginCall) {
        guard let key = key(call, "key") else { return }
        run(call) { try self.store.load(key).map { ["data": $0.base64EncodedString()] } ?? [:] }
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let key = key(call, "key") else { return }
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("data must be base64")
            return
        }
        run(call) { try self.store.save(key, data); return [:] }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = key(call, "key") else { return }
        run(call) { try self.store.remove(key); return [:] }
    }

    @objc func loadRange(_ call: CAPPluginCall) {
        guard let prefix = key(call, "prefix") else { return }
        run(call) {
            ["chunks": try self.store.loadRange(prefix).map { ["key": $0.key, "data": $0.data.base64EncodedString()] }]
        }
    }

    @objc func removeRange(_ call: CAPPluginCall) {
        guard let prefix = key(call, "prefix") else { return }
        run(call) { try self.store.removeRange(prefix); return [:] }
    }

    /// Where the files are, for a settings line and for tests.
    @objc func location(_ call: CAPPluginCall) {
        call.resolve(["path": store.root.path])
    }

    /// Ledger's JS hands over today's rows (widget.json); the widget redraws from them.
    @objc func publishWidget(_ call: CAPPluginCall) {
        guard let json = call.getString("snapshot"), let data = json.data(using: .utf8) else {
            call.reject("snapshot must be a JSON string")
            return
        }
        run(call) {
            try FileManager.default.createDirectory(at: WidgetFiles.container, withIntermediateDirectories: true)
            try data.write(to: WidgetFiles.snapshot, options: .atomic)
            WidgetCenter.shared.reloadAllTimelines()
            return [:]
        }
    }

    /// The changes the widget made since last asked (widget-changes/<docId>/*), handed over once:
    /// Ledger applies them to the open doc, which then saves and syncs them as its own.
    @objc func takeWidgetChanges(_ call: CAPPluginCall) {
        run(call) {
            let fm = FileManager.default
            var out: [[String: Any]] = []
            for docDir in (try? fm.contentsOfDirectory(at: WidgetFiles.changes, includingPropertiesForKeys: nil)) ?? [] {
                let files = ((try? fm.contentsOfDirectory(at: docDir, includingPropertiesForKeys: [.creationDateKey])) ?? [])
                    .sorted { a, b in a.lastPathComponent < b.lastPathComponent }
                for file in files {
                    out.append(["docId": docDir.lastPathComponent, "data": try Data(contentsOf: file).base64EncodedString()])
                    try fm.removeItem(at: file)
                }
            }
            return ["changes": out]
        }
    }
}
