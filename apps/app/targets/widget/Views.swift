// The widget views: Large, Medium, Small, iPad Extra Large, the empty day and the
// signed-out card (Design Spec WG 1 to 3, 6). Sizes and opacities are the frames'.
//
// Rules the spec sets:
//  - no coloured text: ink is the system's white or black at fixed opacities;
//    hues appear only on event bars and goal rings, and both are
//    `widgetAccentable()` so tinted and clear modes flatten them to the tint;
//  - one add button: the "+" in the header, hidden on an empty day where
//    "Add a note" in the body does the same job;
//  - Link for taps that open the app, Button(intent:) for the check, which does not.
//
// NOTE: this file has not been compiled (no Xcode in the build environment).

import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Palette

struct Pal {
    let p: Palette
    let swatch: [String: String]
    let amber: Color

    static let defaultSwatch: [String: String] = [
        "28": "#d97757", "60": "#d4a27f", "125": "#788c5d", "170": "#8fb3a6",
        "240": "#6a9bcc", "290": "#9a8fbf", "350": "#c4758a", "1000": "#b0aea5",
    ]

    init(_ snapshot: Snapshot?, scheme: ColorScheme) {
        let t = snapshot?.tokens
        p = scheme == .dark ? (t?.dark ?? .dark) : (t?.light ?? .light)
        swatch = t?.swatch ?? Pal.defaultSwatch
        amber = Color(hex: t?.amber ?? "#e3b25a")
    }

    var bg: Color { Color(hex: p.bg) }
    func ink(_ alpha: Double = 1) -> Color { Color(hex: p.ink).opacity(alpha) }
    var secondary: Color { ink(p.secondary) }
    var tertiary: Color { ink(p.tertiary) }
    func hue(_ h: Int) -> Color { Color(hex: swatch[String(h)] ?? swatch["1000"] ?? "#b0aea5") }
}

// MARK: - Entry view

struct CalendarEntryView: View {
    let entry: CalendarEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    @Environment(\.redactionReasons) private var redaction

    private var layout: Layout {
        switch family {
        case .systemSmall: return .small
        case .systemMedium: return .medium
        case .systemExtraLarge: return .xl
        default: return .large
        }
    }

    var body: some View {
        let pal = Pal(entry.snapshot, scheme: scheme)
        let model = Model.build(entry.snapshot, now: entry.date, layout: layout, redactPrivate: redaction.contains(.privacy))
        content(model, pal)
            .redacted(reason: entry.isPlaceholder ? .placeholder : [])
            // The header and the background open today; on Small this is the only target.
            .widgetURL(model.url)
            .containerBackground(for: .widget) { pal.bg }
    }

    @ViewBuilder
    private func content(_ m: Model, _ pal: Pal) -> some View {
        if m.signedOut {
            SignedOutView(layout: layout, pal: pal)
        } else {
            switch layout {
            case .small: SmallView(m: m, pal: pal)
            case .medium: MediumView(m: m, pal: pal)
            case .large: LargeView(m: m, pal: pal)
            case .xl: ExtraLargeView(m: m, pal: pal)
            }
        }
    }
}

// MARK: - Pieces

/// The goal ring: the app's own, in an 18-unit box: r 7.5, stroke 2.5, starting at 12 o'clock.
struct RingView: View {
    let color: Color
    let track: Color
    let fraction: Double
    let size: CGFloat

    var body: some View {
        let line = size * 2.5 / 18
        ZStack {
            Circle().stroke(track, lineWidth: line)
            // An empty ring is just the track (a zero-length round cap would draw a dot).
            if fraction > 0 {
                Circle()
                    .trim(from: 0, to: CGFloat(min(1, fraction)))
                    .stroke(color, style: StrokeStyle(lineWidth: line, lineCap: .round))
                    .widgetAccentable()
            }
        }
        .frame(width: size * 15 / 18, height: size * 15 / 18)
        .rotationEffect(.degrees(-90))
        .frame(width: size, height: size)
    }
}

