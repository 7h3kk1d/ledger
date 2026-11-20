// automerge-repo's documents as JS stores them through FileStore (StorageSubsystem's layout):
//   [docId, "snapshot", headsHash]   a compacted doc
//   [docId, "incremental", sha256]   changes saved since
// Loading concatenates snapshots then incrementals, as JS does. The widget saves its own changes
// as one more incremental chunk, named the way JS names them; JS compacts only the chunks it
// loaded itself, so a chunk written meanwhile survives until the next load folds it in.
import Automerge
import CryptoKit
import Foundation

enum RepoFiles {
    static func docId(_ url: String) -> String {
        url.hasPrefix("automerge:") ? String(url.dropFirst("automerge:".count)) : url
    }

    static func load(_ store: FileStore, id: String) throws -> Document? {
        let chunks = try store.loadRange([id, "snapshot"]) + store.loadRange([id, "incremental"])
        guard !chunks.isEmpty else { return nil }
        var bytes = Data()
        for chunk in chunks { bytes.append(chunk.data) }
        return try Document(bytes)
    }

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Store `changes` for the repo, and a copy for the app to apply to its open doc.
    static func append(_ store: FileStore, id: String, changes: Data, changesDir: URL = WidgetFiles.changes, now: Date = Date()) throws {
        try store.save([id, "incremental", sha256Hex(changes)], changes)
        let dir = changesDir.appending(path: id, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // named to sort in the order they were made
        let name = String(format: "%013.0f-%@.am", now.timeIntervalSince1970 * 1000, UUID().uuidString)
        try changes.write(to: dir.appending(path: name), options: .atomic)
    }
}

/// What a tap on a widget row does, and what the widget shows.
enum WidgetActions {
    /// The data epoch this build understands (src/model/types.ts DATA_EPOCH). A newer one means
    /// a newer Ledger changed the schema: the widget then only shows, never writes.
    static let knownEpoch = 1

    enum Refusal: Error, Equatable {
        case noSnapshot, newerSchema, notCurrent, noDoc, noHabit
    }

    /// The rows to show today: Ledger's own list (order, due, linked data), with "done" for
    /// habits ticked by hand re-read from the doc on this device, which is newer when the widget
    /// ticked or the snapshot is from another day.
    static func rows(_ snap: WidgetSnapshot, store: FileStore, now: Date = Date(), calendar: Calendar = .current) -> [WidgetSnapshot.Row] {
        let today = Ledger.localDate(now, calendar: calendar)
        let doc = try? RepoFiles.load(store, id: RepoFiles.docId(snap.ledgerUrl)).flatMap { try DocJSON.decode(LedgerDoc.self, from: $0) }
        return snap.rows.map { row in
            var r = row
            if let doc, let habit = doc.habits[row.id] {
                let ticked = !Ledger.habitEventsOn(doc.events, habit: habit, date: today, calendar: calendar).isEmpty
                // linked data can only make it done, and only for the day it was computed
                r.done = ticked || (!row.manual && snap.date == today && row.done)
            } else if snap.date != today {
                r.done = false
            }
            return r
        }
    }

    /// Tick or untick `habitId` today in the stored ledger doc; returns the new snapshot.
    @discardableResult
    static func toggle(habitId: String, store: FileStore, snapshotURL: URL = WidgetFiles.snapshot, changesDir: URL = WidgetFiles.changes,
                       now: Date = Date(), calendar: Calendar = .current) throws -> WidgetSnapshot {
        guard var snap = WidgetSnapshot.read(snapshotURL) else { throw Refusal.noSnapshot }
        guard snap.epoch == knownEpoch else { throw Refusal.newerSchema }
        // the root on this device must still point where the snapshot does, at a schema we know
        let rootDoc = try RepoFiles.load(store, id: RepoFiles.docId(snap.rootUrl)).map { try DocJSON.decode(RootDoc.self, from: $0) }
        guard let root = rootDoc else { throw Refusal.noDoc }
        guard root.epoch == knownEpoch else { throw Refusal.newerSchema }
        guard root.current == snap.ledgerUrl else { throw Refusal.notCurrent }

        let id = RepoFiles.docId(snap.ledgerUrl)
        guard let doc = try RepoFiles.load(store, id: id) else { throw Refusal.noDoc }
        guard let habit = try DocJSON.decode(LedgerDoc.self, from: doc).habits[habitId] else { throw Refusal.noHabit }
        let before = doc.heads()
        let today = Ledger.localDate(now, calendar: calendar)
        try Writes.toggleHabit(doc, habit: habit, date: today, now: now, calendar: calendar)
        if doc.heads() != before {
            try RepoFiles.append(store, id: id, changes: try doc.encodeChangesSince(heads: before), changesDir: changesDir, now: now)
        }
        let after = try DocJSON.decode(LedgerDoc.self, from: doc)
        if let i = snap.rows.firstIndex(where: { $0.id == habitId }) {
            snap.rows[i].done = !Ledger.habitEventsOn(after.events, habit: habit, date: today, calendar: calendar).isEmpty
        }
        snap.updatedAt = Ledger.isoNow(now)
        try snap.write(snapshotURL)
        return snap
    }
}
