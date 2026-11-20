import XCTest
@testable import Ledger

final class FileStoreTests: XCTestCase {
    private var store: FileStore!

    override func setUpWithError() throws {
        store = FileStore(root: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString))
    }

    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: store.root) }

    private let a = Data([1, 2, 3]), b = Data([4]), c = Data([5, 6])

    func testSaveLoadRemove() throws {
        XCTAssertNil(try store.load(["doc", "snapshot", "h1"]))
        try store.save(["doc", "snapshot", "h1"], a)
        XCTAssertEqual(try store.load(["doc", "snapshot", "h1"]), a)
        try store.save(["doc", "snapshot", "h1"], b) // overwrite
        XCTAssertEqual(try store.load(["doc", "snapshot", "h1"]), b)
        try store.remove(["doc", "snapshot", "h1"])
        XCTAssertNil(try store.load(["doc", "snapshot", "h1"]))
        try store.remove(["doc", "snapshot", "h1"]) // removing what isn't there is fine
    }

    func testRanges() throws {
        try store.save(["storage-adapter-id"], a)
        try store.save(["d1", "snapshot", "h1"], a)
        try store.save(["d1", "incremental", "h2"], b)
        try store.save(["d2", "sync-state", "peer"], c)

        let d1 = try store.loadRange(["d1"]).sorted { $0.key.joined() < $1.key.joined() }
        XCTAssertEqual(d1.map(\.key), [["d1", "incremental", "h2"], ["d1", "snapshot", "h1"]])
        XCTAssertEqual(d1.map(\.data), [b, a])
        XCTAssertEqual(try store.loadRange(["d1", "snapshot"]).map(\.key), [["d1", "snapshot", "h1"]])
        XCTAssertEqual(try store.loadRange([]).count, 4)
        XCTAssertEqual(try store.loadRange(["storage-adapter-id"]).map(\.key), [["storage-adapter-id"]])

        try store.removeRange(["d1"])
        XCTAssertEqual(try store.loadRange([]).map(\.key).sorted { $0.joined() < $1.joined() },
                       [["d2", "sync-state", "peer"], ["storage-adapter-id"]])
        try store.removeRange([])
        XCTAssertEqual(try store.loadRange([]).count, 0)
    }

    func testOddCharactersStayInsideTheRoot() throws {
        let key = ["../..", "a/b", "c.d", "%41"]
        try store.save(key, a)
        XCTAssertEqual(try store.load(key), a)
        XCTAssertEqual(try store.loadRange([]).map(\.key), [key])
        XCTAssertTrue(store.file(key).standardizedFileURL.path.hasPrefix(store.root.standardizedFileURL.path))
    }
}