struct HeaderView: View {
    let m: Model
    let pal: Pal
    var titleSize: CGFloat = 19
    var plus: CGFloat = 30

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(m.title)
                    .font(.system(size: titleSize, weight: .semibold))
                    .foregroundStyle(pal.ink())
                    .lineLimit(1)
                HStack(spacing: 5) {
                    if m.stale {
                        // The one amber mark: the cloud-off glyph. The text stays ink.
                        Image(systemName: "icloud.slash")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(pal.amber)
                    } else if m.dot {
                        Circle().fill(pal.ink()).frame(width: 6, height: 6)
                    }
                    Text(m.sub)
                        .font(.system(size: 11))
                        .foregroundStyle(pal.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if m.showPlus {
                Link(destination: Links.compose) {
                    Image(systemName: "plus")
                        .font(.system(size: plus * 0.43, weight: .bold))
                        .foregroundStyle(pal.bg)
                        .frame(width: plus, height: plus)
                        .background(Circle().fill(pal.ink()))
                }
            }
        }
        .frame(height: plus + 4)
    }
}

/// The check: an empty ring runs the intent (no app launch); a done row shows a filled check.
struct CheckView: View {
    let row: Row
    let pal: Pal

    var body: some View {
        if row.check {
            if row.done {
                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .heavy))
                    .foregroundStyle(pal.bg)
                    .frame(width: 20, height: 20)
                    .background(Circle().fill(pal.ink()))
                    .frame(width: 32, height: 28)
            } else {
                Button(intent: MarkDoneIntent(eventID: row.id)) {
                    Circle()
                        .strokeBorder(pal.ink(pal.p.checkRing), lineWidth: 1.5)
                        .frame(width: 20, height: 20)
                        .frame(width: 32, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Lock on private, globe on public, two-letter chip for someone else's event.
struct MarksView: View {
    let row: Row
    let pal: Pal

    var body: some View {
        HStack(spacing: 4) {
            if let owner = row.owner {
                Text(owner)
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(pal.ink())
                    .frame(width: 16, height: 16)
                    .background(Circle().fill(pal.ink(pal.p.button)))
            }
            if row.vis == "private" && row.owner == nil {
                Image(systemName: "lock.fill").font(.system(size: 9)).foregroundStyle(pal.secondary)
            } else if row.vis == "public" {
                Image(systemName: "globe").font(.system(size: 9)).foregroundStyle(pal.tertiary)
            }
        }
    }
}

struct EventRowView: View {
    let row: Row
    let pal: Pal
    var height: CGFloat = 25
    var timeWidth: CGFloat = 44

    var body: some View {
        HStack(spacing: 0) {
            Link(destination: row.url) {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(pal.hue(row.hue))
                        .frame(width: 3, height: height - 6)
                        .widgetAccentable()
                    Text(row.time)
                        .font(.system(size: 10.5))
                        .foregroundStyle(pal.secondary)
                        .lineLimit(1)
                        .frame(width: timeWidth, alignment: .leading)
                    Text(row.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(pal.ink())
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    MarksView(row: row, pal: pal)
                }
            }
            CheckView(row: row, pal: pal)
        }
        .frame(height: height)
        .opacity(row.done ? 0.5 : 1)
    }
}

struct NowLineView: View {
    let time: String
    let pal: Pal

    var body: some View {
        HStack(spacing: 8) {
            Color.clear.frame(width: 3, height: 1)
            Text(time)
                .font(.system(size: 9.5, weight: .bold))
                .foregroundStyle(pal.ink())
                .frame(width: 44, alignment: .leading)
            ZStack(alignment: .leading) {
                Rectangle().fill(pal.ink()).frame(height: 1.5)
                Circle().fill(pal.ink()).frame(width: 7, height: 7).offset(x: -3)
            }
        }
        .frame(height: 12)
    }
}

/// The running event: a card with a progress bar and "Ends in 25 min". Both use system
/// timers, so they move between timeline entries without a reload.
struct CardView: View {
    let row: Row
    let pal: Pal

    var body: some View {
        HStack(spacing: 0) {
            Link(destination: row.url) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(row.time)
                            .font(.system(size: 10.5))
                            .foregroundStyle(pal.secondary)
                            .lineLimit(1)
                        Text(row.title)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(pal.ink())
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    HStack(spacing: 8) {
                        if row.end > row.start {
                            ProgressView(timerInterval: row.start...row.end, countsDown: false) {
                                EmptyView()
                            } currentValueLabel: {
                                EmptyView()
                            }
                            .progressViewStyle(.linear)
                            .tint(pal.ink(0.75))
                        }
                        HStack(spacing: 3) {
                            Text("Ends in")
                            Text(row.end, style: .relative)
                        }
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(pal.secondary)
                        .lineLimit(1)
                        .fixedSize()
                    }
                }
                .padding(.leading, 8)
                .padding(.vertical, 4)
            }
            CheckView(row: row, pal: pal)
        }
        .frame(height: 44)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(pal.ink(pal.p.subtle))
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(pal.hue(row.hue))
                        .frame(width: 3)
                        .widgetAccentable()
                }
        )
    }
}

