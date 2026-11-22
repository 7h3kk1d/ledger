// The last few days straight from HealthKit, for Ledger's on-device signals (src/signals/device):
// what a habit's recipe needs to count a workout, a night, a ring or a weigh-in offline and at
// once. Same shapes as a batch (spec/healthkit-batch.md); nothing is stored or sent.
import Foundation
import HealthKit

struct HealthRecent: Codable, Equatable {
    var read_at: String
    var from: String
    var workouts: [HealthWorkout] = []
    var sleep: [HealthSleep] = []
    var samples: [HealthSample] = []
    var activity: [HealthActivityDay] = []

    /// Sampled types a recipe can ask for: weigh-ins, and the body fat that goes with them.
    static let sampleTypes: Set<String> = ["bodyMass", "bodyFatPercentage"]

    static func read(store: HKHealthStore, days: Int, now: Date = Date(), calendar: Calendar = .current) async throws -> HealthRecent {
        // a night ending this morning started yesterday evening: a day more than asked
        let from = calendar.startOfDay(for: now.addingTimeInterval(-Double(days) * 86400))
        let when = HKQuery.predicateForSamples(withStart: from.addingTimeInterval(-86400), end: nil)
        var out = HealthRecent(read_at: HealthTime.string(now), from: HealthTime.string(from))

        let workouts = try await HKSampleQueryDescriptor(predicates: [.workout(when)], sortDescriptors: []).result(for: store)
        out.workouts = workouts.map(HealthReader.workout)

        let sleep = try await HKSampleQueryDescriptor(
            predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: when)], sortDescriptors: []).result(for: store)
        out.sleep = sleep.map { s in
            HealthSleep(uuid: s.uuid.uuidString.lowercased(), start: HealthTime.string(s.startDate), end: HealthTime.string(s.endDate),
                        stage: HealthTypes.sleepStage(s.value), source: HealthTypes.source(s.sourceRevision, device: s.device))
        }

        for t in HealthTypes.sparse where sampleTypes.contains(t.name) {
            let rows = try await HKSampleQueryDescriptor(
                predicates: [.quantitySample(type: HKQuantityType(t.id), predicate: when)], sortDescriptors: []).result(for: store)
            out.samples += rows.compactMap { s in
                guard s.quantity.is(compatibleWith: t.unit) else { return nil }
                return HealthSample(uuid: s.uuid.uuidString.lowercased(), type: t.name, start: HealthTime.string(s.startDate),
                                    end: HealthTime.string(s.endDate), value: s.quantity.doubleValue(for: t.unit), unit: t.label,
                                    source: HealthTypes.source(s.sourceRevision, device: s.device))
            }
        }

        out.activity = try await HealthReader.summaries(store: store, calendar: calendar, from: from, to: now)
            .compactMap { HealthReader.activityDay($0, calendar: calendar) }
        return out
    }

    /// For the plugin: the same JSON a batch would hold.
    func dictionary() throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(self)) as? [String: Any] ?? [:]
    }
}
