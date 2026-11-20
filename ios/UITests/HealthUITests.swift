import XCTest

/// Simulator: the app (launched with -healthSelfTest) seeds sample health data and reads it into
/// its outbox; this test only gets it past HealthKit's permission sheets. scripts/ios checks the
/// outbox afterwards.
@MainActor
final class HealthUITests: XCTestCase {
    func testSeedAndRead() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-healthSelfTest", "YES"]
        app.launch()
        let sheet = XCUIApplication(bundleIdentifier: "com.apple.HealthPrivacyService")
        // one or two sheets (writing the samples, then reading everything); each may take steps
        for _ in 0 ..< 2 {
            let selectAll = sheet.cells["UIA.Health.AuthSheet.AllCategoryButton"]
            guard selectAll.waitForExistence(timeout: 15) else { break }
            selectAll.tap()
            for _ in 0 ..< 4 {
                let everything = sheet.staticTexts["All Recorded Data and Future Data"]
                if everything.exists, everything.isHittable { everything.tap() }
                let next = sheet.staticTexts.matching(NSPredicate(format: "label IN %@", ["Continue", "Allow"])).firstMatch
                guard next.waitForExistence(timeout: 3) else { break }
                if !next.isHittable { sheet.swipeUp() }
                next.tap()
            }
        }
        Thread.sleep(forTimeInterval: 15) // the first read backfills; let it finish
    }
}
