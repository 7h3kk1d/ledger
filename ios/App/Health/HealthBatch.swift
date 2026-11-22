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
    /// One of HealthKit's statistics for the workout or an activity in it, by type name.
    struct Stat: Codable, Equatable { let unit: String; var sum, min, avg, max: Double? }
    /// A part of a multisport workout (swim, bike, run), with its own statistics.
    struct Activity: Codable, Equatable {
        let uuid, start: String
        var end: String?
        let duration_s: Double
        let activity_type: UInt
        let activity: String
        let metadata: [String: JSONValue]
        var stats: [String: Stat]?
        var events: [Event]?
    }
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
    var stats: [String: Stat]?
    var activities: [Activity]?
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

/// A category sample (handwashing, a symptom, a high heart rate notification, …): HealthKit's raw
/// value (HKCategoryValue…), and the interval.
struct HealthCategory: Codable, Equatable {
    let uuid, type, start, end: String
    let value: Int
    let source: HealthSource
    var metadata: [String: JSONValue]?
}

/// Samples HealthKit groups: a meal ("food", its dietary samples) or a blood pressure reading.
struct HealthCorrelation: Codable, Equatable {
    let uuid, type, start, end: String
    let members: [String] // the samples' uuids
    let source: HealthSource
    var metadata: [String: JSONValue]?
}

/// What doesn't change over time: date of birth, biological sex, blood type, …
struct HealthCharacteristic: Codable, Equatable {
    let type, value: String
}

/// Per-minute statistics of one type during a workout (and heartRateRecovery: the minutes after it).
struct HealthWorkoutSeries: Codable, Equatable {
    let workout, type, minute, unit: String
    var sum, min, avg, max: Double?
}

struct HealthRoutePoint: Codable, Equatable {
    let at: String
    let lat, lon: Double
    var alt, speed, course, h_acc, v_acc: Double?
}

struct HealthWorkoutRoute: Codable, Equatable {
    let workout, uuid: String
    let points: [HealthRoutePoint]
}

struct HealthECG: Codable, Equatable {
    let uuid, start, end, classification, symptoms: String
    var average_hr: Double?
    var sampling_hz: Double?
    let count: Int
    let source: HealthSource
    var metadata: [String: JSONValue]?
    /// Lead I, µV, one per 1/sampling_hz seconds.
    var voltages_uv: [Double]?
}

struct HealthAudiogram: Codable, Equatable {
    struct Point: Codable, Equatable {
        let hz: Double
        var left_db, right_db: Double?
    }
    let uuid, start, end: String
    let points: [Point]
    let source: HealthSource
    var metadata: [String: JSONValue]?
}

/// Beat-to-beat times behind an HRV reading: seconds since start; gap: beats were missed before it.
struct HealthHeartbeats: Codable, Equatable {
    struct Beat: Codable, Equatable { let t: Double; var gap: Bool? }
    let uuid, start, end: String
    let beats: [Beat]
    let source: HealthSource
}

struct HealthStateOfMind: Codable, Equatable {
    let uuid, start, end, kind: String
    let valence: Double
    let classification: String
    let labels, associations: [String]
    let source: HealthSource
    var metadata: [String: JSONValue]?
}

/// GAD-7 or PHQ-9.
struct HealthAssessment: Codable, Equatable {
    let uuid, type, start, end: String
    let score: Int
    let risk: String
    let answers: [Int]
    let source: HealthSource
}

/// A medication in the Health app's list (iOS 26), shared one by one.
struct HealthMedication: Codable, Equatable {
    struct Coding: Codable, Equatable { let system, code: String; var version: String? }
    let id, name, form: String
    var nickname: String?
    let archived, scheduled: Bool
    let codings: [Coding]
}

/// A dose taken, skipped, … (iOS 26).
struct HealthDose: Codable, Equatable {
    let uuid, start, end, medication, status, unit: String
    var scheduled_at: String?
    var dose, scheduled_dose: Double?
    var as_needed: Bool?
    let source: HealthSource
}

struct HealthDeleted: Codable, Equatable {
    /// workout | sleep | sample | category | correlation | ecg | audiogram | heartbeats |
    /// state_of_mind | assessment | dose
    let kind: String
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
    var categories: [HealthCategory]?
    var correlations: [HealthCorrelation]?
    var characteristics: [HealthCharacteristic]?
    var workout_series: [HealthWorkoutSeries]?
    var workout_routes: [HealthWorkoutRoute]?
    var ecg: [HealthECG]?
    var audiograms: [HealthAudiogram]?
    var heartbeats: [HealthHeartbeats]?
    var state_of_mind: [HealthStateOfMind]?
    var assessments: [HealthAssessment]?
    var medications: [HealthMedication]?
    var doses: [HealthDose]?
    var deleted: [HealthDeleted]?

    private var counts: [Int?] {
        [workouts?.count, sleep?.count, samples?.count, hourly?.count, activity?.count, categories?.count,
         correlations?.count, characteristics?.count, workout_series?.count, workout_routes?.count, ecg?.count,
         audiograms?.count, heartbeats?.count, state_of_mind?.count, assessments?.count, medications?.count,
         doses?.count, deleted?.count]
    }

    var isEmpty: Bool { counts.allSatisfy { ($0 ?? 0) == 0 } }

    var count: Int { counts.reduce(0) { $0 + ($1 ?? 0) } }

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
