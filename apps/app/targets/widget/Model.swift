// What a widget shows at one moment: the snapshot, the clock and a family turned
// into rows, goals and header text. A mirror of src/features/widget/model.ts
// (which the jest tests pin to the Design Spec frames): change them together.
//
// NOTE: this file has not been compiled (no Xcode in the build environment).

import Foundation

enum Layout { case small, medium, large, xl }

struct Row: Identifiable {
    var id: String
    var title: String
    var time: String
    var range: String
    var hue: Int
    var done: Bool
    var check: Bool
    var vis: String
    var owner: String?
    var url: URL
    var start: Date
    var end: Date
}

enum Item: Identifiable {
    case row(Row)
    case now(String)
    case card(Row)

    var id: String {
        switch self {
        case .row(let r): return r.id
        case .now: return "now"
        case .card(let r): return "card-" + r.id
        }
    }
}

struct GoalVM: Identifiable {
    var id: String
    var title: String
    var hue: Int
    var ring: Double
    var today: String
    var isDone: Bool
    var total: String
    var deadline: String?
    var url: URL
}

enum SmallVM {
    case next(when: Date?, whenText: String?, title: String, range: String, hue: Int)
    case now(start: Date, end: Date, title: String, range: String, hue: Int)
    case empty(date: String)
}

struct DayColumn {
    var label: String
    var nowTime: String?
    var rows: [Row]
    var planned: String?
}

struct Model {
    var layout: Layout
    var signedOut = false
    var url: URL = Links.signin
    var title = ""
    var sub = ""
    var stale = false
    var showPlus = false
    var dot = false
    var goalsDim = false
    var strip: String?
    var emptyNext: String?
    var isEmpty = false
    var items: [Item] = []
    var more: String?
    var goals: [GoalVM] = []
    var small: SmallVM?
    var today: DayColumn?
    var tomorrow: DayColumn?
    var h24 = false

    static func limits(_ layout: Layout) -> (rows: Int, goals: Int, deadline: Bool) {
        switch layout {
        case .small: return (1, 0, false)
        case .medium: return (3, 2, false)
        case .large: return (5, 3, true)
        case .xl: return (5, 3, true)
        }
    }

