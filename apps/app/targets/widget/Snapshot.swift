// The widget's data: the snapshot the app writes (Design Spec WG 5, written by
// src/features/widget/snapshot.ts), the mark-done queue, and the text helpers.
// Mirrors src/features/widget/{types,labels}.ts: change them together.
//
// NOTE: this file has not been compiled (no Xcode in the build environment).

import Foundation
import SwiftUI

// MARK: - Shared storage

enum Shared {
    /// Must match APP_GROUP in app.config.ts and src/features/widget/types.ts.
    static let group = "group.com.claudecalendar.app"
    static let snapshotKey = "widget.snapshot.v1"
    static let opsKey = "widget.ops.v1"
    static let ackKey = "widget.opsAck.v1"
    /// Carousel taps (src/features/widget/carousel.ts). Written here, by the App Intents.
    static let carouselKey = "widget.carousel.v1"
    /// Must match IOS_WIDGET_KIND in types.ts.
    static let widgetKind = "CalendarWidget"
    static let opMaxAge: TimeInterval = 7 * 86400

    static var defaults: UserDefaults? { UserDefaults(suiteName: group) }
}

// MARK: - Deep links (WG 5)

enum Links {
    private static func make(_ path: String) -> URL {
        URL(string: "aicalendar://" + path) ?? URL(string: "aicalendar://")!
    }
    private static func enc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
    }
    static func event(_ id: String) -> URL { make("event/" + enc(id)) }
    static func goal(_ id: String) -> URL { make("goal/" + enc(id)) }
    static func day(_ date: String) -> URL { make("day/" + date) }
    static let compose = make("compose")
    static let signin = make("signin")
}

// MARK: - Snapshot

struct Snapshot: Codable {
    var v: Int
    var writtenAt: String
    var day: String
    var prefs: SnapshotPrefs
    var events: [SnapshotEvent]
    var goals: [SnapshotGoal]
    var tokens: Tokens?
}

struct SnapshotPrefs: Codable {
    var clock: String
    var hidePrivate: Bool?
    /// The now line and the send button on Large and Medium. Absent in snapshots from before the pager.
    var accent: String?
}

struct SnapshotEvent: Codable {
    var id: String
    var t: String
    var cat: String?
    var hue: Int
    var s: String
    var e: String
    var check: Bool
    var done: Bool
    var vis: String
    var owner: String?
    var goal: String?
}

struct SnapshotGoal: Codable {
    var id: String
    var title: String
    var hue: Int
    var hours: Double
    var done: Double
    var todayNeed: Double
    var todayDone: Double
    var start: String
    var deadline: String
}

struct Palette: Codable {
    var bg: String
    var ink: String
    var secondary: Double
    var tertiary: Double
    var hairline: Double
    var track: Double
    var checkRing: Double
    var subtle: Double
    var button: Double
    /// Solid fill of the message field and the glyph on the send button (absent in older snapshots).
    var field: String?
    var accentInk: String?

    static let dark = Palette(bg: "#1b1a18", ink: "#ffffff", secondary: 0.62, tertiary: 0.42, hairline: 0.12, track: 0.10, checkRing: 0.5, subtle: 0.07, button: 0.14, field: "#34312e", accentInk: "#17120f")
    static let light = Palette(bg: "#f6f3ee", ink: "#000000", secondary: 0.62, tertiary: 0.46, hairline: 0.12, track: 0.09, checkRing: 0.45, subtle: 0.05, button: 0.10, field: "#ffffff", accentInk: "#17120f")
}

struct Tokens: Codable {
    var light: Palette
    var dark: Palette
    var swatch: [String: String]
    var amber: String
}

struct DoneOp: Codable {
    var op: String
    var ev: String
    var at: String
    var key: String { ev + "@" + at }
}

// MARK: - Reading and the queue

enum Store {
    static func loadSnapshot() -> Snapshot? {
        guard let raw = Shared.defaults?.string(forKey: Shared.snapshotKey),
              let data = raw.data(using: .utf8),
              let snap = try? JSONDecoder().decode(Snapshot.self, from: data),
              snap.v == 1
        else { return nil }
        return snap
    }

    static func loadOps() -> [DoneOp] {
        guard let raw = Shared.defaults?.string(forKey: Shared.opsKey),
              let data = raw.data(using: .utf8),
              let ops = try? JSONDecoder().decode([DoneOp].self, from: data)
        else { return [] }
        return ops.filter { $0.op == "done" }
    }

