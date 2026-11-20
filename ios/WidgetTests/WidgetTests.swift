import Automerge
import XCTest

/// The widget's file logic against storage written by Ledger's own JS (scripts/widget-fixture.ts).
final class WidgetTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Entry: Decodable { let key: [String]; let data: String }
        let rootUrl: String
        let ledgerUrl: String
        let habits: [String: String]
        let entries: [Entry]
    }

    private var dir: URL!
    private var store: FileStore!
    private var fixture: Fixture!
    private var snapshotURL: URL { dir.appending(path: "widget.json") }
    private var changesDir: URL { dir.appending(path: "widget-changes") }
    private let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()
    private let now = ISO8601DateFormatter().date(from: "2026-11-20T09:00:00Z")!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        store = FileStore(root: dir.appending(path: "automerge"))
        let url = Bundle(for: Self.self).url(forResource: "fixture", withExtension: "json")!
        fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        for e in fixture.entries { try store.save(e.key, Data(base64Encoded: e.data)!) }
        try snapshot(epoch: 1, date: "2026-11-20").write(snapshotURL)
    }

    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    private func snapshot(epoch: Int, date: String, ledgerUrl: String? = nil) -> WidgetSnapshot {
        WidgetSnapshot(
            rootUrl: fixture.rootUrl, ledgerUrl: ledgerUrl ?? fixture.ledgerUrl, name: "Home", epoch: epoch, date: date,
            rows: [
                .init(id: fixture.habits["Stretch"]!, name: "Stretch", hue: 210, done: false, manual: true, sub: nil),
                .init(id: fixture.habits["Read"]!, name: "Read", hue: 30, done: true, manual: true, sub: nil),
            ],
            updatedAt: "2026-11-20T08:00:00.000Z")
    }

    private func toggle(_ name: String) throws -> WidgetSnapshot {
        try WidgetActions.toggle(habitId: fixture.habits[name]!, store: store, snapshotURL: snapshotURL, changesDir: changesDir, now: now, calendar: utc)
    }

    func testLoadsWhatJSStored() throws {
        let doc = try XCTUnwrap(try RepoFiles.load(store, id: RepoFiles.docId(fixture.ledgerUrl)))
        let ledger = try DocJSON.decode(LedgerDoc.self, from: doc)
        XCTAssertEqual(Set(ledger.habits.values.map(\.name)), ["Stretch", "Read"])
    }

    // "done" for hand-ticked habits comes from the doc: Read was ticked yesterday, not today
    func testRowsReReadTheDoc() throws {
        let rows = WidgetActions.rows(try XCTUnwrap(WidgetSnapshot.read(snapshotURL)), store: store, now: now, calendar: utc)
        XCTAssertEqual(rows.map(\.done), [false, false])
    }

    func testTickWritesAnIncrementalChunkAndACopyForTheApp() throws {
        let snap = try toggle("Stretch")
        XCTAssertEqual(snap.rows.first { $0.name == "Stretch" }?.done, true)
        XCTAssertEqual(WidgetSnapshot.read(snapshotURL)?.rows.first { $0.name == "Stretch" }?.done, true)

        let id = RepoFiles.docId(fixture.ledgerUrl)
        let increments = try store.loadRange([id, "incremental"])
        XCTAssertEqual(increments.count, 1)
        XCTAssertEqual(increments[0].key[2], RepoFiles.sha256Hex(increments[0].data)) // named as JS names them
        let copies = try FileManager.default.contentsOfDirectory(at: changesDir.appending(path: id), includingPropertiesForKeys: nil)
        XCTAssertEqual(try copies.map { try Data(contentsOf: $0) }, [increments[0].data])

        // the stored doc (snapshot + chunk) now has the tick; a second tap unticks
        XCTAssertEqual(WidgetActions.rows(snap, store: store, now: now, calendar: utc).first { $0.name == "Stretch" }?.done, true)
        XCTAssertEqual(try toggle("Stretch").rows.first { $0.name == "Stretch" }?.done, false)
        XCTAssertEqual(try store.loadRange([id, "incremental"]).count, 2)
    }

    func testWritesStringsAsText() throws {
        try toggle("Stretch")
        let doc = try XCTUnwrap(try RepoFiles.load(store, id: RepoFiles.docId(fixture.ledgerUrl)))
        let events = try Writes.map(doc, .ROOT, "events")
        for (_, value) in try doc.mapEntries(obj: events) {
            guard case let .Object(e, .Map) = value else { continue }
            guard case .Object(_, .Text) = try doc.get(obj: e, key: "typeId") else { return XCTFail("typeId isn't text") }
        }
    }

    func testRefusesANewerSchemaOrAnotherLedger() throws {
        try snapshot(epoch: 2, date: "2026-11-20").write(snapshotURL)
        XCTAssertThrowsError(try toggle("Stretch")) { XCTAssertEqual($0 as? WidgetActions.Refusal, .newerSchema) }
        try snapshot(epoch: 1, date: "2026-11-20", ledgerUrl: "automerge:2H9qGxsq1VSzRXo4aFsCPXo8TS2a").write(snapshotURL)
        XCTAssertThrowsError(try toggle("Stretch")) { XCTAssertEqual($0 as? WidgetActions.Refusal, .notCurrent) }
        XCTAssertEqual(try store.loadRange([RepoFiles.docId(fixture.ledgerUrl), "incremental"]).count, 0)
    }
}
