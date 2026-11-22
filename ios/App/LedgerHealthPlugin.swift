// HealthKit for Ledger's JS (`Capacitor.Plugins.LedgerHealth`): connect, read what's new into the
// outbox and push it to a receiver (App/Health/, spec/healthkit-batch.md).
import Capacitor
import Foundation

@objc(LedgerHealthPlugin)
public class LedgerHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LedgerHealthPlugin"
    public let jsName = "LedgerHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seed", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recent", returnType: CAPPluginReturnPromise),
    ]

    private func answer(_ call: CAPPluginCall, _ s: HealthSync.Status) {
        let iso = ISO8601DateFormatter()
        var out: [String: Any] = ["available": s.available, "asked": s.asked, "newKinds": s.newKinds, "waiting": s.waiting, "hasToken": s.hasToken,
                                  "rejected": s.rejected]
        if let v = s.lastRead { out["lastRead"] = iso.string(from: v) }
        if let v = s.lastReadCount { out["lastReadCount"] = v }
        if let v = s.lastReadError { out["lastReadError"] = v }
        if let v = s.pushUrl { out["pushUrl"] = v }
        if let v = s.lastPushAt { out["lastPushAt"] = iso.string(from: v) }
        if let v = s.lastPushCount { out["lastPushCount"] = v }
        if let v = s.lastPushError { out["lastPushError"] = v }
        call.resolve(out)
    }

    @objc func status(_ call: CAPPluginCall) {
        Task { answer(call, await HealthSync.shared.status()) }
    }

    @objc func authorize(_ call: CAPPluginCall) {
        Task {
            do {
                try await HealthSync.shared.authorize()
                answer(call, await HealthSync.shared.sync())
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func sync(_ call: CAPPluginCall) {
        Task { answer(call, await HealthSync.shared.sync()) }
    }

    /// url: "" turns pushing off; token: omitted keeps the stored one, "" removes it.
    @objc func setPush(_ call: CAPPluginCall) {
        Task {
            do {
                try await HealthSync.shared.setPush(url: call.getString("url"), token: call.getString("token"))
                answer(call, await HealthSync.shared.status())
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    /// days: how far back (default 14). Read straight from HealthKit; works offline.
    @objc func recent(_ call: CAPPluginCall) {
        let days = max(1, min(call.getInt("days") ?? 14, 60))
        Task {
            do {
                call.resolve(try await HealthRecent.read(store: HealthSync.shared.store, days: days).dictionary())
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func seed(_ call: CAPPluginCall) {
        #if DEBUG
        Task {
            do {
                try await HealthSync.shared.seed()
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
        #else
        call.reject("only in debug builds")
        #endif
    }
}
