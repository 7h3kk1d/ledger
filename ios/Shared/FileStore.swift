// automerge-repo's storage as plain files, so Ledger's data lives in the app's own container (or
// the app group a widget shares) instead of WebKit's IndexedDB, which iOS treats as best-effort.
//
// A storage key is a list of strings (["<docId>", "snapshot", "<hash>"], ["storage-adapter-id"]).
// Each element is a directory, percent-encoded; the last one is a file named "<element>.am", so
// no key's file can collide with another key's directory. Writes are atomic.
import Foundation

struct FileStore {
    let root: URL

    /// The app group shared with extensions (a widget), else Application Support.
    static func defaultRoot(appGroup: String = "group.me.bandukwala.Ledger") -> URL {
        let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
            ?? URL.applicationSupportDirectory
        return base.appending(path: "automerge", directoryHint: .isDirectory)
    }

    private static let safe = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
    private static let suffix = ".am"

    static func encode(_ part: String) -> String {
        // percent-encode everything but [A-Za-z0-9-_]: no "/", "." or ".." reaches the path
        part.addingPercentEncoding(withAllowedCharacters: safe) ?? part
    }

    private func dir(_ prefix: [String]) -> URL {
        prefix.reduce(root) { $0.appending(path: Self.encode($1), directoryHint: .isDirectory) }
    }

    func file(_ key: [String]) -> URL {
        precondition(!key.isEmpty, "empty storage key")
        return dir(Array(key.dropLast())).appending(path: Self.encode(key.last!) + Self.suffix, directoryHint: .notDirectory)
    }

    func load(_ key: [String]) throws -> Data? {
        let url = file(key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try Data(contentsOf: url)
    }

    func save(_ key: [String], _ data: Data) throws {
        let url = file(key)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func remove(_ key: [String]) throws {
        let url = file(key)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }

    /// Every entry whose key starts with `prefix` (including one equal to it).
    func loadRange(_ prefix: [String]) throws -> [(key: [String], data: Data)] {
        var out: [(key: [String], data: Data)] = []
        if !prefix.isEmpty, let exact = try load(prefix) { out.append((prefix, exact)) }
        let base = dir(prefix)
        guard let walker = FileManager.default.enumerator(at: base, includingPropertiesForKeys: [.isRegularFileKey]) else {
            return out
        }
        for case let url as URL in walker where url.lastPathComponent.hasSuffix(Self.suffix) {
            let rel = url.standardizedFileURL.path.dropFirst(base.standardizedFileURL.path.count)
            var parts = rel.split(separator: "/").map(String.init)
            guard let last = parts.popLast() else { continue }
            parts.append(String(last.dropLast(Self.suffix.count)))
            let key = prefix + parts.map { $0.removingPercentEncoding ?? $0 }
            out.append((key, try Data(contentsOf: url)))
        }
        return out
    }

    func removeRange(_ prefix: [String]) throws {
        if !prefix.isEmpty { try remove(prefix) }
        let base = dir(prefix)
        if prefix.isEmpty {
            // never the root itself: just what's in it
            for url in (try? FileManager.default.contentsOfDirectory(at: base, includingPropertiesForKeys: nil)) ?? [] {
                try FileManager.default.removeItem(at: url)
            }
        } else if FileManager.default.fileExists(atPath: base.path) {
            try FileManager.default.removeItem(at: base)
        }
    }
}