struct ItemsView: View {
    let m: Model
    let pal: Pal
    var rowHeight: CGFloat = 25

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(m.items) { item in
                switch item {
                case .row(let r): EventRowView(row: r, pal: pal, height: rowHeight)
                case .now(let t): NowLineView(time: t, pal: pal)
                case .card(let r): CardView(row: r, pal: pal)
                }
            }
            if let more = m.more {
                Text(more)
                    .font(.system(size: 10.5))
                    .foregroundStyle(pal.tertiary)
                    .padding(.top, 3)
                    .padding(.leading, 11)
            }
        }
    }
}

struct GoalView: View {
    let g: GoalVM
    let pal: Pal
    let dim: Bool
    var ringSize: CGFloat = 26
    var titleSize: CGFloat = 12

    var body: some View {
        Link(destination: g.url) {
            HStack(spacing: 8) {
                RingView(color: pal.hue(g.hue), track: pal.ink(pal.p.track), fraction: g.ring, size: ringSize)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(g.title)
                            .font(.system(size: titleSize, weight: .semibold))
                            .foregroundStyle(pal.ink())
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        if let d = g.deadline {
                            Text(d)
                                .font(.system(size: 10.5))
                                .foregroundStyle(pal.tertiary)
                                .lineLimit(1)
                        }
                    }
                    if !g.today.isEmpty {
                        Text(g.today)
                            .font(.system(size: titleSize, weight: .semibold))
                            .foregroundStyle(pal.ink(dim ? 0.4 : 1))
                            .lineLimit(1)
                    }
                    Text(g.total)
                        .font(.system(size: 10.5))
                        .foregroundStyle(pal.secondary)
                        .lineLimit(1)
                }
            }
        }
    }
}

struct GoalsBlock: View {
    let goals: [GoalVM]
    let pal: Pal
    let dim: Bool
    var ringSize: CGFloat = 26
    var rule = true

    var body: some View {
        if !goals.isEmpty {
            VStack(alignment: .leading, spacing: 5) {
                ForEach(goals) { g in
                    GoalView(g: g, pal: pal, dim: dim, ringSize: ringSize)
                }
            }
            .padding(.top, rule ? 8 : 0)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) {
                if rule { Rectangle().fill(pal.ink(pal.p.hairline)).frame(height: 1) }
            }
        }
    }
}

/// An empty day. One button, "Add a note", opens the composer, so the header "+" is hidden.
struct EmptyDayView: View {
    let m: Model
    let pal: Pal
    var compact = false

    var body: some View {
        VStack(spacing: 8) {
            if !compact {
                Image(systemName: "calendar")
                    .font(.system(size: 18))
                    .foregroundStyle(pal.secondary)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(pal.ink(pal.p.subtle)))
            }
            Text("Nothing scheduled")
                .font(.system(size: compact ? 14 : 16, weight: .semibold))
                .foregroundStyle(pal.ink())
            AddNoteButton(pal: pal, height: compact ? 28 : 30, size: compact ? 12 : 12.5)
            if !compact, let next = m.emptyNext {
                Text(next)
                    .font(.system(size: 11))
                    .foregroundStyle(pal.tertiary)
                    .lineLimit(1)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: compact ? .leading : .center)
    }
}

struct AddNoteButton: View {
    let pal: Pal
    var height: CGFloat = 30
    var size: CGFloat = 12.5

