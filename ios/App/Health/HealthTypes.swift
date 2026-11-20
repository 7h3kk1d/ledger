// What the app reads from HealthKit, in one place (spec/healthkit-batch.md lists the same).
import HealthKit

enum HealthTypes {
    /// Sparse measurements: every sample.
    static let sparse: [(id: HKQuantityTypeIdentifier, name: String, unit: HKUnit, label: String)] = [
        (.bodyMass, "bodyMass", .gramUnit(with: .kilo), "kg"),
        (.bodyFatPercentage, "bodyFatPercentage", .percent(), "%"),
        (.leanBodyMass, "leanBodyMass", .gramUnit(with: .kilo), "kg"),
        (.bodyMassIndex, "bodyMassIndex", .count(), "count"),
        (.height, "height", .meter(), "m"),
        (.restingHeartRate, "restingHeartRate", .count().unitDivided(by: .minute()), "count/min"),
        (.walkingHeartRateAverage, "walkingHeartRateAverage", .count().unitDivided(by: .minute()), "count/min"),
        (.respiratoryRate, "respiratoryRate", .count().unitDivided(by: .minute()), "count/min"),
        (.heartRateVariabilitySDNN, "heartRateVariabilitySDNN", .secondUnit(with: .milli), "ms"),
        (.vo2Max, "vo2Max", HKUnit(from: "ml/kg*min"), "ml/kg·min"),
        (.oxygenSaturation, "oxygenSaturation", .percent(), "%"),
        (.bodyTemperature, "bodyTemperature", .degreeCelsius(), "degC"),
        (.appleSleepingWristTemperature, "appleSleepingWristTemperature", .degreeCelsius(), "degC"),
        (.bloodPressureSystolic, "bloodPressureSystolic", .millimeterOfMercury(), "mmHg"),
        (.bloodPressureDiastolic, "bloodPressureDiastolic", .millimeterOfMercury(), "mmHg"),
        (.dietaryWater, "dietaryWater", .literUnit(with: .milli), "mL"),
    ]

    enum Stat { case sum, range }

    /// Dense measurements: hourly statistics, merged across devices.
    static let hourly: [(id: HKQuantityTypeIdentifier, name: String, unit: HKUnit, label: String, stat: Stat)] = [
        (.stepCount, "stepCount", .count(), "count", .sum),
        (.distanceWalkingRunning, "distanceWalkingRunning", .meter(), "m", .sum),
        (.distanceCycling, "distanceCycling", .meter(), "m", .sum),
        (.activeEnergyBurned, "activeEnergyBurned", .kilocalorie(), "kcal", .sum),
        (.basalEnergyBurned, "basalEnergyBurned", .kilocalorie(), "kcal", .sum),
        (.flightsClimbed, "flightsClimbed", .count(), "count", .sum),
        (.appleExerciseTime, "appleExerciseTime", .minute(), "min", .sum),
        (.appleStandTime, "appleStandTime", .minute(), "min", .sum),
        (.heartRate, "heartRate", .count().unitDivided(by: .minute()), "count/min", .range),
    ]

    static var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [
            .workoutType(),
            HKCategoryType(.sleepAnalysis),
            HKCategoryType(.mindfulSession),
            .activitySummaryType(),
        ]
        for t in sparse { types.insert(HKQuantityType(t.id)) }
        for t in hourly { types.insert(HKQuantityType(t.id)) }
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
        switch type {
        case .functionalStrengthTraining: "functionalStrengthTraining"
        case .traditionalStrengthTraining: "traditionalStrengthTraining"
        case .crossTraining: "crossTraining"
        case .running: "running"
        case .walking: "walking"
        case .hiking: "hiking"
        case .cycling: "cycling"
        case .swimming: "swimming"
        case .climbing: "climbing"
        case .yoga: "yoga"
        case .pilates: "pilates"
        case .highIntensityIntervalTraining: "highIntensityIntervalTraining"
        case .coreTraining: "coreTraining"
        case .flexibility: "flexibility"
        case .mixedCardio: "mixedCardio"
        case .elliptical: "elliptical"
        case .rowing: "rowing"
        case .stairClimbing: "stairClimbing"
        case .cooldown: "cooldown"
        case .other: "other"
        default: "activity\(type.rawValue)"
        }
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
