// Home-screen widget: today's habits as Ledger lists them, tap to tick. Ledger's JS publishes the
// rows (widget.json); a tap writes the check-in into the ledger doc on this device
// (WidgetActions.toggle) for the app to sync when it next runs.
import AppIntents
import SwiftUI
import WidgetKit

private let store = FileStore(root: FileStore.defaultRoot())

struct ToggleHabitIntent: AppIntent {
    static let title: LocalizedStringResource = "Tick habit"
    static let isDiscoverable = false

    @Parameter(title: "Habit id") var habitId: String

    init() {}
    init(habitId: String) { self.habitId = habitId }

    func perform() async throws -> some IntentResult {
        try WidgetActions.toggle(habitId: habitId, store: store)
        return .result()
    }
}

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    let rows: [WidgetSnapshot.Row]
}

struct Provider: TimelineProvider {
    func placeholder(in _: Context) -> Entry {
        Entry(date: Date(), snapshot: nil, rows: [
            .init(id: "1", name: "Stretch", hue: 210, done: true, manual: true, sub: nil),
            .init(id: "2", name: "Read", hue: 30, done: false, manual: true, sub: nil),
        ])
    }

    private func entry() -> Entry {
        let snap = WidgetSnapshot.read()
        return Entry(date: Date(), snapshot: snap, rows: snap.map { WidgetActions.rows($0, store: store) } ?? [])
    }

    func getSnapshot(in _: Context, completion: @escaping (Entry) -> Void) { completion(entry()) }

    func getTimeline(in _: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        // the app and taps reload it; else redraw at midnight, when the day's ticks reset
        let midnight = Calendar.current.startOfDay(for: Date().addingTimeInterval(86400))
        completion(Timeline(entries: [entry()], policy: .after(midnight)))
    }
}

struct LedgerWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Entry

    private var limit: Int { family == .systemLarge ? 11 : 4 }

    var body: some View {
        VStack(alignment: .leading, spacing: family == .systemSmall ? 5 : 6) {
            HStack {
                Text(entry.snapshot?.name ?? "Today").font(.caption.bold()).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                if !entry.rows.isEmpty {
                    Text("\(entry.rows.filter(\.done).count)/\(entry.rows.count)").font(.caption.bold()).foregroundStyle(.secondary)
                }
            }
            if entry.snapshot == nil {
                Text("Open Ledger once to show today’s habits here.").font(.caption)
            } else if entry.rows.isEmpty {
                Text("Nothing due today.").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(entry.rows.prefix(limit)) { row in
                // a Toggle, not a Button: the system flips it the moment it's tapped, while the
                // intent writes the tick (a Button only changes once the widget has redrawn)
                Toggle(isOn: row.done, intent: ToggleHabitIntent(habitId: row.id)) {
                    HStack(spacing: 6) {
                        Text(row.name).font(.subheadline).lineLimit(1)
                        Spacer(minLength: 0)
                        if family != .systemSmall, let sub = row.sub {
                            Text(sub).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
                .toggleStyle(Check(hue: row.hue))
            }
            Spacer(minLength: 0)
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

/// A row's tick: a circle in the habit's colour, done or not.
struct Check: ToggleStyle {
    let hue: Double

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            Image(systemName: configuration.isOn ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(configuration.isOn ? Color(hue: hue / 360, saturation: 0.65, brightness: 0.8) : Color.secondary)
            configuration.label.foregroundStyle(configuration.isOn ? .secondary : .primary)
        }
        .contentShape(Rectangle())
    }
}

struct LedgerTodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LedgerToday", provider: Provider()) { LedgerWidgetView(entry: $0) }
            .configurationDisplayName("Today")
            .description("Today’s habits; tap one to tick it off.")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct LedgerWidgets: WidgetBundle {
    var body: some Widget { LedgerTodayWidget() }
}
