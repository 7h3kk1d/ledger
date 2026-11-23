// Reads what's new in HealthKit and hands it over as batches (HealthBatch), one kind and chunk at a
// time. Where it got to is kept (HealthState): an anchor per kind of sample, which also reports
// deletions; for hourly statistics and ring days, the time to read again from. A cursor is saved
// only after its batch is in the outbox, so a crash re-reads and the receiver keeps it once.
import Foundation
import HealthKit

struct HealthState: Codable {
    var deviceId = UUID().uuidString.lowercased()
    var anchors: [String: Data] = [:]
    var hourlyFrom: [String: Date] = [:]
    var activityFrom: Date?
    /// The permission sheet was answered (authorize).
    var connected: Bool?
    var lastRead: Date?
    var lastReadCount: Int?
    var lastReadError: String?
    var pushUrl: String?
    var lastPushAt: Date?
    var lastPushCount: Int?
    var lastPushError: String?
    /// Batches the last push left for Wi-Fi.
    var lastPushHeld: Int?
    /// The last read stopped at the outbox cap: history is still being read.
    var backfilling: Bool?
    /// What was last sent of the kinds sent whole when they change.
    var characteristics: [HealthCharacteristic]?
    var medications: [HealthMedication]?

    static func load(_ url: URL) -> HealthState {
        (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode(HealthState.self, from: $0) } ?? HealthState()
    }

    func save(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(self).write(to: url, options: .atomic)
    }

    /// Saves a sync's progress but keeps what was set meanwhile: a backfill's sync runs for minutes,
    /// and saving the receiver (setPush) or connecting (authorize) can happen while it waits.
    @discardableResult
    func saveKeepingSettings(_ url: URL) throws -> HealthState {
        var s = self
        let disk = HealthState.load(url)
        s.pushUrl = disk.pushUrl
        s.connected = disk.connected ?? s.connected
        try s.save(url)
        return s
    }
}

final class HealthReader {
    let store: HKHealthStore
    var state: HealthState
    let newBatch: () -> HealthBatch
    let emit: (HealthBatch) throws -> Void
    let persist: (HealthState) throws -> Void
    let calendar: Calendar
    /// Kinds that couldn't be read this run (the rest were).
    var problems: [String] = []
    /// Whether the outbox may take more; when it can't, the rest waits for the next run.
    let room: () -> Bool
    /// This run stopped early because the outbox was full (a backfill: read more once it's sent).
    private(set) var full = false

    /// How much history the first run reads (the Apple Watch's first year).
    static let historyStart = ISO8601DateFormatter().date(from: "2014-09-01T00:00:00Z")!

    init(store: HKHealthStore, state: HealthState, calendar: Calendar = .current,
         newBatch: @escaping () -> HealthBatch, emit: @escaping (HealthBatch) throws -> Void,
         persist: @escaping (HealthState) throws -> Void, room: @escaping () -> Bool = { true }) {
        self.room = room
        self.store = store
        self.state = state
        self.calendar = calendar
        self.newBatch = newBatch
        self.emit = emit
        self.persist = persist
    }

    /// Everything new since the last run; returns how many records it handed over.
    func run(now: Date = Date()) async throws -> Int {
        var n = 0
        // "workouts.v2": read again from the start when series, routes and statistics were added
        // each kind on its own: one that fails is named in lastReadError, and the rest go on
        n += await soft("workouts") { try await self.anchored(key: "workouts.v2", predicate: .workout(), limit: 10) { added, deleted in
            var b = self.newBatch()
            b.workouts = added.map(Self.workout)
            var series: [HealthWorkoutSeries] = [], routes: [HealthWorkoutRoute] = []
            for w in added {
                let x = await self.extras(w, now: now)
                series += x.series
                routes += x.routes
            }
            b.workout_series = series.isEmpty ? nil : series
            b.workout_routes = routes.isEmpty ? nil : routes
            b.deleted = deleted.isEmpty ? nil : deleted.map { HealthDeleted(kind: "workout", uuid: $0.uuid.uuidString.lowercased()) }
            return b
        } }
        n += await soft("sleep") { try await self.anchored(key: "sleep", predicate: .categorySample(type: HKCategoryType(.sleepAnalysis)), limit: 5000) { added, deleted in
            var b = self.newBatch()
            b.sleep = added.map { s in
                HealthSleep(uuid: s.uuid.uuidString.lowercased(), start: HealthTime.string(s.startDate), end: HealthTime.string(s.endDate),
                            stage: HealthTypes.sleepStage(s.value), source: HealthTypes.source(s.sourceRevision, device: s.device),
                            metadata: s.metadata.map(HealthTypes.metadata))
            }
            b.deleted = deleted.isEmpty ? nil : deleted.map { HealthDeleted(kind: "sleep", uuid: $0.uuid.uuidString.lowercased()) }
            return b
        } }
        for t in HealthTypes.sparse {
            n += await soft(t.name) { try await self.anchored(key: t.name, predicate: .quantitySample(type: HKQuantityType(t.id)), limit: 5000) { added, deleted in
                var b = self.newBatch()
                b.samples = added.compactMap { s in
                    guard s.quantity.is(compatibleWith: t.unit) else { return nil }
                    return HealthSample(uuid: s.uuid.uuidString.lowercased(), type: t.name, start: HealthTime.string(s.startDate),
                                        end: HealthTime.string(s.endDate), value: s.quantity.doubleValue(for: t.unit), unit: t.label,
                                        source: HealthTypes.source(s.sourceRevision, device: s.device), metadata: s.metadata.map(HealthTypes.metadata))
                }
                b.deleted = deleted.isEmpty ? nil : deleted.map { HealthDeleted(kind: "sample", uuid: $0.uuid.uuidString.lowercased()) }
                return b
            } }
        }
        for t in HealthTypes.hourly {
            n += await soft("\(t.name) by the hour") { try await self.hourly(t, now: now) }
        }
        n += await soft("rings") { try await self.activity(now: now) }
        n += await runMore(now: now)
        return n
    }

