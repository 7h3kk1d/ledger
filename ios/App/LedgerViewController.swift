import Capacitor
import UIKit
import WebKit

/// Capacitor's web view running Ledger's own build, plus the app's native plugins.
class LedgerViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LedgerFilesPlugin())
        bridge?.registerPluginInstance(LedgerHealthPlugin())
        Task { await HealthSync.shared.watchNetwork() }
        #if DEBUG
        // simulator tests (UITests/HealthUITests): seed sample data, then read it into the outbox
        if UserDefaults.standard.bool(forKey: "healthSelfTest") {
            Task {
                try? await HealthSync.shared.seed()
                _ = await HealthSync.shared.sync()
                // what the on-device signals read (LedgerHealth.recent), for scripts to check
                // against the TS rules (src/signals/device/healthkit.ts)
                if let recent = try? await HealthRecent.read(store: HealthSync.shared.store, days: 14),
                   let json = try? JSONEncoder().encode(recent) {
                    try? json.write(to: HealthSync.shared.dir.appending(path: "recent.json"))
                }
            }
        }
        #endif
        // An app doesn't pinch-zoom its own UI. The web build keeps zoom for the browser (where
        // it's an accessibility feature), so the app caps the viewport itself; WKWebView honours
        // the limit (ignoresViewportScaleLimits is off).
        let noZoom = WKUserScript(source: """
            (() => {
              let meta = document.querySelector('meta[name=viewport]');
              if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta); }
              meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
            })();
            """, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        webView?.configuration.userContentController.addUserScript(noZoom)
    }
}
