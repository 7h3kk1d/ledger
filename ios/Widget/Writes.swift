// Writes to a Ledger doc, matching ledger/src/store/mutations.ts byte-for-byte in shape.
//
// Interop rule found in the spike: JS Automerge 3 stores every string as a *text object*
// (getWithType -> ["text", id]), not a scalar. Writing scalar strings from Swift would read
// back in JS as RawString objects and break `typeof x === "string"` checks, so every string
// here goes through `putText`.
import Automerge
import Foundation

enum Writes {
    static let localAuthor = "local"

    static func putText(_ doc: Document, _ obj: ObjId, _ key: String, _ value: String) throws {
        let text = try doc.putObject(obj: obj, key: key, ty: .Text)
        try doc.updateText(obj: text, value: value)
    }

    static func map(_ doc: Document, _ obj: ObjId, _ key: String) throws -> ObjId {
        guard case let .Object(id, .Map) = try doc.get(obj: obj, key: key) else {
            throw CocoaError(.coderValueNotFound, userInfo: [NSDebugDescriptionErrorKey: "no map at \(key)"])
        }
        return id
    }

    static func putOccurred(_ doc: Document, _ obj: ObjId, _ occurred: Occurred) throws {
        let o = try doc.putObject(obj: obj, key: "occurred", ty: .Map)
        switch occurred {
        case let .instant(at):
            try putText(doc, o, "kind", "instant")
            try putText(doc, o, "at", at)
        case let .day(date):
            try putText(doc, o, "kind", "day")
            try putText(doc, o, "date", date)
        }
    }

    /// Append a new event (mutations.ts `logEvent`); returns its id.
    @discardableResult
    static func logEvent(_ doc: Document, typeId: String, occurred: Occurred, now: Date, id: String = newId()) throws -> String {
        let events = try map(doc, .ROOT, "events")
        let e = try doc.putObject(obj: events, key: id, ty: .Map)
        try putText(doc, e, "id", id)
        try putText(doc, e, "typeId", typeId)
        try putText(doc, e, "author", localAuthor)
        try putText(doc, e, "loggedAt", Ledger.isoNow(now))
        try putOccurred(doc, e, occurred)
        _ = try doc.putObject(obj: e, key: "attrs", ty: .Map)
        return id
    }

    /// Delete = append a tombstone retracting the target (mutations.ts `tombstoneEvent`).
    @discardableResult
    static func tombstone(_ doc: Document, target: Event, now: Date, id: String = newId()) throws -> String {
        let events = try map(doc, .ROOT, "events")
        let e = try doc.putObject(obj: events, key: id, ty: .Map)
        try putText(doc, e, "id", id)
        try putText(doc, e, "typeId", target.typeId)
        try putText(doc, e, "author", localAuthor)
        try putText(doc, e, "loggedAt", Ledger.isoNow(now))
        try putOccurred(doc, e, target.occurred)
        _ = try doc.putObject(obj: e, key: "attrs", ty: .Map)
        try putText(doc, e, "amends", target.id)
        try doc.put(obj: e, key: "deleted", value: .Boolean(true))
        return id
    }

    /// Check or uncheck a habit for a local date (mutations.ts `toggleHabit`).
    static func toggleHabit(_ doc: Document, habit: Habit, date: String, now: Date = Date(), calendar: Calendar = .current) throws {
        let ledger = try DocJSON.decode(LedgerDoc.self, from: doc)
        let existing = Ledger.habitEventsOn(ledger.events, habit: habit, date: date, calendar: calendar)
        if !existing.isEmpty {
            for e in existing { try tombstone(doc, target: e, now: now) }
            return
        }
        guard let typeId = habit.eventTypeIds.first else { return }
        let occurred: Occurred = date == Ledger.localDate(now, calendar: calendar)
            ? .instant(at: Ledger.isoNow(now))
            : .day(date: date)
        try logEvent(doc, typeId: typeId, occurred: occurred, now: now)
    }

    /// crypto.randomUUID() format: lowercase.
    static func newId() -> String { UUID().uuidString.lowercased() }
}