    var body: some View {
        Link(destination: Links.compose) {
            HStack(spacing: 6) {
                Image(systemName: "plus").font(.system(size: size - 1.5, weight: .bold))
                Text("Add a note").font(.system(size: size, weight: .semibold))
            }
            .foregroundStyle(pal.ink())
            .padding(.horizontal, 12)
            .frame(height: height)
            .background(Capsule().fill(pal.ink(pal.p.button)))
        }
    }
}

// MARK: - Sizes

struct LargeView: View {
    let m: Model
    let pal: Pal

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HeaderView(m: m, pal: pal)
            if let strip = m.strip {
                Text(strip).font(.system(size: 10.5)).foregroundStyle(pal.tertiary).padding(.top, 4)
            }
            if m.isEmpty {
                EmptyDayView(m: m, pal: pal)
            } else {
                ItemsView(m: m, pal: pal).padding(.top, 6)
                Spacer(minLength: 0)
            }
            GoalsBlock(goals: m.goals, pal: pal, dim: m.goalsDim)
        }
        .padding(14)
    }
}

struct MediumView: View {
    let m: Model
    let pal: Pal

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                HeaderView(m: m, pal: pal, titleSize: 16, plus: 26)
                if m.isEmpty {
                    EmptyDayView(m: m, pal: pal, compact: true)
                } else {
                    ItemsView(m: m, pal: pal, rowHeight: 27).padding(.top, 4)
                    Spacer(minLength: 0)
                }
            }
            if !m.goals.isEmpty {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(m.goals) { g in
                        GoalView(g: g, pal: pal, dim: m.goalsDim, ringSize: 24, titleSize: 11.5)
                    }
                }
                .frame(width: 130)
                .frame(maxHeight: .infinity, alignment: .center)
            }
        }
        .padding(12)
    }
}

struct SmallView: View {
    let m: Model
    let pal: Pal

    var body: some View {
        // One tap target: the whole tile (widgetURL). Nothing inside is a Link.
        VStack(alignment: .leading, spacing: 0) {
            switch m.small {
            case .some(.now(let start, let end, let title, let range, let hue)):
                Text("Now").font(.system(size: 10)).tracking(1.1).textCase(.uppercase).foregroundStyle(pal.secondary)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(end, style: .relative)
                        .font(.system(size: 26, weight: .bold))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .foregroundStyle(pal.ink())
                    Text("left").font(.system(size: 13)).foregroundStyle(pal.secondary)
                }
                .padding(.top, 6)
                Spacer(minLength: 0)
                if end > start {
                    ProgressView(timerInterval: start...end, countsDown: false) {
                        EmptyView()
                    } currentValueLabel: {
                        EmptyView()
                    }
                    .progressViewStyle(.linear)
                    .tint(pal.ink(0.75))
                    .padding(.bottom, 8)
                }
                eventLine(title: title, range: range, hue: hue)
            case .some(.next(let when, let whenText, let title, let range, let hue)):
                Text("Next").font(.system(size: 10)).tracking(1.1).textCase(.uppercase).foregroundStyle(pal.secondary)
                Group {
                    if let when = when {
                        HStack(alignment: .firstTextBaseline, spacing: 5) {
                            Text("in").font(.system(size: 13)).foregroundStyle(pal.secondary)
                            Text(when, style: .relative)
                                .font(.system(size: 26, weight: .bold))
                                .minimumScaleFactor(0.6)
                                .lineLimit(1)
                                .foregroundStyle(pal.ink())
                        }
                    } else {
                        Text(whenText ?? "")
                            .font(.system(size: 26, weight: .bold))
                            .minimumScaleFactor(0.6)
                            .lineLimit(1)
                            .foregroundStyle(pal.ink())
                    }
                }
                .padding(.top, 6)
                Spacer(minLength: 0)
                eventLine(title: title, range: range, hue: hue)
            case .some(.empty(let date)):
                Text(date).font(.system(size: 10)).tracking(1.1).textCase(.uppercase).foregroundStyle(pal.secondary)
                Text("Nothing scheduled")
                    .font(.system(size: 19, weight: .bold))
                    .foregroundStyle(pal.ink())
                    .padding(.top, 8)
                Spacer(minLength: 0)
                // Not a Link: the tile itself opens the composer on an empty day.
                HStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 10.5, weight: .bold))
                    Text("Add a note").font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(pal.ink())
                .padding(.horizontal, 10)
                .frame(height: 28)
                .background(Capsule().fill(pal.ink(pal.p.button)))
            case .none:
                EmptyView()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
    }

    private func eventLine(title: String, range: String, hue: Int) -> some View {
        HStack(alignment: .center, spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(pal.hue(hue))
                .frame(width: 3, height: 32)
                .widgetAccentable()
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(pal.ink()).lineLimit(1)
                Text(range).font(.system(size: 11.5)).foregroundStyle(pal.secondary).lineLimit(1)
            }
        }
    }
}

