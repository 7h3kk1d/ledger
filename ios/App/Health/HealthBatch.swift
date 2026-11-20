// A batch of HealthKit records, as spec/healthkit-batch.md defines them. Plain values, so the
// format is tested without HealthKit (HealthReader turns HK objects into these).
import Foundation

/// A metadata value: HealthKit's strings, numbers and booleans as they are.
enum JSONValue: Codable, Equatable {
    case string(String), number(Double), bool(Bool)

    func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case let .string(s): try c.encode(s)
        case let .number(n): try c.encode(n)
        case let .bool(b): try c.encode(b)
        }
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else { self = .string(try c.decode(String.self)) }
    }
}

struct HealthSource: Codable, Equatable {
    let name: String
    let bundle_id: String
    var version: String?
    var device: String?
}

struct HealthWorkout: Codable, Equatable {
    struct Range: Codable, Equatable { let min, avg, max: Double }
    struct Event: Codable, Equatable { let type, start, end: String }
    let uuid, start, end: String
    let duration_s: Double
    let activity_type: UInt
    let activity: String
    let source: HealthSource
    let metadata: [String: JSONValue]
    var energy_kcal: Double?
    var distance_m: Double?
    var heart_rate: Range?
    var events: [Event]?
}

struct HealthSleep: Codable, Equatable {
    let uuid, start, end, stage: String
    let source: HealthSource
    var metadata: [String: JSONValue]?
}

struct HealthSample: Codable, Equatable {
    let uuid, type, start, end: String
    let value: Double
    let unit: String
    let source: HealthSource
    var metadata: [String: JSONValue]?
}

struct HealthHourly: Codable, Equatable {
    let type, hour, unit: String
    var sum, min, avg, max: Double?
}

struct HealthActivityDay: Codable, Equatable {
    let day: String
    var move_kcal, move_goal_kcal, exercise_min, exercise_goal_min, stand_h, stand_goal_h: Double?
}

struct HealthDeleted: Codable, Equatable {
    let kind: String // workout | sleep | sample
    let uuid: String
}

struct HealthDevice: Codable, Equatable {
    let id, name, model, os: String
}

struct HealthBatch: Codable, Equatable {
    var schema = 1
    var batch_id = UUID().uuidString.lowercased()
    var created_at: String
    let app: String
    let device: HealthDevice
    let time_zone: String
    var workouts: [HealthWorkout]?
    var sleep: [HealthSleep]?
    var samples: [HealthSample]?
    var hourly: [HealthHourly]?
    var activity: [HealthActivityDay]?
    var deleted: [HealthDeleted]?

    var isEmpty: Bool {
        [workouts?.count, sleep?.count, samples?.count, hourly?.count, activity?.count, deleted?.count]
            .allSatisfy { ($0 ?? 0) == 0 }
    }

    var count: Int {
        [workouts?.count, sleep?.count, samples?.count, hourly?.count, activity?.count, deleted?.count]
            .reduce(0) { $0 + ($1 ?? 0) }
    }

    func encoded() throws -> Data {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try e.encode(self)
    }
}

enum HealthTime {
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    static func string(_ d: Date) -> String { iso.string(from: d) }

    static func day(_ d: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
}