    static func loadAck() -> Set<String> {
        guard let raw = Shared.defaults?.string(forKey: Shared.ackKey),
              let data = raw.data(using: .utf8),
              let keys = try? JSONDecoder().decode([String].self, from: data)
        else { return [] }
        return Set(keys)
    }

    /// The widget is the only writer of the queue (the app only writes the ack list), so there is no
    /// cross-process read-modify-write race. Acknowledged and week-old ops are pruned here.
    static func appendDone(eventID: String, now: Date = Date()) {
        let ack = loadAck()
        var ops = loadOps().filter { op in
            guard !ack.contains(op.key) else { return false }
            guard let at = Time.iso(op.at) else { return false }
            return now.timeIntervalSince(at) < Shared.opMaxAge
        }
        ops.append(DoneOp(op: "done", ev: eventID, at: Time.isoString(now)))
        if let data = try? JSONEncoder().encode(ops), let s = String(data: data, encoding: .utf8) {
            Shared.defaults?.set(s, forKey: Shared.opsKey)
        }
    }

    /// Queued checks newer than the snapshot, drawn on top of it (WG 5, "Check taps").
    static func applyOps(_ snap: Snapshot, _ ops: [DoneOp]) -> Snapshot {
        guard let base = Time.iso(snap.writtenAt) else { return snap }
        let fresh = ops.filter { (Time.iso($0.at) ?? .distantPast) > base }
        if fresh.isEmpty { return snap }
        var out = snap
        for op in fresh {
            guard let i = out.events.firstIndex(where: { $0.id == op.ev }),
                  !out.events[i].done, out.events[i].owner == nil else { continue }
            out.events[i].done = true
            let ev = out.events[i]
            if let gid = ev.goal, let gi = out.goals.firstIndex(where: { $0.id == gid }),
               let s = Time.parseLocal(ev.s), let e = Time.parseLocal(ev.e), ev.s.prefix(10) == snap.day {
                let hours = max(0, e.timeIntervalSince(s) / 3600)
                out.goals[gi].todayDone += hours
                out.goals[gi].done += hours
            }
        }
        return out
    }
}

// MARK: - Carousel (src/features/widget/carousel.ts)

/// What the widget draws from: the day Large shows (-1 Yesterday, 0 Today, 1 Tomorrow) and the goal page
/// on Large (two goals a page) and Medium (one).
struct Carousel {
    var day = 0
    var large = 0
    var medium = 0

    static let home = Carousel()
}

/// What is stored: each piece with the time of its last tap (ISO, UTC).
struct CarouselState: Codable {
    var day = 0
    var dayAt = ""
    var large = 0
    var largeAt = ""
    var medium = 0
    var mediumAt = ""
}

enum CarouselStore {
    /// A tap this old no longer counts: each piece goes home 5 minutes after its last tap, and at midnight.
    static let timeout: TimeInterval = 5 * 60

    static func load() -> CarouselState? {
        guard let raw = Shared.defaults?.string(forKey: Shared.carouselKey),
              let data = raw.data(using: .utf8)
        else { return nil }
        return try? JSONDecoder().decode(CarouselState.self, from: data)
    }

    private static func save(_ state: CarouselState) {
        if let data = try? JSONEncoder().encode(state), let s = String(data: data, encoding: .utf8) {
            Shared.defaults?.set(s, forKey: Shared.carouselKey)
        }
    }

    /// Set on the same local day as `now` and no more than the timeout ago (a future stamp, from a clock change, is expired).
    private static func live(_ at: String, _ now: Date) -> Bool {
        guard let t = Time.iso(at) else { return false }
        let age = now.timeIntervalSince(t)
        return age >= 0 && age <= timeout && Time.cal.isDate(t, inSameDayAs: now)
    }

    /// The carousels as they read at `now`: stored values that have not expired, home for the rest.
    static func resolve(_ state: CarouselState?, now: Date) -> Carousel {
        guard let s = state else { return .home }
        return Carousel(
            day: live(s.dayAt, now) && (s.day == -1 || s.day == 1) ? s.day : 0,
            large: live(s.largeAt, now) && s.large > 0 ? s.large : 0,
            medium: live(s.mediumAt, now) && s.medium > 0 ? s.medium : 0
        )
    }

