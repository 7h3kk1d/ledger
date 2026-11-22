// What the app reads from HealthKit, in one place (spec/healthkit-batch.md lists the same).
// The quantity and category types come from HealthCatalog (every type in the SDK).
import HealthKit

enum HealthTypes {
    typealias Typed = (id: HKQuantityTypeIdentifier, name: String, unit: HKUnit, label: String)

    /// A catalog type this iOS knows, with its unit.
    private static func known(_ q: HealthCatalog.Quantity) -> Typed? {
        guard HKQuantityType.quantityType(forIdentifier: q.id) != nil else { return nil }
        return (q.id, q.name, HKUnit(from: q.unit), q.unit)
    }

    /// Sparse measurements: every sample.
    static let sparse: [Typed] = HealthCatalog.quantities.filter { $0.policy == .samples }.compactMap(known)

    enum Stat { case sum, range }

    /// Dense measurements: hourly statistics, merged across devices.
    static let hourly: [(id: HKQuantityTypeIdentifier, name: String, unit: HKUnit, label: String, stat: Stat)] =
        HealthCatalog.quantities.filter { $0.policy != .samples }.compactMap { q in
            known(q).map { ($0.id, $0.name, $0.unit, $0.label, q.policy == .hourlySum ? Stat.sum : .range) }
        }

    /// Category types this iOS knows.
    static let categories: [(id: HKCategoryTypeIdentifier, name: String)] =
        HealthCatalog.categories.compactMap { c in HKCategoryType.categoryType(forIdentifier: c.id).map { _ in (c.id, c.name) } }

    /// Any catalog quantity type this iOS knows, by name.
    static let byName: [String: Typed] = Dictionary(uniqueKeysWithValues: byType.values.map { ($0.name, $0) })

    /// Any catalog quantity type by HealthKit type: its name and unit (workout statistics).
    static let byType: [HKQuantityType: Typed] = {
        var out: [HKQuantityType: Typed] = [:]
        for q in HealthCatalog.quantities {
            if let t = known(q) { out[HKQuantityType(t.id)] = t }
        }
        return out
    }()

    static let characteristics: [(id: HKCharacteristicTypeIdentifier, name: String)] = [
        (.biologicalSex, "biologicalSex"), (.bloodType, "bloodType"), (.dateOfBirth, "dateOfBirth"),
        (.fitzpatrickSkinType, "fitzpatrickSkinType"), (.wheelchairUse, "wheelchairUse"), (.activityMoveMode, "activityMoveMode"),
    ]

    static var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [
            .workoutType(),
            HKCategoryType(.sleepAnalysis),
            .activitySummaryType(),
            HKSeriesType.workoutRoute(),
            HKSeriesType.heartbeat(),
            .electrocardiogramType(),
            .audiogramSampleType(),
            .stateOfMindType(),
        ]
        for t in sparse { types.insert(HKQuantityType(t.id)) }
        for t in hourly { types.insert(HKQuantityType(t.id)) }
        for c in categories { types.insert(HKCategoryType(c.id)) }
        for c in characteristics { types.insert(HKCharacteristicType(c.id)) }
        for a in [HKScoredAssessmentTypeIdentifier.GAD7, .PHQ9] {
            types.insert(HKScoredAssessmentType(a))
        }
        // not medication doses: asking for them here raises; the per-medication sheet (authorize) covers them
        return types
    }

    static func sleepStage(_ raw: Int) -> String {
        switch HKCategoryValueSleepAnalysis(rawValue: raw) {
        case .inBed: "inBed"
        case .asleepUnspecified: "asleepUnspecified"
        case .awake: "awake"
        case .asleepCore: "asleepCore"
        case .asleepDeep: "asleepDeep"
        case .asleepREM: "asleepREM"
        default: "unknown\(raw)"
        }
    }

    static func activityName(_ type: HKWorkoutActivityType) -> String {
        HealthCatalog.activities[type.rawValue] ?? "activity\(type.rawValue)"
    }

    static func eventName(_ type: HKWorkoutEventType) -> String {
        switch type {
        case .pause: "pause"
        case .resume: "resume"
        case .lap: "lap"
        case .marker: "marker"
        case .motionPaused: "motionPaused"
        case .motionResumed: "motionResumed"
        case .segment: "segment"
        case .pauseOrResumeRequest: "pauseOrResumeRequest"
        @unknown default: "event\(type.rawValue)"
        }
    }

    /// HealthKit metadata as JSON values: every key kept (spec/healthkit-batch.md).
    static func metadata(_ m: [String: Any]?) -> [String: JSONValue] {
        var out: [String: JSONValue] = [:]
        for (k, v) in m ?? [:] {
            switch v {
            case let s as String: out[k] = .string(s)
            case let n as NSNumber:
                out[k] = CFGetTypeID(n) == CFBooleanGetTypeID() ? .bool(n.boolValue) : .number(n.doubleValue)
            case let d as Date: out[k] = .string(HealthTime.string(d))
            case let q as HKQuantity: out[k] = .string("\(q)")
            default: out[k] = .string("\(v)")
            }
        }
        return out
    }

    static func source(_ r: HKSourceRevision, device: HKDevice?) -> HealthSource {
        HealthSource(name: r.source.name, bundle_id: r.source.bundleIdentifier, version: r.version, device: device?.name)
    }
}
