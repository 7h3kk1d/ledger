// One HealthKit sync at a time: read what's new into the outbox, then push it if a receiver is set.
import Foundation
import CoreLocation
import HealthKit
import Network
import UIKit

actor HealthSync {
    static let shared = HealthSync()

    let store = HKHealthStore()
    let dir = WidgetFiles.container.appending(path: "health", directoryHint: .isDirectory)
    var stateURL: URL { dir.appending(path: "state.json") }
    var outbox: HealthOutbox { HealthOutbox(dir: dir.appending(path: "outbox", directoryHint: .isDirectory)) }
    private var running: Task<Status, Never>?

    struct Status: Codable {
        var available: Bool
        /// Connected: the sheet was answered once (iOS doesn't say what was allowed).
        var asked: Bool
        /// Kinds added since then wait for the sheet to be answered again.
        var newKinds: Bool
        var lastRead: Date?
        var lastReadCount: Int?
        var lastReadError: String?
        var waiting: Int
        var pushUrl: String?
        var hasToken: Bool
        var lastPushAt: Date?
        var lastPushCount: Int?
        var lastPushError: String?
        /// Batches the receiver refused for good, set aside in health/rejected/.
        var rejected: Int
        /// Batches waiting for Wi-Fi (the last push spent its cellular budget).
        var held: Int
        /// History is still being read (a slice per sync; on Wi-Fi, all of it).
        var backfilling: Bool
    }

    func status() async -> Status {
        let s = HealthState.load(stateURL)
        let current = await withCheckedContinuation { c in
            store.getRequestStatusForAuthorization(toShare: [], read: HealthTypes.readTypes) { status, _ in
                c.resume(returning: status == .unnecessary)
            }
        }
        // an install that read before is connected, even if a newer build reads more kinds
        let asked = current || s.connected == true || s.lastRead != nil
        return Status(available: HKHealthStore.isHealthDataAvailable(), asked: asked, newKinds: asked && !current, lastRead: s.lastRead,
                      lastReadCount: s.lastReadCount, lastReadError: s.lastReadError, waiting: outbox.pending().count,
                      pushUrl: s.pushUrl, hasToken: HealthToken.get() != nil, lastPushAt: s.lastPushAt,
                      lastPushCount: s.lastPushCount, lastPushError: s.lastPushError,
                      rejected: outbox.rejected().count, held: s.lastPushHeld ?? 0, backfilling: s.backfilling == true)
    }

    func authorize() async throws {
        try await store.requestAuthorization(toShare: [], read: HealthTypes.readTypes)
        var s = HealthState.load(stateURL)
        s.connected = true
        try s.save(stateURL)
        await HealthBackground.start()
        // each on a sheet of its own; declining one leaves the rest syncing. Health records need the
        // health-records entitlement (project.yml): asking without it would raise, not fail
        let clinical = Set(HealthTypes.clinical.compactMap { HKClinicalType.clinicalType(forIdentifier: $0.id) as HKObjectType? })
        try? await store.requestAuthorization(toShare: [], read: clinical)
        try? await store.requestPerObjectReadAuthorization(for: .visionPrescriptionType(), predicate: nil)
        // medications are shared one by one too
        if #available(iOS 26.0, *) {
            try? await store.requestPerObjectReadAuthorization(for: .userAnnotatedMedicationType(), predicate: nil)
        }
    }

    func setPush(url: String?, token: String?) throws {
        var s = HealthState.load(stateURL)
        let new = url?.isEmpty == false ? url : nil
        // a new receiver, or a new token: what the old setup refused gets another chance
        if new != s.pushUrl || token != nil { try outbox.requeueRejected() }
        s.pushUrl = new
        try s.save(stateURL)
        if let token { HealthToken.set(token) }
    }

    /// Read and push; a sync already under way is joined, not started again.
    func sync() async -> Status {
        if let running { return await running.value }
        let task = Task { await self.run() }
        running = task
        let result = await task.value
        running = nil
        return result
    }

    /// The outbox holds at most this much (uncompressed) before reading pauses: a first sync's
    /// backfill (years of heart rate) is read and sent a slice at a time, not all onto the phone.
    static let outboxCap = 32 << 20
    /// On a metered network (cellular, Low Data Mode), one push sends at most this much
    /// (compressed); the rest waits for Wi-Fi. A day's steady state is far under it.
    static let meteredBudget = 5 << 20

    private func run() async -> Status {
        var state = HealthState.load(stateURL)
        // on Wi-Fi, a backfill goes on: read a slice, send it, read the next
        for _ in 0 ..< 1000 {
            var full = false
            if HKHealthStore.isHealthDataAvailable() {
                let device = await MainActor.run {
                    HealthDevice(id: state.deviceId, name: UIDevice.current.name, model: Self.model(), os: UIDevice.current.systemVersion)
                }
                let app = "ledger-ios \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")"
                let outbox = self.outbox
                let stateURL = self.stateURL
                let reader = HealthReader(
                    store: store, state: state,
                    newBatch: { HealthBatch(created_at: HealthTime.string(Date()), app: app, device: device, time_zone: TimeZone.current.identifier) },
                    emit: { try outbox.add($0) },
                    persist: { try $0.save(stateURL) },
                    room: { outbox.pendingBytes() < Self.outboxCap })
                do {
                    let n = try await reader.run()
                    state = reader.state
                    state.lastRead = Date()
                    state.lastReadCount = n
                    state.lastReadError = reader.problems.isEmpty ? nil : reader.problems.joined(separator: "; ")
                } catch {
                    state = reader.state
                    state.lastReadError = error.localizedDescription
                }
                state.backfilling = reader.full
                full = reader.full
                try? state.save(stateURL)
            }
            guard let raw = state.pushUrl, let url = URL(string: raw), let token = HealthToken.get(), !outbox.pending().isEmpty else { break }
            let r = await HealthPush.send(outbox, to: url, token: token, budget: unmetered ? nil : Self.meteredBudget)
            state = HealthState.load(stateURL)
            state.lastPushAt = Date()
            state.lastPushCount = r.pushed
            state.lastPushHeld = r.held
            state.lastPushError = r.error
            try? state.save(stateURL)
            guard full, unmetered, r.error == nil, r.held == 0 else { break }
        }
        return await status()
    }

    private var monitor: NWPathMonitor?
    /// Wi-Fi or wired, not Low Data Mode: no push budget. Until the monitor has answered, metered.
    private var unmetered = false

    private func network(_ path: NWPath) {
        let was = unmetered
        unmetered = path.status == .satisfied && !path.isExpensive && !path.isConstrained
        if unmetered, !was { Task { _ = await syncIfConnected() } }
    }

    /// While the app runs: when the network comes back, send what waited (reading what is new
    /// first), rather than leaving it for the next launch; on Wi-Fi, what waited for it too.
    func watchNetwork() {
        guard monitor == nil else { return }
        let m = NWPathMonitor()
        var wasOnline = true
        m.pathUpdateHandler = { path in
            let online = path.status == .satisfied
            defer { wasOnline = online }
            Task { await HealthSync.shared.network(path) }
            guard online, !wasOnline else { return }
            Task { _ = await HealthSync.shared.syncIfConnected() }
        }
        m.start(queue: DispatchQueue(label: "me.bandukwala.Ledger.network"))
        monitor = m
    }

    /// A sync, if HealthKit was connected (the sheet answered); nothing otherwise.
    func syncIfConnected() async -> Status? {
        let s = await status()
        guard s.available, s.asked else { return nil }
        return await sync()
    }

    private static func model() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
    }

    #if DEBUG
    /// Simulator tests only: write sample data the way other apps would (a titled workout, a
    /// night's sleep stages, a weigh-in, some steps and heart rate).
    func seed(now: Date = Date()) async throws {
        let workout = HKObjectType.workoutType()
        let sleep = HKCategoryType(.sleepAnalysis)
        let mass = HKQuantityType(.bodyMass), steps = HKQuantityType(.stepCount), hr = HKQuantityType(.heartRate)
        let ache = HKCategoryType(.headache), kcal = HKQuantityType(.dietaryEnergyConsumed), protein = HKQuantityType(.dietaryProtein)
        let route = HKSeriesType.workoutRoute(), mood = HKObjectType.stateOfMindType()
        try await store.requestAuthorization(toShare: [workout, sleep, mass, steps, hr, ache, kcal, protein, route, mood],
                                             read: HealthTypes.readTypes)

        // a titled workout, with heart rate during it and a short route
        let config = HKWorkoutConfiguration()
        config.activityType = .functionalStrengthTraining
        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: nil)
        let start = now.addingTimeInterval(-3 * 3600)
        let bpm = HKUnit.count().unitDivided(by: .minute())
        try await builder.beginCollection(at: start)
        try await builder.addMetadata([HKMetadataKeyWorkoutBrandName: "Neck/Shoulder"])
        let during = (0 ..< 9).map { i in
            let at = start.addingTimeInterval(Double(i * 5 + 1) * 60)
            return HKQuantitySample(type: hr, quantity: HKQuantity(unit: bpm, doubleValue: 100 + Double(i) * 5), start: at, end: at)
        }
        try await builder.addSamples(during)
        try await builder.endCollection(at: start.addingTimeInterval(45 * 60))
        if let w = try await builder.finishWorkout() {
            let points = (0 ..< 5).map { i in
                CLLocation(coordinate: CLLocationCoordinate2D(latitude: 42.28 + Double(i) * 0.001, longitude: -83.74), altitude: 260,
                           horizontalAccuracy: 5, verticalAccuracy: 3, course: 0, speed: 1.4,
                           timestamp: start.addingTimeInterval(Double(i) * 60))
            }
            let routeBuilder = HKWorkoutRouteBuilder(healthStore: store, device: nil)
            try await routeBuilder.insertRouteData(points)
            _ = try await routeBuilder.finishRoute(with: w, metadata: nil)
        }

        let bed = Calendar.current.startOfDay(for: now).addingTimeInterval(-2 * 3600) // 22:00 yesterday
        let stages: [(HKCategoryValueSleepAnalysis, TimeInterval, TimeInterval)] = [
            (.inBed, 0, 8 * 3600), (.asleepCore, 600, 3 * 3600), (.asleepDeep, 3 * 3600, 4 * 3600),
            (.asleepREM, 4 * 3600, 5 * 3600), (.awake, 5 * 3600, 5 * 3600 + 300), (.asleepCore, 5 * 3600 + 300, 8 * 3600),
        ]
        let nights = stages.map { HKCategorySample(type: sleep, value: $0.0.rawValue, start: bed.addingTimeInterval($0.1), end: bed.addingTimeInterval($0.2)) }
        let weigh = HKQuantitySample(type: mass, quantity: HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: 72.4),
                                     start: now.addingTimeInterval(-2 * 3600), end: now.addingTimeInterval(-2 * 3600))
        let walk = HKQuantitySample(type: steps, quantity: HKQuantity(unit: .count(), doubleValue: 1234),
                                    start: now.addingTimeInterval(-90 * 60), end: now.addingTimeInterval(-60 * 60))
        var beats: [HKQuantitySample] = []
        for i in 0 ..< 6 {
            let at: Date = now.addingTimeInterval(Double(i * 5 - 80) * 60)
            let value: Double = 60 + Double(i) * 10
            beats.append(HKQuantitySample(type: hr, quantity: HKQuantity(unit: bpm, doubleValue: value), start: at, end: at))
        }
        // a symptom, a meal (a correlation of its dietary samples), and a mood
        let headache = HKCategorySample(type: ache, value: HKCategoryValueSeverity.mild.rawValue,
                                        start: now.addingTimeInterval(-50 * 60), end: now.addingTimeInterval(-20 * 60))
        let mealAt = now.addingTimeInterval(-4 * 3600)
        let meal = HKCorrelation(type: HKCorrelationType(.food), start: mealAt, end: mealAt, objects: [
            HKQuantitySample(type: kcal, quantity: HKQuantity(unit: .kilocalorie(), doubleValue: 540), start: mealAt, end: mealAt),
            HKQuantitySample(type: protein, quantity: HKQuantity(unit: .gram(), doubleValue: 32), start: mealAt, end: mealAt),
        ], metadata: [HKMetadataKeyFoodType: "Lunch"])
        let feeling = HKStateOfMind(date: now.addingTimeInterval(-30 * 60), kind: .momentaryEmotion, valence: 0.4,
                                    labels: [.calm, .content], associations: [.work])
        try await store.save(nights + [weigh, walk, headache, meal, feeling] + beats)
    }
    #endif
}
