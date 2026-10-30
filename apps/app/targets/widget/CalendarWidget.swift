// The widget, its timeline and the bundle entry point.
//
// Timeline, not live (Design Spec WG, iOS): one entry at each event start and
// end, at midnight, and at the stale thresholds (30 min, then hourly for a day)
// so "Updated 3h ago" appears without the app running. "Ends in 25 min" and the
// progress bar use system timers, so they tick between entries.
//
// NOTE: this file has not been compiled (no Xcode in the build environment).

import SwiftUI
import WidgetKit

struct CalendarEntry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
    /// The widget gallery and the moment before the first timeline loads (WG 6d).
    var isPlaceholder = false
}

struct CalendarProvider: TimelineProvider {
    func placeholder(in context: Context) -> CalendarEntry {
        CalendarEntry(date: Date(), snapshot: Sample.snapshot(now: Date()), isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (CalendarEntry) -> Void) {
        if context.isPreview {
            completion(CalendarEntry(date: Date(), snapshot: Sample.snapshot(now: Date())))
        } else {
            completion(CalendarEntry(date: Date(), snapshot: Store.loadSnapshot()))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CalendarEntry>) -> Void) {
        let now = Date()
        let snap = Store.loadSnapshot()
        var dates: Set<Date> = [now]

        if let snap = snap {
            let horizon = now.addingTimeInterval(36 * 3600)
            for e in snap.events {
                for stamp in [e.s, e.e] {
                    if let d = Time.parseLocal(stamp), d > now, d < horizon { dates.insert(d) }
                }
            }
            // Midnight: "today" changes, so the goal numbers read as old.
            let midnight = Time.addDays(Time.startOfDay(now), 1)
            dates.insert(midnight)
            // Stale thresholds: 30 min after the snapshot, then every hour for a day.
            if let written = Time.iso(snap.writtenAt) {
                var t = written.addingTimeInterval(30 * 60)
                for _ in 0..<25 {
                    if t > now, t < horizon { dates.insert(t) }
                    t = t.addingTimeInterval(3600)
                }
            }
        }

        // WidgetKit allows a limited number of entries; keep the nearest ones.
        let ordered = dates.sorted().prefix(60)
        let entries = ordered.map { CalendarEntry(date: $0, snapshot: snap) }
        // Ask for a new timeline after the last entry. The app also reloads on every snapshot write.
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct CalendarWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Shared.widgetKind, provider: CalendarProvider()) { entry in
            CalendarEntryView(entry: entry)
        }
        .configurationDisplayName("Calendar")
        .description("Your agenda and goals, with a check for each session.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
        // The views set their own padding (14 pt, 12 pt on Medium, 18 pt on iPad) as in the spec.
        .contentMarginsDisabled()
    }
}

@main
struct CalendarWidgetBundle: WidgetBundle {
    var body: some Widget {
        CalendarWidget()
    }
}

/// A day to show in the gallery and as the placeholder (shapes only: the view is redacted).
enum Sample {
    static func snapshot(now: Date) -> Snapshot? {
        let day = Time.dayKey(now)
        func at(_ h: Int, _ m: Int) -> String { String(format: "%@T%02d:%02d", day, h, m) }
        func event(_ id: String, _ t: String, _ hue: Int, _ s: String, _ e: String, check: Bool) -> SnapshotEvent {
            SnapshotEvent(id: id, t: t, cat: nil, hue: hue, s: s, e: e, check: check, done: false, vis: "private", owner: nil, goal: nil)
        }
        let start = Time.dayKey(Time.addDays(now, -20))
        let end = Time.dayKey(Time.addDays(now, 60))
        return Snapshot(
            v: 1,
            writtenAt: Time.isoString(now),
            day: day,
            prefs: SnapshotPrefs(clock: "12h", hidePrivate: false),
            events: [
                event("s1", "Focus block", 240, at(13, 0), at(14, 0), check: true),
                event("s2", "Lunch", 60, at(14, 30), at(15, 15), check: false),
                event("s3", "Review", 240, at(16, 0), at(16, 30), check: true),
                event("s4", "Walk", 170, at(17, 30), at(18, 10), check: false),
            ],
            goals: [
                SnapshotGoal(id: "g1", title: "Goal one", hue: 125, hours: 95, done: 22, todayNeed: 1, todayDone: 0.25, start: start, deadline: end),
                SnapshotGoal(id: "g2", title: "Goal two", hue: 290, hours: 12, done: 2, todayNeed: 0.75, todayDone: 0.25, start: start, deadline: end),
                SnapshotGoal(id: "g3", title: "Goal three", hue: 240, hours: 40, done: 30, todayNeed: 1, todayDone: 1, start: start, deadline: end),
            ],
            tokens: nil
        )
    }
}
