import Capacitor
import UIKit

/// Capacitor's web view running Ledger's own build, plus the app's native plugins.
class LedgerViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LedgerFilesPlugin())
    }
}