struct DayColumnView: View {
    let col: DayColumn
    let pal: Pal
    let first: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(col.label)
                .font(.system(size: 10.5))
                .tracking(1.1)
                .textCase(.uppercase)
                .foregroundStyle(first ? pal.ink() : pal.secondary)
                .frame(height: 22, alignment: .leading)
            if let now = col.nowTime {
                NowLineView(time: now, pal: pal).frame(height: 18)
            } else if !first {
                Color.clear.frame(height: 18)
            }
            ForEach(col.rows) { r in
                HStack(spacing: 0) {
                    Link(destination: r.url) {
                        HStack(spacing: 8) {
                            RoundedRectangle(cornerRadius: 2).fill(pal.hue(r.hue)).frame(width: 3, height: 30).widgetAccentable()
                            VStack(alignment: .leading, spacing: 0) {
                                Text(r.title).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(pal.ink()).lineLimit(1)
                                Text(r.range).font(.system(size: 10.5)).foregroundStyle(pal.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                    }
                    CheckView(row: r, pal: pal)
                }
                .frame(height: 36)
                .opacity(r.done ? 0.5 : 1)
            }
            if let planned = col.planned {
                Text(planned).font(.system(size: 10.5)).foregroundStyle(pal.tertiary).padding(.top, 4)
            }
            Spacer(minLength: 0)
        }
        .frame(width: 200)
    }
}

struct ExtraLargeView: View {
    let m: Model
    let pal: Pal

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HeaderView(m: m, pal: pal, titleSize: 22, plus: 34)
            HStack(alignment: .top, spacing: 18) {
                if let today = m.today, let tomorrow = m.tomorrow {
                    DayColumnView(col: today, pal: pal, first: true)
                    DayColumnView(col: tomorrow, pal: pal, first: false)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Goals")
                        .font(.system(size: 10.5))
                        .tracking(1.1)
                        .textCase(.uppercase)
                        .foregroundStyle(pal.secondary)
                        .frame(height: 22, alignment: .leading)
                    ForEach(m.goals) { g in
                        GoalView(g: g, pal: pal, dim: m.goalsDim)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.top, 6)
        }
        .padding(18)
    }
}

// MARK: - Signed out

/// No snapshot means signed out (sign-out clears it). The whole widget links to sign-in; same card at every size.
struct SignedOutView: View {
    let layout: Layout
    let pal: Pal

    var body: some View {
        if layout == .small {
            VStack(alignment: .leading, spacing: 0) {
                Image(systemName: "calendar")
                    .font(.system(size: 18))
                    .foregroundStyle(pal.ink())
                    .frame(width: 36, height: 36)
                    .background(RoundedRectangle(cornerRadius: 9).fill(pal.ink(pal.p.button)))
                Spacer(minLength: 0)
                Text("Sign in to see your day")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(pal.ink())
                Text("Tap to open Calendar")
                    .font(.system(size: 11))
                    .foregroundStyle(pal.secondary)
                    .padding(.top, 3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
        } else {
            VStack(spacing: 9) {
                Image(systemName: "calendar")
                    .font(.system(size: 24))
                    .foregroundStyle(pal.ink())
                    .frame(width: 52, height: 52)
                    .background(RoundedRectangle(cornerRadius: 12).fill(pal.ink(pal.p.button)))
                Text("Sign in to see your day")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(pal.ink())
                Text("Your agenda and goals show here once you are signed in.")
                    .font(.system(size: 12))
                    .foregroundStyle(pal.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 220)
                Text("Open Calendar")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(pal.ink())
                    .padding(.horizontal, 16)
                    .frame(height: 32)
                    .background(Capsule().fill(pal.ink(pal.p.button)))
                    .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(14)
        }
    }
}