    /// A tap: set the pieces given, stamping them `now`; the others keep their stamps.
    static func tap(day: Int? = nil, large: Int? = nil, medium: Int? = nil, now: Date = Date()) {
        var s = load() ?? CarouselState()
        let at = Time.isoString(now)
        if let d = day { s.day = d; s.dayAt = at }
        if let l = large { s.large = l; s.largeAt = at }
        if let m = medium { s.medium = m; s.mediumAt = at }
        save(s)
    }

    /// When the pieces of `state` expire after `now` (plus a second), so the timeline can redraw at home.
    static func expiries(_ state: CarouselState?, now: Date) -> [Date] {
        guard let s = state else { return [] }
        return [s.dayAt, s.largeAt, s.mediumAt]
            .compactMap { Time.iso($0) }
            .map { $0.addingTimeInterval(timeout + 1) }
            .filter { $0 > now }
    }
}

// MARK: - Time

enum Time {
    static let dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    static let mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    static var cal: Calendar { Calendar.current }

    private static func formatter(_ f: String) -> DateFormatter {
        let d = DateFormatter()
        d.locale = Locale(identifier: "en_US_POSIX")
        d.timeZone = TimeZone.current
        d.dateFormat = f
        return d
    }

    /// `YYYY-MM-DDTHH:mm`, floating local.
    static func parseLocal(_ s: String) -> Date? { formatter("yyyy-MM-dd'T'HH:mm").date(from: String(s.prefix(16))) }
    /// `YYYY-MM-DD` -> local midnight.
    static func parseDay(_ s: String) -> Date? { formatter("yyyy-MM-dd").date(from: String(s.prefix(10))) }
    static func dayKey(_ d: Date) -> String { formatter("yyyy-MM-dd").string(from: d) }

    static func iso(_ s: String) -> Date? {
        let a = ISO8601DateFormatter()
        a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = a.date(from: s) { return d }
        let b = ISO8601DateFormatter()
        b.formatOptions = [.withInternetDateTime]
        return b.date(from: s)
    }

    static func isoString(_ d: Date) -> String {
        let a = ISO8601DateFormatter()
        a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return a.string(from: d)
    }

    static func minutes(_ d: Date) -> Int {
        let c = cal.dateComponents([.hour, .minute], from: d)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    static func startOfDay(_ d: Date) -> Date { cal.startOfDay(for: d) }
    static func addDays(_ d: Date, _ n: Int) -> Date { cal.date(byAdding: .day, value: n, to: d) ?? d }

    /// "9am", "12:30pm" (12h) or "09:00" (24h).
    static func clock(_ minute: Int, h24: Bool) -> String {
        let m = ((minute % 1440) + 1440) % 1440
        let h = m / 60, mm = m % 60
        if h24 { return String(format: "%02d:%02d", h, mm) }
        let h12 = h % 12 == 0 ? 12 : h % 12
        let minutePart = mm > 0 ? String(format: ":%02d", mm) : ""
        let half = h >= 12 ? "pm" : "am"
        return "\(h12)\(minutePart)\(half)"
    }

    /// The now line / "Now 11:48": no am/pm in 12h.
    static func nowClock(_ minute: Int, h24: Bool) -> String {
        let m = ((minute % 1440) + 1440) % 1440
        let h = m / 60, mm = m % 60
        if h24 { return String(format: "%02d:%02d", h, mm) }
        return String(format: "%d:%02d", h % 12 == 0 ? 12 : h % 12, mm)
    }

    static func time(_ d: Date, h24: Bool) -> String { clock(minutes(d), h24: h24) }

    /// "12:30–1:15pm", "9–11:30am", "11am–12:30pm", or "12:30–13:15" in 24h.
    static func range(_ s: Date, _ e: Date, h24: Bool) -> String {
        let a = clock(minutes(s), h24: h24), b = clock(minutes(e), h24: h24)
        if h24 { return "\(a)–\(b)" }
        let same = a.suffix(2) == b.suffix(2)
        return "\(same ? String(a.dropLast(2)) : a)–\(b)"
    }

    /// "Fri 30 Oct".
    static func dayLabel(_ d: Date) -> String {
        let c = cal.dateComponents([.weekday, .day, .month], from: d)
        return "\(dow[(c.weekday ?? 1) - 1]) \(c.day ?? 1) \(mon[(c.month ?? 1) - 1])"
    }

    static let monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

    /// "Fri 30": the weekday and date in the Large and Medium header, with the month under it.
    static func dayShort(_ d: Date) -> String {
        let c = cal.dateComponents([.weekday, .day], from: d)
        return "\(dow[(c.weekday ?? 1) - 1]) \(c.day ?? 1)"
    }

    /// "October".
    static func monthName(_ d: Date) -> String {
        monthNames[(cal.dateComponents([.month], from: d).month ?? 1) - 1]
    }

    /// "Mon 9am".
    static func whenLabel(_ d: Date, h24: Bool) -> String {
        let c = cal.dateComponents([.weekday], from: d)
        return "\(dow[(c.weekday ?? 1) - 1]) \(time(d, h24: h24))"
    }
}

// MARK: - Labels (core `fmtDur`, `dur`, `hrs`, `goalToday`, `leftShortLabel`)

enum Labels {
    static func fmtDur(_ minutes: Int) -> String {
        let h = minutes / 60, x = minutes % 60
        if h > 0 { return "\(h)h" + (x > 0 ? " \(x)m" : "") }
        return "\(x)m"
    }

