// New HealthKit data while the app is closed: HealthKit wakes the app (background delivery) and an
// observer query runs a sync, which reads what's new and pushes it. Observers must be set up at
// every launch, before didFinishLaunching returns (AppDelegate), or wakes are lost.
import Foundation
import HealthKit

enum HealthBackground {
    /// What wakes the app, and how often iOS may. A workout or a weigh-in goes at once; the rest
    /// rides along with the next wake (a sync reads every kind), at most hourly.
    static let wakes: [(type: HKSampleType, frequency: HKUpdateFrequency)] = [
        (.workoutType(), .immediate),
        (HKQuantityType(.bodyMass), .immediate),
        (HKCategoryType(.sleepAnalysis), .hourly),
        (HKQuantityType(.stepCount), .hourly),
        (HKQuantityType(.heartRate), .hourly),
    ]

    /// iOS gives a wake about 30 s: say we're done by then even if the sync goes on (it saves its
    /// place after every batch, so being suspended loses nothing).
    static let answerWithin: Duration = .seconds(25)

    private static var started = false

    /// At launch (and once connected): observe, and ask iOS to wake the app for new data.
    @MainActor
    static func start() {
        guard !started, HKHealthStore.isHealthDataAvailable() else { return }
        // synchronously, from the saved state: connected once the sheet was answered (authorize starts it then)
        let state = HealthState.load(HealthSync.shared.dir.appending(path: "state.json"))
        guard state.connected == true || state.lastRead != nil else { return }
        started = true
        let store = HealthSync.shared.store
        for w in wakes {
            store.execute(HKObserverQuery(sampleType: w.type, predicate: nil) { _, done, error in
                guard error == nil else { return done() }
                let once = Once(done)
                Task {
                    try? await Task.sleep(for: answerWithin)
                    once.call()
                }
                Task {
                    _ = await HealthSync.shared.sync()
                    once.call()
                }
            })
            store.enableBackgroundDelivery(for: w.type, frequency: w.frequency) { _, _ in }
        }
        Task { await HealthSync.shared.watchNetwork() }
    }
}

/// A completion handler HealthKit wants called exactly once.
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var f: (() -> Void)?

    init(_ f: @escaping () -> Void) { self.f = f }

    func call() {
        lock.lock()
        let g = f
        f = nil
        lock.unlock()
        g?()
    }
}
