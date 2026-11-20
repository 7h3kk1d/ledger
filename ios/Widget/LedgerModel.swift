// The parts of Ledger's doc schema (src/model/types.ts) the widget needs, and pure ports
// of the reducers it uses (ledger/src/model/reduce.ts). Read-only: writes go through Writes.swift.
import Foundation

enum Occurred: Decodable, Equatable, Sendable {
    case instant(at: String) // exact ISO timestamp
    case day(date: String) // YYYY-MM-DD, local whole day

    private enum CodingKeys: String, CodingKey { case kind, at, date }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "instant": self = .instant(at: try c.decode(String.self, forKey: .at))
        case "day": self = .day(date: try c.decode(String.self, forKey: .date))
        case let kind:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown kind \(kind)")
        }
    }
}

struct Event: Decodable, Equatable, Sendable, Identifiable {
    let id: String
    let typeId: String
    let loggedAt: String
    let occurred: Occurred
    let amends: String?
    let deleted: Bool?
}

struct Habit: Decodable, Equatable, Sendable, Identifiable {
    let id: String
    let name: String
    let eventTypeIds: [String]
    let archived: Bool?
    let order: Double?

    private enum CodingKeys: String, CodingKey { case id, name, eventTypeIds, archived, order }

    init(id: String, name: String, eventTypeIds: [String], archived: Bool? = nil, order: Double? = nil) {
        self.id = id
        self.name = name
        self.eventTypeIds = eventTypeIds
        self.archived = archived
        self.order = order
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        eventTypeIds = try c.decode([String].self, forKey: .eventTypeIds)
        archived = try c.decodeIfPresent(Bool.self, forKey: .archived)
        // JS numbers land as Int or F64 depending on the value
        order = (try? c.decodeIfPresent(Double.self, forKey: .order))
            ?? (try? c.decodeIfPresent(Int.self, forKey: .order)).flatMap { $0.map(Double.init) }
    }
}

struct LedgerDoc: Decodable, Equatable, Sendable {
    let habits: [String: Habit]
    let events: [String: Event]
}

struct RootDoc: Decodable, Equatable, Sendable {
    let current: String
    let epoch: Int
}

enum Ledger {
    /// Local calendar date, YYYY-MM-DD (reduce.ts `localDate`).
    static func localDate(_ d: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    static func occurredDate(_ o: Occurred, calendar: Calendar = .current) -> String {
        switch o {
        case let .day(date): return date
        case let .instant(at): return parseISO(at).map { localDate($0, calendar: calendar) } ?? String(at.prefix(10))
        }
    }

    static func parseISO(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }

    static func isoNow(_ d: Date = Date()) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: d)
    }

    /// Live events: not tombstoned and not superseded by an amend.
    static func currentEvents(_ events: [String: Event]) -> [Event] {
        let superseded = Set(events.values.compactMap(\.amends))
        return events.values.filter { $0.deleted != true && !superseded.contains($0.id) }
    }

    static func habitEventsOn(_ events: [String: Event], habit: Habit, date: String, calendar: Calendar = .current) -> [Event] {
        currentEvents(events).filter {
            habit.eventTypeIds.contains($0.typeId) && occurredDate($0.occurred, calendar: calendar) == date
        }
    }

    static func activeHabits(_ doc: LedgerDoc) -> [Habit] {
        doc.habits.values.filter { $0.archived != true }.sorted {
            let (a, b) = ($0.order ?? .infinity, $1.order ?? .infinity)
            return a != b ? a < b : $0.name.localizedCompare($1.name) == .orderedAscending
        }
    }
}