    /// `redactPrivate`: the device is locked or in StandBy (the system asks for privacy redaction).
    static func build(_ snapshot: Snapshot?, now: Date, layout: Layout, redactPrivate: Bool = false) -> Model {
        guard let raw = snapshot else {
            var out = Model(layout: layout)
            out.signedOut = true
            return out
        }
        let snap = Store.applyOps(raw, Store.loadOps())
        let lim = limits(layout)
        let h24 = snap.prefs.clock == "24h"
        let hide = redactPrivate || (snap.prefs.hidePrivate ?? false)

        let today = Time.startOfDay(now)
        let tomorrow = Time.addDays(today, 1)
        let dayAfter = Time.addDays(today, 2)
        let todayKey = Time.dayKey(today)
        let nowMin = Time.minutes(now)
        let nowLabel = Time.nowClock(nowMin, h24: h24)

        struct Timed { var e: SnapshotEvent; var s: Date; var en: Date }
        let all: [Timed] = snap.events.compactMap { e in
            guard let s = Time.parseLocal(e.s), let en = Time.parseLocal(e.e) else { return nil }
            return Timed(e: e, s: s, en: en)
        }.sorted { $0.s < $1.s }

        func rowOf(_ x: Timed) -> Row {
            Row(
                id: x.e.id,
                title: hide && x.e.vis == "private" ? "Private event" : x.e.t,
                time: Time.time(x.s, h24: h24),
                range: Time.range(x.s, x.en, h24: h24),
                hue: x.e.hue,
                done: x.e.done,
                check: x.e.check && x.e.owner == nil,
                vis: x.e.vis,
                owner: x.e.owner,
                url: Links.event(x.e.id),
                start: x.s,
                end: x.en
            )
        }

        let todays = all.filter { $0.s < tomorrow && $0.en > today }
        let left = todays.filter { $0.en > now }
        let leftOpen = left.filter { !$0.e.done }
        let running = left.first { $0.s <= now && !$0.e.done }
        let upcoming = left.filter { x in
            guard let r = running else { return true }
            return x.e.id != r.e.id
        }
        let past = todays.filter { $0.en <= now }
        let lastPast = past.last
        let isEmpty = todays.isEmpty

        let age = max(0, now.timeIntervalSince(Time.iso(snap.writtenAt) ?? now))
        let veryOld = age > 86400
        let stale = age >= 30 * 60
        let goalsDim = veryOld || snap.day != todayKey

        var m = Model(layout: layout)
        m.h24 = h24
        m.title = Time.dayLabel(today)
        m.isEmpty = isEmpty
        m.sub = stale ? Labels.staleLabel(age) : (isEmpty ? "Free day" : "Now \(nowLabel) · \(leftOpen.count) left")
        m.stale = stale
        m.dot = !isEmpty && !stale
        m.showPlus = !isEmpty && layout != .small
        m.goalsDim = goalsDim
        m.strip = veryOld && layout != .small ? "Open Calendar to refresh" : nil
        m.url = layout == .small && isEmpty ? Links.compose : Links.day(todayKey)

        // Rows (Medium and Large).
        if (layout == .medium || layout == .large) && !isEmpty {
            var used = 0
            if let r = running {
                m.items.append(.card(rowOf(r)))
                // The card is taller than a row: two rows on Large, one on Medium.
                used += layout == .large ? 2 : 1
            } else if layout == .large {
                if let p = lastPast {
                    m.items.append(.row(rowOf(p)))
                    used += 1
                }
                m.items.append(.now(nowLabel))
            }
            var shown = 0
            for x in upcoming {
                if used >= lim.rows { break }
                m.items.append(.row(rowOf(x)))
                used += 1
                shown += 1
            }
            if layout == .large && upcoming.count > shown {
                m.more = "+ \(upcoming.count - shown) more today"
            }
        }

        // Goals still active today.
        m.goals = snap.goals.compactMap { g -> GoalVM? in
            let d = Labels.deadline(g, today: today)
            guard d.active else { return nil }
            return GoalVM(
                id: g.id,
                title: g.title,
                hue: g.hue,
                ring: goalsDim ? 0 : Labels.ring(need: g.todayNeed, done: g.todayDone),
                today: goalsDim ? "" : Labels.leftToday(need: g.todayNeed, done: g.todayDone),
                isDone: !goalsDim && Labels.isDoneToday(need: g.todayNeed, done: g.todayDone),
                total: Labels.totalLeft(g),
                deadline: lim.deadline ? d.label : nil,
                url: Links.goal(g.id)
            )
        }
        m.goals = Array(m.goals.prefix(lim.goals))

        // Empty day: the next event as a line of text.
        if isEmpty, let next = all.first(where: { $0.s > now && !$0.e.done }) {
            m.emptyNext = "Next: \(Time.whenLabel(next.s, h24: h24)) · \(rowOf(next).title)"
        }

        // Small.
        if layout == .small {
            let next = all.first { $0.s > now && !$0.e.done }
            if isEmpty || (running == nil && next == nil) {
                m.small = .empty(date: Time.dayLabel(today))
            } else if let r = running {
                m.small = .now(start: r.s, end: r.en, title: rowOf(r).title, range: Time.range(r.s, r.en, h24: h24), hue: r.e.hue)
            } else if let n = next {
                let sameDay = Time.dayKey(n.s) == todayKey
                m.small = .next(
                    when: sameDay ? n.s : nil,
                    whenText: sameDay ? nil : Time.whenLabel(n.s, h24: h24),
                    title: rowOf(n).title,
                    range: Time.range(n.s, n.en, h24: h24),
                    hue: n.e.hue
                )
            }
        }

        // iPad: today and tomorrow side by side.
        if layout == .xl {
            var todayRows: [Timed] = []
            if let r = running { todayRows.append(r) }
            todayRows.append(contentsOf: upcoming)
            let tom = all.filter { $0.s >= tomorrow && $0.s < dayAfter }
            let planned = tom.reduce(0.0) { $0 + $1.en.timeIntervalSince($1.s) / 60 }
            m.today = DayColumn(
                label: "Today · \(leftOpen.count) left",
                nowTime: running == nil ? nowLabel : nil,
                rows: todayRows.prefix(lim.rows).map(rowOf),
                planned: nil
            )
            let parts = Time.dayLabel(tomorrow).split(separator: " ").prefix(2).joined(separator: " ")
            m.tomorrow = DayColumn(
                label: "Tomorrow · \(parts)",
                nowTime: nil,
                rows: tom.prefix(lim.rows).map(rowOf),
                planned: tom.isEmpty ? nil : "\(Labels.fmtDur(Int(planned.rounded()))) planned"
            )
        }
        return m
    }
}
