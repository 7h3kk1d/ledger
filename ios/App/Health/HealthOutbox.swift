// Batches wait in the app group's health/outbox/ until a receiver has them (spec/healthkit-batch.md):
// pushed oldest first, gzipped, deleted only on a 2xx. The push token is kept in the Keychain.
import Compression
import Foundation
import Security

struct HealthOutbox {
    let dir: URL

    func add(_ batch: HealthBatch, now: Date = Date()) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = String(format: "%013.0f-%@.json", now.timeIntervalSince1970 * 1000, batch.batch_id)
        try batch.encoded().write(to: dir.appending(path: name), options: .atomic)
    }

    /// Waiting batches, oldest first.
    func pending() -> [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }
}

enum HealthPush {
    struct Result: Equatable {
        var pushed = 0
        var error: String?
    }

    /// Send what's waiting, oldest first, stopping at the first failure (it's tried again next sync).
    static func send(_ outbox: HealthOutbox, to url: URL, token: String,
                     post: (URLRequest, Data) async throws -> Int = urlSessionPost) async -> Result {
        var result = Result()
        for file in outbox.pending() {
            do {
                var req = URLRequest(url: url, timeoutInterval: 60)
                req.httpMethod = "POST"
                req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.setValue("gzip", forHTTPHeaderField: "Content-Encoding")
                let status = try await post(req, gzip(try Data(contentsOf: file)))
                guard (200 ..< 300).contains(status) else {
                    result.error = "the receiver answered \(status)"
                    return result
                }
                try FileManager.default.removeItem(at: file)
                result.pushed += 1
            } catch {
                result.error = error.localizedDescription
                return result
            }
        }
        return result
    }

    static func urlSessionPost(_ req: URLRequest, _ body: Data) async throws -> Int {
        let (_, response) = try await URLSession.shared.upload(for: req, from: body)
        return (response as? HTTPURLResponse)?.statusCode ?? 0
    }

    /// RFC 1952 gzip: a raw DEFLATE stream (Compression's ZLIB) with gzip's header and trailer.
    static func gzip(_ data: Data) -> Data {
        var out = Data([0x1F, 0x8B, 0x08, 0, 0, 0, 0, 0, 0, 0xFF])
        let capacity = max(64, data.count + data.count / 100 + 64)
        let deflated: Data = data.withUnsafeBytes { src in
            let dst = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)
            defer { dst.deallocate() }
            let n = compression_encode_buffer(dst, capacity, src.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
            return Data(bytes: dst, count: n)
        }
        out.append(deflated)
        var crc = crc32(data).littleEndian
        var size = UInt32(truncatingIfNeeded: data.count).littleEndian
        out.append(Data(bytes: &crc, count: 4))
        out.append(Data(bytes: &size, count: 4))
        return out
    }

    private static let crcTable: [UInt32] = (0 ..< 256).map { n -> UInt32 in
        var c = UInt32(n)
        for _ in 0 ..< 8 { c = c & 1 != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func crc32(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        for b in data { c = crcTable[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFF_FFFF
    }
}

/// The push token, in the Keychain (never in the web view's storage or the Ledger doc).
enum HealthToken {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "me.bandukwala.Ledger.health-push",
        kSecAttrAccount as String: "token",
    ]

    static func get() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ token: String?) {
        SecItemDelete(query as CFDictionary)
        guard let token, !token.isEmpty else { return }
        var q = query
        q[kSecValueData as String] = Data(token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }
}
