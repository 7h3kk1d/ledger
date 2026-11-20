// What the app and the widget share in the app group, besides the docs (FileStore):
//   widget.json        today's rows, published by Ledger's JS (src/store/widget.ts)
//   widget-changes/    copies of the changes the widget made, for the app to apply on resume
import Foundation

enum WidgetFiles {
    static let appGroup = "group.me.bandukwala.Ledger"

    static var container: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) ?? URL.applicationSupportDirectory
    }

    static var snapshot: URL { container.appending(path: "widget.json") }
    static var changes: URL { container.appending(path: "widget-changes", directoryHint: .isDirectory) }
}

/// The schema Ledger's JS writes into widget.json (src/store/widget.ts: WidgetSnapshot).
struct WidgetSnapshot: Codable, Equatable {
    struct Row: Codable, Equatable, Identifiable {
        let id: String
        let name: String
        let hue: Double
        var done: Bool
        /// Ticked by hand (no linked data): a tap in the widget can tick it.
        let manual: Bool
        let sub: String?
    }

    /// The root doc, for knowing which ledger this is (and its schema epoch).
    let rootUrl: String
    /// The ledger doc the rows come from; taps write here.
    let ledgerUrl: String
    let name: String?
    /// The data epoch Ledger's JS ran with; the widget writes only into one it knows.
    let epoch: Int
    /// The local day the rows are for (YYYY-MM-DD); another day means they're stale.
    let date: String
    var rows: [Row]
    /// When this was written (ISO), by the app or by a widget tap.
    var updatedAt: String

    static func read(_ url: URL = WidgetFiles.snapshot) -> WidgetSnapshot? {
        (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode(WidgetSnapshot.self, from: $0) }
    }

    func write(_ url: URL = WidgetFiles.snapshot) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(self).write(to: url, options: .atomic)
    }
}
