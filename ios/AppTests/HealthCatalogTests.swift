import HealthKit
import XCTest
@testable import Ledger

/// HealthCatalog is generated from the SDK's header: every unit must parse (HKUnit(from:) raises an
/// Objective-C exception otherwise, which crashes the app) and fit its type.
final class HealthCatalogTests: XCTestCase {
    func testEveryQuantityUnitFitsItsType() {
        for q in HealthCatalog.quantities {
            guard let type = HKQuantityType.quantityType(forIdentifier: q.id) else { continue } // newer than this iOS
            XCTAssertTrue(type.is(compatibleWith: HKUnit(from: q.unit)), "\(q.name): \(q.unit)")
        }
    }

    func testNamesAreUniqueAndEveryKnownTypeIsRead() {
        let names = HealthCatalog.quantities.map(\.name) + HealthCatalog.categories.map(\.name)
        XCTAssertEqual(Set(names).count, names.count)
        XCTAssertEqual(HealthTypes.sparse.count + HealthTypes.hourly.count, HealthTypes.byType.count)
        XCTAssertGreaterThan(HealthTypes.sparse.count, 90)
        XCTAssertGreaterThan(HealthTypes.categories.count, 60)
        // the names other code reads (signals.sql, the on-device rules) keep their spelling and unit
        XCTAssertEqual(HealthTypes.byName["bodyMass"]?.label, "kg")
        XCTAssertEqual(HealthTypes.byName["vo2Max"]?.label, "ml/(kg*min)")
        XCTAssertEqual(HealthTypes.byName["heartRate"]?.label, "count/min")
        XCTAssertTrue(HealthTypes.hourly.contains { $0.name == "stepCount" && $0.stat == .sum })
        XCTAssertTrue(HealthTypes.categories.contains { $0.name == "handwashingEvent" })
        XCTAssertFalse(HealthTypes.categories.contains { $0.name == "sleepAnalysis" }) // its own list
        XCTAssertEqual(HealthTypes.activityName(.functionalStrengthTraining), "functionalStrengthTraining")
        XCTAssertEqual(HealthTypes.activityName(.highIntensityIntervalTraining), "highIntensityIntervalTraining")
        // asking to read dose events in the general request raises (and crashed the app): they come per medication
        if #available(iOS 26.0, *) { XCTAssertFalse(HealthTypes.readTypes.contains(HKObjectType.medicationDoseEventType())) }
    }

    func testNewKindsEncodeAndCount() throws {
        var b = HealthBatch(created_at: "2026-11-22T09:00:00.000Z", app: "ledger-ios 0.1.0",
                            device: HealthDevice(id: "d1", name: "iPhone", model: "iPhone16,1", os: "27.2"), time_zone: "UTC")
        XCTAssertTrue(b.isEmpty)
        let src = HealthSource(name: "Watch", bundle_id: "com.apple.health")
        b.categories = [HealthCategory(uuid: "c1", type: "handwashingEvent", start: "s", end: "e", value: 0, source: src)]
        b.workout_series = [HealthWorkoutSeries(workout: "w1", type: "heartRate", minute: "m", unit: "count/min", min: 90, avg: 120, max: 150)]
        b.workout_routes = [HealthWorkoutRoute(workout: "w1", uuid: "r1", points: [HealthRoutePoint(at: "t", lat: 42.3, lon: -83.7, alt: 260)])]
        b.state_of_mind = [HealthStateOfMind(uuid: "m1", start: "s", end: "s", kind: "dailyMood", valence: 0.4,
                                             classification: "slightlyPleasant", labels: ["calm"], associations: ["work"], source: src)]
        b.deleted = [HealthDeleted(kind: "category", uuid: "c0")]
        XCTAssertEqual(b.count, 5)
        let json = try JSONSerialization.jsonObject(with: b.encoded()) as! [String: Any]
        let route = (json["workout_routes"] as! [[String: Any]])[0]
        XCTAssertEqual(((route["points"] as! [[String: Any]])[0]["lat"] as? Double), 42.3)
        XCTAssertNil((route["points"] as! [[String: Any]])[0]["speed"]) // unknown: left out
        XCTAssertEqual((json["categories"] as! [[String: Any]])[0]["value"] as? Int, 0)
        XCTAssertEqual(HealthReader.named(HealthReader.moodLabels, 7), "calm")
        XCTAssertEqual(HealthReader.named(HealthReader.moodLabels, 99), "99")
    }
}