    static func hrs(_ n: Double) -> String {
        let r = (n * 10).rounded() / 10
        if abs(r) < 10 {
            var s = String(r)
            if s.hasSuffix(".0") { s = String(s.dropLast(2)) }
            return s
        }
        return String(Int(r.rounded()))
    }

    /// Hours -> "30m" / "2h".
    static func dur(_ hours: Double) -> String {
        let h = max(0, hours)
        if h > 0 && h < 1 { return "\(max(5, Int((h * 12).rounded()) * 5))m" }
        return hrs(h) + "h"
    }

    static func ring(need: Double, done: Double) -> Double {
        need > 0 ? min(1, max(0, done / need)) : 1
    }

    static func isDoneToday(need: Double, done: Double) -> Bool { max(0, need - done) < 1.0 / 60 }

    /// "45m left today" / "Done today".
    static func leftToday(need: Double, done: Double) -> String {
        if isDoneToday(need: need, done: done) { return "Done today" }
        return fmtDur(Int((max(0, need - done) * 60).rounded())) + " left today"
    }

    /// The time left inside a goal ring: "45m" / "1h 15m", empty once today's share is done.
    static func ringLeft(need: Double, done: Double) -> String {
        isDoneToday(need: need, done: done) ? "" : fmtDur(Int((max(0, need - done) * 60).rounded()))
    }

    /// Yesterday's summary: "2 of 3 done".
    static func doneOf(_ done: Int, _ total: Int) -> String { "\(done) of \(total) done" }

    /// Tomorrow's summary: "4h 55m planned".
    static func planned(_ minutes: Double) -> String { "\(fmtDur(Int(minutes.rounded()))) planned" }

    /// "73h left".
    static func totalLeft(_ g: SnapshotGoal) -> String { dur(max(0, g.hours - g.done)) + " left" }

    /// "9 weeks left" / "13 days left" / "Ended", and whether the goal is active today.
    static func deadline(_ g: SnapshotGoal, today: Date) -> (label: String, active: Bool) {
        guard let s0 = Time.parseDay(g.start), let last = Time.parseDay(g.deadline) else { return ("", false) }
        let s1 = Time.addDays(last, 1)
        let total = max(1, Time.cal.dateComponents([.day], from: s0, to: s1).day ?? 1)
        let sinceStart = Time.cal.dateComponents([.day], from: s0, to: today).day ?? 0
        let elapsed = min(total, max(0, sinceStart))
        let active = today >= s0 && today < s1
        if !active && today >= s1 { return ("Ended", false) }
        let left = max(0, total - elapsed)
        if left >= 14 {
            let weeks = Int((Double(left) / 7).rounded())
            return ("\(weeks) weeks left", active)
        }
        let unit = left == 1 ? "day" : "days"
        return ("\(left) \(unit) left", active)
    }

    static func staleLabel(_ age: TimeInterval) -> String {
        let min = Int(age / 60)
        if min < 60 { return "Updated \(max(1, min))m ago" }
        let h = min / 60
        if h < 24 { return "Updated \(h)h ago" }
        return "Updated \(h / 24)d ago"
    }
}

// MARK: - Colour

extension Color {
    init(hex: String) {
        var h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        var n: UInt64 = 0
        Scanner(string: h).scanHexInt64(&n)
        self.init(
            .sRGB,
            red: Double((n >> 16) & 255) / 255,
            green: Double((n >> 8) & 255) / 255,
            blue: Double(n & 255) / 255,
            opacity: 1
        )
    }
}
