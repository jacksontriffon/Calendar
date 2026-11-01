// What a widget shows at one moment: the snapshot, the clock and a family turned
// into rows, goals and header text. A mirror of src/features/widget/model.ts
// (which the jest tests pin to the Design Spec frames): change them together.
//
// Large (WG 1g to 1i) is a vertical carousel of Yesterday, Today and Tomorrow with
// goals in the header two a page; Medium (WG 2i) is today only with one goal at a
// time. Both end in a message field that opens the composer. The lists are fitted
// by height (`Fit`), so "+ n more today" shows only when something does not fit.
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
    /// Struck through and dimmed.
    var done: Bool
    /// Shows the check button. Only iPad: on Large and Medium a done event is just struck through.
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
    /// Inside the ring: "45m". Empty once done or while the numbers are old.
    var left: String
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

/// A neighbouring day, dimmed above or below the page in view. Tapping it moves the carousel to that day.
struct Peek {
    var offset: Int
    var label: String
    var summary: String?
    var row: Row?
    var empty: Bool
}

/// The Large widget's day carousel.
struct Pager {
    var day: Int
    var heading: String
    var summary: String?
    var before: Peek?
    var after: Peek?
    var dots: [Int] = [-1, 0, 1]
}

struct GoalPages {
    var index: Int
    var count: Int
}

struct Compose {
    var placeholder: String
    var url: URL
}

/// Heights (pt) an iPhone list is fitted into, from the frames (see `Fit` in model.ts).
struct Fit {
    var row: Double
    var now: Double
    var card: Double
    var more: Double
    var avail: Double
    var peek: Double

    static let large = Fit(row: 20, now: 14, card: 44, more: 14, avail: 222, peek: 37)
    static let medium = Fit(row: 16, now: 11, card: 36, more: 12, avail: 88, peek: 0)
}

struct Model {
    var layout: Layout
    var signedOut = false
    var url: URL = Links.signin
    var title = ""
    var month = ""
    var sub = ""
    var stale = false
    var showPlus = false
    var dot = false
    var goalsDim = false
    var strip: String?
    var emptyNext: String?
    var isEmpty = false
    /// The page in view has nothing on it (today, or the day the Large carousel is on).
    var pageEmpty = false
    var items: [Item] = []
    var more: String?
    var goals: [GoalVM] = []
    var goalPages: GoalPages?
    var small: SmallVM?
    var today: DayColumn?
    var tomorrow: DayColumn?
    var pager: Pager?
    var compose: Compose?
    var accent = "#cf7b58"
    var h24 = false

    static func limits(_ layout: Layout) -> (rows: Int, goals: Int, perPage: Int, deadline: Bool, fit: Fit?) {
        switch layout {
        case .small: return (1, 0, 0, false, nil)
        case .medium: return (5, 1, 1, false, .medium)
        case .large: return (7, 2, 2, false, .large)
        case .xl: return (5, 3, 0, true, nil)
        }
    }

    /// Fit rows under `lead` (already placed, `leadH` tall) into `avail` points. When some rows do not
    /// fit, the "+ n more" line needs room too, so rows are given up until it does.
    static func fitRows(lead: [Item], leadH: Double, rows: [Row], avail: Double, fit: Fit, more: (Int) -> String) -> (items: [Item], more: String?) {
        var items = lead
        var used = leadH
        var shown = 0
        while shown < rows.count && used + fit.row <= avail {
            items.append(.row(rows[shown]))
            used += fit.row
            shown += 1
        }
        var moreText: String?
        if shown < rows.count {
            while shown > 0 && used + fit.more > avail {
                items.removeLast()
                used -= fit.row
                shown -= 1
            }
            moreText = more(rows.count - shown)
        }
        return (items, moreText)
    }

    static let dayNames = ["Yesterday", "Today", "Tomorrow"]

