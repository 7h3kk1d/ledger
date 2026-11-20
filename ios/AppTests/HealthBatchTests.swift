import Compression
import XCTest
@testable import Ledger

final class HealthBatchTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    }

    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    private func batch(_ workouts: [HealthWorkout] = []) -> HealthBatch {
        HealthBatch(created_at: "2026-11-20T09:00:00.000Z", app: "ledger-ios 0.1.0",
                    device: HealthDevice(id: "d1", name: "iPhone", model: "iPhone16,1", os: "27.2"),
                    time_zone: "America/New_York", workouts: workouts)
    }

    private let trainerize = HealthWorkout(
        uuid: "w1", start: "2026-11-18T21:17:03.000Z", end: "2026-11-18T22:06:09.000Z", duration_s: 2946,
        activity_type: 73, activity: "crossTraining",
        source: HealthSource(name: "Fitness App", bundle_id: "com.trainerize.Trainerize", version: "9.1"),
        metadata: ["HKWorkoutBrandName": .string("Neck/Shoulder"), "HKIndoorWorkout": .bool(false), "HKAverageMETs": .number(5.7)],
        energy_kcal: 541, heart_rate: .init(min: 70, avg: 112, max: 151))

    // the shape spec/healthkit-batch.md promises a receiver
    func testEncodesTheSpecShape() throws {
        let json = try JSONSerialization.jsonObject(with: batch([trainerize]).encoded()) as! [String: Any]
        XCTAssertEqual(json["schema"] as? Int, 1)
        XCTAssertEqual((json["device"] as? [String: Any])?["id"] as? String, "d1")
        XCTAssertNil(json["sleep"]) // lists a batch doesn't carry are left out
        let w = (json["workouts"] as! [[String: Any]])[0]
        XCTAssertEqual(w["activity"] as? String, "crossTraining")
        XCTAssertEqual((w["source"] as? [String: Any])?["bundle_id"] as? String, "com.trainerize.Trainerize")
        let md = w["metadata"] as! [String: Any]
        XCTAssertEqual(md["HKWorkoutBrandName"] as? String, "Neck/Shoulder")
        XCTAssertEqual(md["HKIndoorWorkout"] as? Bool, false)
        XCTAssertEqual(md["HKAverageMETs"] as? Double, 5.7)
        XCTAssertEqual((w["heart_rate"] as? [String: Any])?["max"] as? Double, 151)
        XCTAssertNil(w["distance_m"])
        // round-trips
        let b = batch([trainerize])
        XCTAssertEqual(try JSONDecoder().decode(HealthBatch.self, from: b.encoded()), b)
    }

    func testGzipIsRFC1952() throws {
        let text = Data(String(repeating: "Neck/Shoulder ", count: 500).utf8)
        let gz = HealthPush.gzip(text)
        XCTAssertEqual(Array(gz.prefix(3)), [0x1F, 0x8B, 0x08])
        XCTAssertLessThan(gz.count, text.count / 5)
        // inflate the body and check the trailer's crc and size
        let body = gz.dropFirst(10).dropLast(8)
        let out = UnsafeMutablePointer<UInt8>.allocate(capacity: text.count * 2)
        defer { out.deallocate() }
        let n = Data(body).withUnsafeBytes { compression_decode_buffer(out, text.count * 2, $0.bindMemory(to: UInt8.self).baseAddress!, body.count, nil, COMPRESSION_ZLIB) }
        XCTAssertEqual(Data(bytes: out, count: n), text)
        let trailer = Array(gz.suffix(8))
        let crc = UInt32(trailer[0]) | UInt32(trailer[1]) << 8 | UInt32(trailer[2]) << 16 | UInt32(trailer[3]) << 24
        XCTAssertEqual(crc, HealthPush.crc32(text))
        XCTAssertEqual(HealthPush.crc32(Data("123456789".utf8)), 0xCBF4_3926) // the standard check value
    }

    func testPushSendsOldestFirstAndKeepsWhatFailed() async throws {
        let outbox = HealthOutbox(dir: dir)
        for i in 0 ..< 3 { try outbox.add(batch(), now: Date(timeIntervalSince1970: Double(i))) }
        let names = outbox.pending().map(\.lastPathComponent)
        var sent: [String] = []
        var calls = 0
        let r = await HealthPush.send(outbox, to: URL(string: "https://example.test/ingest")!, token: "t0k") { req, body in
            calls += 1
            XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer t0k")
            XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Encoding"), "gzip")
            XCTAssertEqual(Array(body.prefix(2)), [0x1F, 0x8B])
            sent.append(names[calls - 1])
            return calls == 2 ? 503 : 202
        }
        XCTAssertEqual(r, HealthPush.Result(pushed: 1, error: "the receiver answered 503"))
        XCTAssertEqual(sent, Array(names.prefix(2)))
        XCTAssertEqual(outbox.pending().map(\.lastPathComponent), Array(names.dropFirst())) // the failed one waits
    }

    func testStateRoundTrips() throws {
        let url = dir.appending(path: "state.json")
        var s = HealthState()
        s.anchors["workouts"] = Data([1, 2, 3])
        s.hourlyFrom["stepCount"] = Date(timeIntervalSince1970: 1_700_000_000)
        s.pushUrl = "https://example.test/ingest"
        try s.save(url)
        let back = HealthState.load(url)
        XCTAssertEqual(back.deviceId, s.deviceId)
        XCTAssertEqual(back.anchors, s.anchors)
        XCTAssertEqual(back.hourlyFrom, s.hourlyFrom)
        XCTAssertEqual(HealthState.load(dir.appending(path: "missing.json")).anchors, [:])
    }
}