    static func workout(_ w: HKWorkout) -> HealthWorkout {
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let hr = w.statistics(for: HKQuantityType(.heartRate))
        let range: HealthWorkout.Range? = {
            guard let hr, let mn = hr.minimumQuantity(), let av = hr.averageQuantity(), let mx = hr.maximumQuantity() else { return nil }
            return .init(min: mn.doubleValue(for: bpm), avg: av.doubleValue(for: bpm), max: mx.doubleValue(for: bpm))
        }()
        let events = (w.workoutEvents ?? []).map {
            HealthWorkout.Event(type: HealthTypes.eventName($0.type), start: HealthTime.string($0.dateInterval.start),
                                end: HealthTime.string($0.dateInterval.end))
        }
        return HealthWorkout(
            uuid: w.uuid.uuidString.lowercased(), start: HealthTime.string(w.startDate), end: HealthTime.string(w.endDate),
            duration_s: w.duration, activity_type: w.workoutActivityType.rawValue, activity: HealthTypes.activityName(w.workoutActivityType),
            source: HealthTypes.source(w.sourceRevision, device: w.device), metadata: HealthTypes.metadata(w.metadata),
            energy_kcal: w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie()),
            distance_m: w.totalDistance?.doubleValue(for: .meter()),
            heart_rate: range, events: events.isEmpty ? nil : events, stats: stats(w.allStatistics), activities: activities(w))
    }

    func anchored<T: HKSample>(key: String, predicate: HKSamplePredicate<T>, limit: Int,
                               build: ([T], [HKDeletedObject]) async throws -> HealthBatch) async throws -> Int {
        var total = 0
        while true {
            guard room() else {
                full = true
                return total
            }
            let anchor = state.anchors[key].flatMap { try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: $0) }
            let result = try await HKAnchoredObjectQueryDescriptor(predicates: [predicate], anchor: anchor, limit: limit).result(for: store)
            let batch = try await build(result.addedSamples, result.deletedObjects)
            if !batch.isEmpty {
                try emit(batch)
                total += batch.count
            }
            state.anchors[key] = try NSKeyedArchiver.archivedData(withRootObject: result.newAnchor, requiringSecureCoding: true)
            try persist(state)
            if result.addedSamples.count + result.deletedObjects.count < limit { return total }
        }
    }

    private func hourFloor(_ d: Date) -> Date {
        calendar.dateInterval(of: .hour, for: d)?.start ?? d
    }

    private func earliest(_ type: HKQuantityType) async throws -> Date? {
        try await HKSampleQueryDescriptor(predicates: [.quantitySample(type: type)],
                                          sortDescriptors: [SortDescriptor(\.startDate, order: .forward)], limit: 1)
            .result(for: store).first?.startDate
    }

    /// Hourly statistics, 30 days per batch; the last two days are read again next time.
    private func hourly(_ t: HealthTypes.Hourly, now: Date) async throws -> Int {
        var total = 0
        let window: TimeInterval = 30 * 86400
        do {
            let type = HKQuantityType(t.id)
            var start = state.hourlyFrom[t.name]
            if start == nil { start = try await earliest(type) } // first run: from the oldest sample
            guard var from = start else { return 0 }
            from = hourFloor(from)
            let options: HKStatisticsOptions = t.stat == .sum ? .cumulativeSum : [.discreteMin, .discreteAverage, .discreteMax]
            let recent = now.addingTimeInterval(-2 * 86400)
            while from < now {
                let to = min(from.addingTimeInterval(window), now)
                var rows: [HealthHourly]
                do {
                    rows = try await hours(t, type, options, from: from, to: to)
                } catch {
                    // HealthKit refuses some stretches of Watch-heavy types ("Unable to invalidate
                    // interval: no data source available"). Go a day at a time and skip the days it
                    // refuses: every sample is sent anyway. A refused recent day is still reported.
                    rows = []
                    var day = from
                    while day < to {
                        let end = min(day.addingTimeInterval(86400), to)
                        do { rows += try await hours(t, type, options, from: day, to: end) }
                        catch { if end > recent { throw error } }
                        day = end
                    }
                }
                if !rows.isEmpty {
                    var b = newBatch()
                    b.hourly = rows
                    try emit(b)
                    total += rows.count
                }
                state.hourlyFrom[t.name] = to
                try persist(state)
                from = to
            }
            state.hourlyFrom[t.name] = hourFloor(now.addingTimeInterval(-2 * 86400))
            try persist(state)
        }
        return total
    }

    private func hours(_ t: HealthTypes.Hourly, _ type: HKQuantityType, _ options: HKStatisticsOptions,
                       from: Date, to: Date) async throws -> [HealthHourly] {
        let samples = HKQuery.predicateForSamples(withStart: from, end: to)
        let collection = try await HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: type, predicate: samples), options: options,
            anchorDate: hourFloor(from), intervalComponents: DateComponents(hour: 1)).result(for: store)
        var rows: [HealthHourly] = []
        collection.enumerateStatistics(from: from, to: to) { s, _ in
            var row = HealthHourly(type: t.name, hour: HealthTime.string(s.startDate), unit: t.label)
            if t.stat == .sum {
                guard let sum = s.sumQuantity() else { return }
                row.sum = sum.doubleValue(for: t.unit)
            } else {
                guard let mn = s.minimumQuantity(), let av = s.averageQuantity(), let mx = s.maximumQuantity() else { return }
                row.min = mn.doubleValue(for: t.unit)
                row.avg = av.doubleValue(for: t.unit)
                row.max = mx.doubleValue(for: t.unit)
            }
            rows.append(row)
        }
        return rows
    }

    /// The rings, 180 days per batch; the last three days are read again next time.
    private func activity(now: Date) async throws -> Int {
        var total = 0
        var from = state.activityFrom ?? Self.historyStart
        while from < now {
            let to = min(from.addingTimeInterval(180 * 86400), now)
            let rows = try await summaries(from: from, to: to).compactMap { Self.activityDay($0, calendar: calendar) }
            if !rows.isEmpty {
                var b = newBatch()
                b.activity = rows
                try emit(b)
                total += rows.count
            }
            state.activityFrom = to
            try persist(state)
            from = to
        }
        state.activityFrom = calendar.startOfDay(for: now.addingTimeInterval(-3 * 86400))
        try persist(state)
        return total
    }

    static func activityDay(_ s: HKActivitySummary, calendar: Calendar) -> HealthActivityDay? {
        let c = s.dateComponents(for: calendar)
        guard let y = c.year, let m = c.month, let d = c.day else { return nil }
        let kcal = HKUnit.kilocalorie(), min = HKUnit.minute(), count = HKUnit.count()
        var row = HealthActivityDay(day: String(format: "%04d-%02d-%02d", y, m, d))
        row.move_kcal = s.activeEnergyBurned.doubleValue(for: kcal)
        row.move_goal_kcal = s.activeEnergyBurnedGoal.doubleValue(for: kcal)
        row.exercise_min = s.appleExerciseTime.doubleValue(for: min)
        row.exercise_goal_min = s.exerciseTimeGoal?.doubleValue(for: min)
        row.stand_h = s.appleStandHours.doubleValue(for: count)
        row.stand_goal_h = s.standHoursGoal?.doubleValue(for: count)
        return row
    }

    func summaries(from: Date, to: Date) async throws -> [HKActivitySummary] {
        try await Self.summaries(store: store, calendar: calendar, from: from, to: to)
    }

    static func summaries(store: HKHealthStore, calendar: Calendar, from: Date, to: Date) async throws -> [HKActivitySummary] {
        func comps(_ d: Date) -> DateComponents {
            var c = calendar.dateComponents([.era, .year, .month, .day], from: d)
            c.calendar = calendar
            return c
        }
        let predicate = HKQuery.predicate(forActivitySummariesBetweenStart: comps(from), end: comps(to))
        return try await withCheckedThrowingContinuation { cont in
            store.execute(HKActivitySummaryQuery(predicate: predicate) { _, summaries, error in
                if let error { cont.resume(throwing: error) } else { cont.resume(returning: summaries ?? []) }
            })
        }
    }
}
