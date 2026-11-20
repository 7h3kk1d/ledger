// The JS side of FileStore: Ledger's FileStorageAdapter (src/store/fileStorage.ts) calls these
// through Capacitor as `Capacitor.Plugins.LedgerFiles`. Data crosses the bridge as base64.
import Capacitor
import Foundation

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
}
