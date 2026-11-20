import XCTest

/// On the simulator: put the Today widget on the home screen (once), tap a habit in it, bring the
/// app back and check it shows the tick. Run with a test ledger (scripts/ios uitest).
@MainActor
final class WidgetUITests: XCTestCase {
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let habit = ProcessInfo.processInfo.environment["TICK"].flatMap { $0.isEmpty ? nil : $0 } ?? "Spike: water"

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func need(_ e: XCUIElement, _ what: String, timeout: TimeInterval = 8) {
        if !e.waitForExistence(timeout: timeout) {
            attach("missing \(what)")
            XCTFail("no \(what):\n\(springboard.debugDescription)")
        }
    }

    private func addWidget() {
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75)).press(forDuration: 1.5)
        need(springboard.buttons["Edit"], "Edit")
        springboard.buttons["Edit"].tap()
        need(springboard.buttons["Add Widget"], "Add Widget")
        springboard.buttons["Add Widget"].tap()
        let search = springboard.searchFields.firstMatch
        need(search, "widget search")
        search.tap()
        search.typeText("Ledger")
        let result = springboard.cells.matching(NSPredicate(format: "label == %@", "Ledger")).firstMatch
        need(result, "Ledger in the gallery")
        result.tap()
        let confirm = springboard.buttons.matching(NSPredicate(format: "label ENDSWITH %@", " Add Widget")).firstMatch
        need(confirm, "Add Widget confirm")
        confirm.tap()
        if springboard.buttons["Done"].waitForExistence(timeout: 3) { springboard.buttons["Done"].tap() }
    }

    private func tile(_ app: XCUIApplication) -> XCUIElement {
        app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", habit)).firstMatch
    }

    func testTickFromWidget() throws {
        let app = XCUIApplication()
        app.launch() // publishes today's rows for the widget
        XCTAssertTrue(tile(app).waitForExistence(timeout: 30), "ledger never opened:\n\(app.debugDescription)")
        let before = tile(app).value as? String
        XCUIDevice.shared.press(.home)

        let row = springboard.buttons.matching(NSPredicate(format: "label CONTAINS %@", habit)).firstMatch
        if !row.waitForExistence(timeout: 4) { addWidget() }
        need(row, "widget row for \(habit)", timeout: 15)
        attach("widget before")
        row.tap()
        Thread.sleep(forTimeInterval: 2)
        attach("widget after")

        app.activate()
        let deadline = Date().addingTimeInterval(10)
        while tile(app).value as? String == before, Date() < deadline { Thread.sleep(forTimeInterval: 0.3) }
        attach("app after")
        XCTAssertNotEqual(tile(app).value as? String, before, "the app didn't take the widget's tick")
        Thread.sleep(forTimeInterval: 4) // let it sync
    }
}