    /// `carousel` is the stored tap state already resolved at `now` (expired taps read as home).
    /// `redactPrivate`: the device is locked or in StandBy (the system asks for privacy redaction).
    static func build(_ snapshot: Snapshot?, now: Date, layout: Layout, carousel: Carousel = .home, redactPrivate: Bool = false) -> Model {
        guard let raw = snapshot else {
            var out = Model(layout: layout)
            out.signedOut = true
            return out
        }
        let snap = Store.applyOps(raw, Store.loadOps())
        let lim = limits(layout)
        let fit = lim.fit
        let paged = fit != nil
        let h24 = snap.prefs.clock == "24h"
        let hide = redactPrivate || (snap.prefs.hidePrivate ?? false)
        // The pager only exists on Large; Medium is always today.
        let viewDay = (layout == .large && paged) ? carousel.day : 0

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
                check: !paged && x.e.check && x.e.owner == nil,
                vis: x.e.vis,
                owner: x.e.owner,
                url: Links.event(x.e.id),
                start: x.s,
                end: x.en
            )
        }

        // A day's events: anything overlapping it (a session that started last night and runs on counts).
        func eventsOn(_ d: Date) -> [Timed] {
            let end = Time.addDays(d, 1)
            return all.filter { $0.s < end && $0.en > d }
        }

        let todays = eventsOn(today)
        let left = todays.filter { $0.en > now }
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
        m.accent = snap.prefs.accent ?? "#cf7b58"
        m.isEmpty = isEmpty
        m.sub = stale ? Labels.staleLabel(age) : (isEmpty ? "Free day" : "Now \(nowLabel)")
        m.stale = stale
        m.dot = !isEmpty && !stale
        m.showPlus = !paged && !isEmpty && layout != .small
        m.goalsDim = goalsDim
        m.strip = veryOld && layout != .small && !paged ? "Open Calendar to refresh" : nil

        // The page in view (Large) or today (Medium and the rest).
        var viewDate = today
        var viewEmpty = isEmpty

        if let fit = fit {
            // iPhone Large (the pager) and Medium (today only): fitted by height.
            func summaryOf(_ offset: Int, _ evs: [Timed]) -> String? {
                if offset < 0 {
                    // Goal sessions are the events that can be done (they had the check buttons).
                    let sessions = evs.filter { $0.e.check }
                    return sessions.isEmpty ? nil : Labels.doneOf(sessions.filter { $0.e.done }.count, sessions.count)
                }
                if offset > 0 {
                    let mins = evs.reduce(0.0) { $0 + $1.en.timeIntervalSince($1.s) / 60 }
                    return evs.isEmpty ? nil : Labels.planned(mins)
                }
                return nil
            }
            func eventsAt(_ offset: Int) -> [Timed] {
                offset == 0 ? todays : eventsOn(Time.addDays(today, offset))
            }

            // Today's list: the running card, or the finished session and the now line, then what is next.
            func todayList(_ avail: Double) -> (items: [Item], more: String?) {
                var lead: [Item] = []
                var leadH = 0.0
                if let r = running {
                    lead.append(.card(rowOf(r)))
                    leadH = fit.card
                } else {
                    if let p = lastPast {
                        lead.append(.row(rowOf(p)))
                        leadH += fit.row
                    }
                    lead.append(.now(nowLabel))
                    leadH += fit.now
                }
                return fitRows(lead: lead, leadH: leadH, rows: upcoming.map(rowOf), avail: avail, fit: fit) { "+ \($0) more today" }
            }

            if layout == .large {
                func peekOf(_ offset: Int) -> Peek {
                    let evs = eventsAt(offset)
                    let first: Timed? = offset == 0 ? (running ?? upcoming.first) : evs.first
                    return Peek(
                        offset: offset,
                        label: "\(dayNames[offset + 1]) · \(Time.dayShort(Time.addDays(today, offset)))",
                        summary: summaryOf(offset, evs),
                        row: first.map(rowOf),
                        empty: evs.isEmpty
                    )
                }
                let before: Peek? = viewDay == 0 ? peekOf(-1) : (viewDay == 1 ? peekOf(0) : nil)
                let after: Peek? = viewDay == 0 ? peekOf(1) : (viewDay == -1 ? peekOf(0) : nil)
                let peeks = (before == nil ? 0.0 : 1.0) + (after == nil ? 0.0 : 1.0)
                let avail = fit.avail - fit.peek * peeks
                viewDate = Time.addDays(today, viewDay)
                let evs = eventsAt(viewDay)
                viewEmpty = evs.isEmpty
                if viewDay == 0 {
                    if !isEmpty { (m.items, m.more) = todayList(avail) }
                } else {
                    (m.items, m.more) = fitRows(lead: [], leadH: 0, rows: evs.map(rowOf), avail: avail, fit: fit) { "+ \($0) more" }
                }
                m.pager = Pager(
                    day: viewDay,
                    heading: dayNames[viewDay + 1],
                    summary: summaryOf(viewDay, evs),
                    before: before,
                    after: after
                )
            } else if !isEmpty {
                (m.items, m.more) = todayList(fit.avail)
            }
        }

        m.title = paged ? Time.dayShort(viewDate) : Time.dayLabel(today)
        m.month = Time.monthName(viewDate)
        m.url = layout == .small && isEmpty ? Links.compose : Links.day(Time.dayKey(viewDate))
        if paged {
            m.compose = Compose(placeholder: veryOld ? "Open Calendar to refresh" : "Add or change an event…", url: Links.compose)
        }

        // Goals still active today.
        let active: [GoalVM] = snap.goals.compactMap { g -> GoalVM? in
            let d = Labels.deadline(g, today: today)
            guard d.active else { return nil }
            return GoalVM(
                id: g.id,
                title: g.title,
                hue: g.hue,
                ring: goalsDim ? 0 : Labels.ring(need: g.todayNeed, done: g.todayDone),
                today: goalsDim ? "" : Labels.leftToday(need: g.todayNeed, done: g.todayDone),
                left: goalsDim ? "" : Labels.ringLeft(need: g.todayNeed, done: g.todayDone),
                isDone: !goalsDim && Labels.isDoneToday(need: g.todayNeed, done: g.todayDone),
                total: Labels.totalLeft(g),
                deadline: lim.deadline ? d.label : nil,
                url: Links.goal(g.id)
            )
        }
        if lim.perPage > 0 {
            // All active goals, in pages: Large two at a time, Medium one.
            let count = max(1, Int((Double(active.count) / Double(lim.perPage)).rounded(.up)))
            let index = min(layout == .large ? carousel.large : carousel.medium, count - 1)
            m.goals = Array(active.dropFirst(index * lim.perPage).prefix(lim.perPage))
            if !active.isEmpty { m.goalPages = GoalPages(index: index, count: count) }
        } else {
            m.goals = Array(active.prefix(lim.goals))
        }

        // Empty day (the one in view): today's next event as a line of text.
        m.pageEmpty = viewEmpty
        if viewEmpty {
            let next = viewDay == 0 ? all.first(where: { $0.s > now && !$0.e.done }) : nil
            m.emptyNext = next.map { "Next: \(Time.whenLabel($0.s, h24: h24)) · \(rowOf($0).title)" }
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
                label: "Today",
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
