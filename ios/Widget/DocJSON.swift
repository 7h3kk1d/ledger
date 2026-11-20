// Read an Automerge doc the way JS sees it: maps, lists, and text objects as plain strings.
//
// Interop finding: automerge-swift's AutomergeDecoder rejects a text object where a String is
// expected ("Expected to decode String but found Object<…, Text>"), and JS Automerge 3 writes
// every string as a text object. So docs are read by converting to a JSON tree and decoding
// that with JSONDecoder.
import Automerge
import Foundation

enum DocJSON {
    static func tree(_ doc: Document, _ obj: ObjId = .ROOT) throws -> Any {
        var out: [String: Any] = [:]
        for (key, value) in try doc.mapEntries(obj: obj) { out[key] = try convert(doc, value) }
        return out
    }

    private static func convert(_ doc: Document, _ value: Value) throws -> Any {
        switch value {
        case let .Object(id, .Map): return try tree(doc, id)
        case let .Object(id, .List): return try doc.values(obj: id).map { try convert(doc, $0) }
        case let .Object(id, .Text): return try doc.text(obj: id)
        case let .Scalar(s):
            switch s {
            case let .String(x): return x
            case let .Int(x): return x
            case let .Uint(x): return x
            case let .F64(x): return x
            case let .Counter(x): return x
            case let .Boolean(x): return x
            case let .Timestamp(x): return x.timeIntervalSince1970 * 1000
            case .Null: return NSNull()
            case .Bytes, .Unknown: return NSNull()
            }
        default: return NSNull()
        }
    }

    static func decode<T: Decodable>(_ type: T.Type, from doc: Document) throws -> T {
        let data = try JSONSerialization.data(withJSONObject: try tree(doc))
        return try JSONDecoder().decode(type, from: data)
    }
}
