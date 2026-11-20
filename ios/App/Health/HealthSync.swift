// One HealthKit sync at a time: read what's new into the outbox, then push it if a receiver is set.
import Foundation
import HealthKit
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
        var asked: Bool
        var lastRead: Date?
        var lastReadCount: Int?
        var lastReadError: String?
        var waiting: Int
        var pushUrl: String?
        var hasToken: Bool
        var lastPushAt: Date?
        var lastPushCount: Int?
        var lastPushError: String?
    }

    func status() async -> Status {
        let s = HealthState.load(stateURL)
        let asked = await withCheckedContinuation { c in
            store.getRequestStatusForAuthorization(toShare: [], read: HealthTypes.readTypes) { status, _ in
                c.resume(returning: status == .unnecessary)
            }
        }
        return Status(available: HKHealthStore.isHealthDataAvailable(), asked: asked, lastRead: s.lastRead,
                      lastReadCount: s.lastReadCount, lastReadError: s.lastReadError, waiting: outbox.pending().count,
                      pushUrl: s.pushUrl, hasToken: HealthToken.get() != nil, lastPushAt: s.lastPushAt,
                      lastPushCount: s.lastPushCount, lastPushError: s.lastPushError)
    }

    func authorize() async throws {
        try await store.requestAuthorization(toShare: [], read: HealthTypes.readTypes)
    }

    func setPush(url: String?, token: String?) throws {
        var s = HealthState.load(stateURL)
        s.pushUrl = url?.isEmpty == false ? url : nil
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

    private func run() async -> Status {
        var state = HealthState.load(stateURL)
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
                persist: { try $0.save(stateURL) })
            do {
                let n = try await reader.run()
                state = reader.state
                state.lastRead = Date()
                state.lastReadCount = n
                state.lastReadError = nil
            } catch {
                state = reader.state
                state.lastReadError = error.localizedDescription
            }
            try? state.save(stateURL)
        }
        if let raw = state.pushUrl, let url = URL(string: raw), let token = HealthToken.get(), !outbox.pending().isEmpty {
            let r = await HealthPush.send(outbox, to: url, token: token)
            state = HealthState.load(stateURL)
            state.lastPushAt = Date()
            state.lastPushCount = r.pushed
            state.lastPushError = r.error
            try? state.save(stateURL)
        }
        return await status()
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
        try await store.requestAuthorization(toShare: [workout, sleep, mass, steps, hr], read: HealthTypes.readTypes)

        let config = HKWorkoutConfiguration()
        config.activityType = .functionalStrengthTraining
        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: nil)
        let start = now.addingTimeInterval(-3 * 3600)
        try await builder.beginCollection(at: start)
        try await builder.addMetadata([HKMetadataKeyWorkoutBrandName: "Neck/Shoulder"])
        try await builder.endCollection(at: start.addingTimeInterval(45 * 60))
        _ = try await builder.finishWorkout()

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
        let bpm = HKUnit.count().unitDivided(by: .minute())
        var beats: [HKQuantitySample] = []
        for i in 0 ..< 6 {
            let at: Date = now.addingTimeInterval(Double(i * 5 - 80) * 60)
            let value: Double = 60 + Double(i) * 10
            beats.append(HKQuantitySample(type: hr, quantity: HKQuantity(unit: bpm, doubleValue: value), start: at, end: at))
        }
        try await store.save(nights + [weigh, walk] + beats)
    }
    #endif
}
