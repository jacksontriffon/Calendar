// The widget views: Large, Medium, Small, iPad Extra Large, the empty day and the
// signed-out card (Design Spec WG 1 to 3, 6). Sizes and opacities are the frames'.
//
// Rules the spec sets:
//  - no coloured text: ink is the system's white or black at fixed opacities;
//    hues appear only on event bars, goal rings and the Large goals chart, and all
//    are `widgetAccentable()` so tinted and clear modes flatten them to the tint;
//  - no check buttons anywhere: a done event is struck through and dimmed. Large and
//    Medium (WG 1g to 1i, 2i) also have no "+" and no "n left" counts; the message field
//    along the bottom is the one way to add, and opens the composer;
//  - a widget cannot swipe, so the day carousel and the goal pages move on a tap:
//    Button(intent:) runs an App Intent (CarouselIntents.swift) that stores the page
//    and reloads the timeline, with no animation;
//  - iPad keeps its layout minus the check; Link for every tap that opens the app.
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
    /// The now line and the send button on Large and Medium.
    let accent: Color
    /// Solid fill of the message field, and the glyph on the send button.
    let field: Color
    let accentInk: Color

    static let defaultSwatch: [String: String] = [
        "28": "#d97757", "60": "#d4a27f", "125": "#788c5d", "170": "#8fb3a6",
        "240": "#6a9bcc", "290": "#9a8fbf", "350": "#c4758a", "1000": "#b0aea5",
    ]

    init(_ snapshot: Snapshot?, scheme: ColorScheme) {
        let t = snapshot?.tokens
        let palette: Palette = scheme == .dark ? (t?.dark ?? .dark) : (t?.light ?? .light)
        p = palette
        swatch = t?.swatch ?? Pal.defaultSwatch
        amber = Color(hex: t?.amber ?? "#e3b25a")
        accent = Color(hex: snapshot?.prefs.accent ?? "#cf7b58")
        field = Color(hex: palette.field ?? (scheme == .dark ? "#34312e" : "#ffffff"))
        accentInk = Color(hex: palette.accentInk ?? "#17120f")
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
        // The tap state was read when the timeline was built; it reads as home once it has expired by `entry.date`.
        let carousel = CarouselStore.resolve(entry.carousel, now: entry.date)
        let model = Model.build(entry.snapshot, now: entry.date, layout: layout, carousel: carousel, redactPrivate: redaction.contains(.privacy))
        content(model, pal)
            .redacted(reason: entry.isPlaceholder ? .placeholder : [])
            // Carousel taps redraw at once, with no animation.
            .contentTransition(.identity)
            .transaction { $0.animation = nil }
            // The background opens the day in view (today on Small and iPad).
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

/// Sizes of the event list: Large (WG 1g) and Medium (WG 2i) differ, and the heights are what `Fit` in
/// Model.swift fits the rows into.
struct ListStyle {
    var rowH: CGFloat
    var barH: CGFloat
    var timeW: CGFloat
    var timeSize: CGFloat
    var titleSize: CGFloat
    var nowH: CGFloat
    var nowSize: CGFloat
    var cardH: CGFloat
    var moreSize: CGFloat
    var moreH: CGFloat
    var moreIndent: CGFloat
    var gap: CGFloat

    static let large = ListStyle(rowH: 20, barH: 13, timeW: 44, timeSize: 10.5, titleSize: 13, nowH: 14, nowSize: 9.5, cardH: 44, moreSize: 10.5, moreH: 14, moreIndent: 11, gap: 8)
    static let medium = ListStyle(rowH: 16, barH: 12, timeW: 40, timeSize: 9.5, titleSize: 12, nowH: 11, nowSize: 9, cardH: 36, moreSize: 10, moreH: 12, moreIndent: 9, gap: 6)
}

/// The inside of an event row: colour bar, time, title (struck through when done) and the marks.
/// Done is dimmed as a whole. No check button.
struct RowContent: View {
    let row: Row
    let pal: Pal
    var style: ListStyle = .large

    var body: some View {
        HStack(spacing: style.gap) {
            RoundedRectangle(cornerRadius: 2)
                .fill(pal.hue(row.hue))
                .frame(width: 3, height: style.barH)
                .widgetAccentable()
            Text(row.time)
                .font(.system(size: style.timeSize))
                .foregroundStyle(pal.secondary)
                .lineLimit(1)
                .frame(width: style.timeW, alignment: .leading)
            Text(row.title)
                .font(.system(size: style.titleSize, weight: .semibold))
                .strikethrough(row.done)
                .foregroundStyle(pal.ink())
                .lineLimit(1)
            Spacer(minLength: 0)
            MarksView(row: row, pal: pal)
        }
        .frame(height: style.rowH)
        .opacity(row.done ? 0.5 : 1)
    }
}

struct EventRowView: View {
    let row: Row
    let pal: Pal
    var style: ListStyle = .large

    var body: some View {
        Link(destination: row.url) {
            RowContent(row: row, pal: pal, style: style)
        }
        .frame(height: style.rowH)
    }
}

/// The now line. Large and Medium draw it in the accent; iPad keeps it ink.
struct NowLineView: View {
    let time: String
    let pal: Pal
    var accent: Color? = nil
    var timeWidth: CGFloat = 44
    var timeSize: CGFloat = 9.5
    var gap: CGFloat = 8
    var height: CGFloat = 12

    var body: some View {
        let line = accent ?? pal.ink()
        HStack(spacing: gap) {
            Color.clear.frame(width: 3, height: 1)
            Text(time)
                .font(.system(size: timeSize, weight: .bold))
                .foregroundStyle(pal.ink())
                .frame(width: timeWidth, alignment: .leading)
            ZStack(alignment: .leading) {
                Rectangle().fill(line).frame(height: 1.5)
                Circle().fill(line).frame(width: 7, height: 7).offset(x: -3)
            }
        }
        .frame(height: height)
    }
}

/// The running event: a card with a progress bar and "Ends in 25 min". Both use system
/// timers, so they move between timeline entries without a reload.
struct CardView: View {
    let row: Row
    let pal: Pal
    var style: ListStyle = .large

    var body: some View {
        Link(destination: row.url) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(row.time)
                        .font(.system(size: style.timeSize))
                        .foregroundStyle(pal.secondary)
                        .lineLimit(1)
                    Text(row.title)
                        .font(.system(size: style.titleSize, weight: .semibold))
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
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: style.cardH)
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
}

/// The page's list: the finished session, the now line (accent) or the running card, the next
/// events, and "+ n more today" when some did not fit.
struct ItemsView: View {
    let m: Model
    let pal: Pal
    var style: ListStyle = .large

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(m.items) { item in
                switch item {
                case .row(let r):
                    EventRowView(row: r, pal: pal, style: style)
                case .now(let t):
                    NowLineView(time: t, pal: pal, accent: pal.accent, timeWidth: style.timeW, timeSize: style.nowSize, gap: style.gap, height: style.nowH)
                case .card(let r):
                    CardView(row: r, pal: pal, style: style)
                }
            }
            if let more = m.more {
                Text(more)
                    .font(.system(size: style.moreSize))
                    .foregroundStyle(pal.tertiary)
                    .frame(height: style.moreH, alignment: .leading)
                    .padding(.leading, style.moreIndent)
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

/// A day with nothing on it. No button: the message field along the bottom is the one way to add.
struct EmptyPageView: View {
    let next: String?
    let pal: Pal
    var compact = false

    var body: some View {
        VStack(alignment: compact ? .leading : .center, spacing: 3) {
            Text("Nothing scheduled")
                .font(.system(size: compact ? 12 : 14, weight: .semibold))
                .foregroundStyle(pal.ink())
            if let next = next {
                Text(next)
                    .font(.system(size: compact ? 10 : 11))
                    .foregroundStyle(pal.tertiary)
                    .lineLimit(compact ? 2 : 1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: compact ? .leading : .center)
    }
}

// MARK: - Goals in pages (Large and Medium)

/// A ring with the time left inside ("45m" and "left" under it), or "Done".
struct GoalRingView: View {
    let g: GoalVM
    let pal: Pal
    let size: CGFloat
    var leftSize: CGFloat = 9.5
    var captionSize: CGFloat = 8

    var body: some View {
        ZStack {
            RingView(color: pal.hue(g.hue), track: pal.ink(pal.p.track), fraction: g.ring, size: size)
            if g.isDone {
                Text("Done")
                    .font(.system(size: captionSize + 0.5, weight: .semibold))
                    .foregroundStyle(pal.ink())
            } else if !g.left.isEmpty {
                VStack(spacing: 0) {
                    Text(g.left)
                        .font(.system(size: leftSize, weight: .semibold))
                        .foregroundStyle(pal.ink())
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text("left")
                        .font(.system(size: captionSize))
                        .foregroundStyle(pal.secondary)
                }
                .frame(width: size * 0.7)
            }
        }
        .frame(width: size, height: size)
    }
}

/// One goal: the ring and the name beside it. No total left and no deadline.
struct GoalCell: View {
    let g: GoalVM
    let pal: Pal
    var ringSize: CGFloat = 34
    var titleSize: CGFloat = 11
    var lines = 2
    var gap: CGFloat = 6
    var leftSize: CGFloat = 9.5
    var captionSize: CGFloat = 8

    var body: some View {
        HStack(spacing: gap) {
            GoalRingView(g: g, pal: pal, size: ringSize, leftSize: leftSize, captionSize: captionSize)
            Text(g.title)
                .font(.system(size: titleSize, weight: .semibold))
                .foregroundStyle(pal.ink())
                .lineLimit(lines)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Page dots under the goals: the current page in ink, the others tertiary.
struct PageDots: View {
    let pages: GoalPages
    let pal: Pal

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<pages.count, id: \.self) { i in
                Circle()
                    .fill(i == pages.index ? pal.ink() : pal.tertiary)
                    .frame(width: 4, height: 4)
            }
        }
        .frame(height: 4)
    }
}

/// The goals on show and the dots for the other pages. A tap on a goal opens the goals graph in the
/// app; with more than one page, a tap on the dots shows the next page (widgets cannot swipe).
struct GoalsPager: View {
    let m: Model
    let pal: Pal
    /// "large" or "medium": which page state the tap sets (CarouselIntents.swift).
    let layoutName: String
    var ringSize: CGFloat = 34
    var titleSize: CGFloat = 11
    var lines = 2
    var gap: CGFloat = 6
    var leftSize: CGFloat = 9.5
    var captionSize: CGFloat = 8
    var spacing: CGFloat = 10
    /// Medium stacks its dots under a single goal; Large puts two goals side by side.
    var rowSpacing: CGFloat = 2

    private func cell(_ g: GoalVM) -> some View {
        GoalCell(g: g, pal: pal, ringSize: ringSize, titleSize: titleSize, lines: lines, gap: gap, leftSize: leftSize, captionSize: captionSize)
    }

    var body: some View {
        if !m.goals.isEmpty {
            let pages = m.goalPages ?? GoalPages(index: 0, count: 1)
            if pages.count > 1 {
                VStack(spacing: rowSpacing) {
                    HStack(spacing: spacing) {
                        ForEach(m.goals) { g in
                            Link(destination: g.url) { cell(g) }
                        }
                    }
                    Button(intent: ShowGoalPageIntent(layout: layoutName, page: (pages.index + 1) % pages.count)) {
                        PageDots(pages: pages, pal: pal)
                            .frame(maxWidth: .infinity, minHeight: 16)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            } else {
                HStack(spacing: spacing) {
                    ForEach(m.goals) { g in
                        Link(destination: g.url) { cell(g) }
                    }
                }
            }
        }
    }
}

// MARK: - Message field

/// The message field along the bottom of Large and Medium, on a solid fill. A widget has no text
/// input, so it is drawn as one: a tap anywhere on it, or on the send button, opens the composer.
struct MessageField: View {
    let compose: Compose
    let pal: Pal
    var height: CGFloat = 32
    var textSize: CGFloat = 12.5
    var button: CGFloat = 26
    var inset: CGFloat = 12

    var body: some View {
        Link(destination: compose.url) {
            HStack(spacing: 6) {
                Text(compose.placeholder)
                    .font(.system(size: textSize))
                    .foregroundStyle(pal.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "arrow.up")
                    .font(.system(size: button * 0.46, weight: .bold))
                    .foregroundStyle(pal.accentInk)
                    .frame(width: button, height: button)
                    .background(Circle().fill(pal.accent))
            }
            .padding(.leading, inset)
            .padding(.trailing, 3)
            .frame(height: height)
            .background(Capsule().fill(pal.field))
            .overlay(Capsule().strokeBorder(pal.ink(pal.p.hairline), lineWidth: 1))
        }
    }
}

// MARK: - Day carousel (Large)

/// A neighbouring day, dimmed above or below the page in view. A tap moves the carousel to that day.
struct PeekView: View {
    let peek: Peek
    let pal: Pal
    /// The peek above the page (a rule under it) or below it (a rule over it).
    let above: Bool

    var body: some View {
        Button(intent: ShowDayIntent(offset: peek.offset)) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: above ? "chevron.up" : "chevron.down")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundStyle(pal.tertiary)
                    Text(peek.label)
                        .font(.system(size: 10))
                        .tracking(1)
                        .textCase(.uppercase)
                        .foregroundStyle(pal.secondary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if let summary = peek.summary {
                        Text(summary)
                            .font(.system(size: 10.5))
                            .foregroundStyle(pal.tertiary)
                            .lineLimit(1)
                    }
                }
                .frame(height: 16)
                if let r = peek.row {
                    RowContent(row: r, pal: pal, style: .large)
                } else if peek.empty {
                    Text("Nothing scheduled")
                        .font(.system(size: 11))
                        .foregroundStyle(pal.tertiary)
                        .frame(height: 20, alignment: .leading)
                        .padding(.leading, 11)
                } else {
                    Color.clear.frame(height: 20)
                }
            }
            .frame(height: 37)
            .opacity(0.72)
            .overlay(alignment: above ? .bottom : .top) {
                Rectangle().fill(pal.ink(pal.p.hairline)).frame(height: 1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// The page in view: its heading and summary, then the list (or "Nothing scheduled").
struct DayPageView: View {
    let m: Model
    let pal: Pal
    let pager: Pager

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(pager.heading)
                    .font(.system(size: 10))
                    .tracking(1)
                    .textCase(.uppercase)
                    .foregroundStyle(pal.ink())
                Spacer(minLength: 0)
                if let summary = pager.summary {
                    Text(summary)
                        .font(.system(size: 10.5))
                        .foregroundStyle(pal.tertiary)
                        .lineLimit(1)
                }
            }
            .frame(height: 18)
            if m.pageEmpty {
                EmptyPageView(next: m.emptyNext, pal: pal)
            } else {
                ItemsView(m: m, pal: pal, style: .large)
                Spacer(minLength: 0)
            }
        }
    }
}

/// Three dots down the right edge: where the carousel stands. A tap on one goes to that day.
struct DayDots: View {
    let pager: Pager
    let pal: Pal

    var body: some View {
        VStack(spacing: 0) {
            ForEach(pager.dots, id: \.self) { d in
                Button(intent: ShowDayIntent(offset: d)) {
                    Circle()
                        .fill(d == pager.day ? pal.ink() : pal.tertiary)
                        .frame(width: 4, height: 4)
                        .frame(width: 12, height: 9)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Sizes

// MARK: - Goals chart (Large header, WG 1g)

/// A bar with rounded top corners and a square foot, like the Goals graph's bars.
private func topRounded(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ radius: CGFloat) -> Path {
    let r = min(radius, w / 2, h)
    var p = Path()
    p.move(to: CGPoint(x: x, y: y + h))
    p.addLine(to: CGPoint(x: x, y: y + r))
    p.addQuadCurve(to: CGPoint(x: x + r, y: y), control: CGPoint(x: x, y: y))
    p.addLine(to: CGPoint(x: x + w - r, y: y))
    p.addQuadCurve(to: CGPoint(x: x + w, y: y + r), control: CGPoint(x: x + w, y: y))
    p.addLine(to: CGPoint(x: x + w, y: y + h))
    p.closeSubpath()
    return p
}

/// One chart for the two goals on show: Wed, Thu and Today, one bar per goal in each. The bars are hours
/// done that day; today's bar is what is done so far with the hours still required hatched on top (a bar
/// that is all hatch when nothing is done yet). A dotted line across the chart marks the hours a day each
/// goal needs. Marks follow the Goals graph: swatch bars, the line at 38%, a soft column behind today.
/// 118 x 64 pt: 3 columns over 53 pt of plot and an 11 pt label row (the frame in WG 1g).
struct GoalsChartView: View {
    let goals: [GoalVM]
    let days: [String]
    let yMax: Double
    let pal: Pal

    static let width: CGFloat = 118
    static let height: CGFloat = 64
    private let labelH: CGFloat = 11
    private let padT: CGFloat = 3
    private let gap: CGFloat = 2

    private var base: CGFloat { Self.height - labelH }
    private var slot: CGFloat { Self.width / 3 }
    private var bw: CGFloat { min(12, (slot * 0.74 - CGFloat(max(0, goals.count - 1)) * gap) / CGFloat(max(1, goals.count))) }

    private func y(_ v: Double) -> CGFloat {
        base - CGFloat(v / max(yMax, 0.0001)) * (base - padT)
    }
    private func barX(_ column: Int, _ goal: Int) -> CGFloat {
        let off = (CGFloat(goal) - CGFloat(goals.count - 1) / 2) * (bw + gap)
        return (CGFloat(column) + 0.5) * slot + off - bw / 2
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Neutral: the column behind today and the baseline.
            Canvas { ctx, _ in
                ctx.fill(topRounded(2 * slot, padT, slot, base - padT, 6), with: .color(pal.ink(0.045)))
                var line = Path()
                line.move(to: CGPoint(x: 0, y: base + 0.5))
                line.addLine(to: CGPoint(x: Self.width, y: base + 0.5))
                ctx.stroke(line, with: .color(pal.ink(0.08)), lineWidth: 1)
            }
            // The goals' colours: bars, hatched bars and the dotted lines.
            Canvas { ctx, _ in
                for (gi, g) in goals.enumerated() {
                    let color = pal.hue(g.hue)
                    let values = [g.prev[0], g.prev[1], g.doneToday]
                    for column in 0..<3 {
                        let x = barX(column, gi)
                        let v = values[column]
                        let h: CGFloat = v > 0 ? max(3, base - y(v)) : 0
                        let req = column == 2 ? g.leftHours : 0
                        let gh: CGFloat = req > 0 ? max(3, base - y(req)) : 0
                        if gh > 0 {
                            // Hours still required today. On a solid bar the stripes are the Goals graph's neutral
                            // ones; a bar that is all hatch takes its goal's colour so it can be told apart.
                            let capTop = base - h - gh
                            let path = topRounded(x, capTop, bw, gh, 3)
                            ctx.fill(path, with: .color(pal.ink(0.1)))
                            var clipped = ctx
                            clipped.clip(to: path)
                            let stripe: Color = h > 0 ? pal.ink(0.16) : color.opacity(0.62)
                            var sx = x - gh
                            while sx < x + bw {
                                var s = Path()
                                s.move(to: CGPoint(x: sx, y: capTop + gh))
                                s.addLine(to: CGPoint(x: sx + gh, y: capTop))
                                clipped.stroke(s, with: .color(stripe), style: StrokeStyle(lineWidth: 3))
                                sx += 8.5
                            }
                        }
                        if h > 0 {
                            ctx.fill(topRounded(x, base - h, bw, h, gh > 0 ? 0 : 3), with: .color(color))
                        }
                    }
                }
                for g in goals where g.need > 0 {
                    var line = Path()
                    line.move(to: CGPoint(x: 0, y: y(g.need)))
                    line.addLine(to: CGPoint(x: Self.width, y: y(g.need)))
                    ctx.stroke(line, with: .color(pal.hue(g.hue).opacity(0.38)), style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [0.1, 4.6]))
                }
            }
            .widgetAccentable()
            HStack(spacing: 0) {
                ForEach(0..<3, id: \.self) { i in
                    Text(i < days.count ? days[i] : "")
                        .font(.system(size: 9, weight: i == 2 ? .semibold : .regular))
                        .foregroundStyle(i == 2 ? pal.ink(0.85) : pal.ink(0.34))
                        .frame(width: slot)
                }
            }
            .frame(height: labelH)
            .offset(y: base)
        }
        .frame(width: Self.width, height: Self.height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(goals.map { g in
            "\(g.title): \(g.today.isEmpty ? "numbers are old" : g.today)"
        }.joined(separator: ". "))
    }
}

/// The two goals' names beside the chart, each with the time left today; the swatch says which bars are whose.
struct GoalsLegend: View {
    let goals: [GoalVM]
    let pal: Pal

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(goals) { g in
                HStack(alignment: .top, spacing: 5) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(pal.hue(g.hue))
                        .frame(width: 6, height: 6)
                        .frame(height: 12)
                        .widgetAccentable()
                    VStack(alignment: .leading, spacing: 0) {
                        Text(g.title)
                            .font(.system(size: 10.5, weight: .semibold))
                            .tracking(-0.1)
                            .foregroundStyle(pal.ink())
                            .lineLimit(1)
                        Text(g.today)
                            .font(.system(size: 10))
                            .foregroundStyle(pal.secondary)
                            .lineLimit(1)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// The Large header (WG 1g): the date with the month under it and the goal page dots below, then one chart
/// for the goals on show (the last two days and Today) with their names and time left today beside it.
/// The date follows the day in view. A stale widget gets the cloud-off mark before the month.
struct PagedHeaderView: View {
    let m: Model
    let pal: Pal

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Text(m.title)
                    .font(.system(size: 19, weight: .semibold))
                    .tracking(-0.5)
                    .foregroundStyle(pal.ink())
                    .lineLimit(1)
                    .padding(.top, 2)
                HStack(spacing: 4) {
                    if m.stale {
                        // The one amber mark: the cloud-off glyph. The text stays ink.
                        Image(systemName: "icloud.slash")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(pal.amber)
                    }
                    Text(m.month)
                        .font(.system(size: 11))
                        .foregroundStyle(pal.secondary)
                        .lineLimit(1)
                }
                .padding(.top, 1)
                Spacer(minLength: 0)
                if let pages = m.goalPages, pages.count > 1 {
                    // Widgets cannot swipe: a tap on the dots shows the next goal page.
                    Button(intent: ShowGoalPageIntent(layout: "large", page: (pages.index + 1) % pages.count)) {
                        PageDots(pages: pages, pal: pal)
                            .frame(minWidth: 44, minHeight: 16, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .fixedSize(horizontal: true, vertical: false)
            .frame(minWidth: 56, maxHeight: .infinity, alignment: .topLeading)
            if !m.goals.isEmpty {
                // A tap on the chart or the names opens the goals graph in the app.
                Link(destination: m.goals[0].url) {
                    HStack(alignment: .top, spacing: 12) {
                        GoalsChartView(goals: m.goals, days: m.chartDays, yMax: m.chartMax, pal: pal)
                        GoalsLegend(goals: m.goals, pal: pal)
                            .frame(height: GoalsChartView.height)
                    }
                }
            } else {
                Spacer(minLength: 0)
            }
        }
        .frame(height: 68)
    }
}

struct LargeView: View {
    let m: Model
    let pal: Pal

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PagedHeaderView(m: m, pal: pal)
            ZStack(alignment: .trailing) {
                VStack(alignment: .leading, spacing: 0) {
                    if let before = m.pager?.before {
                        PeekView(peek: before, pal: pal, above: true)
                    }
                    if let pager = m.pager {
                        DayPageView(m: m, pal: pal, pager: pager)
                            .frame(maxHeight: .infinity, alignment: .top)
                    }
                    if let after = m.pager?.after {
                        PeekView(peek: after, pal: pal, above: false)
                    }
                }
                .padding(.trailing, 12)
                if let pager = m.pager {
                    DayDots(pager: pager, pal: pal)
                }
            }
            .padding(.top, 6)
            .frame(maxHeight: .infinity)
            if let compose = m.compose {
                MessageField(compose: compose, pal: pal)
                    .padding(.top, 8)
            }
        }
        .padding(14)
    }
}

/// Medium (WG 2i): the date and one goal at a time in a left third, today in the right two thirds.
struct MediumView: View {
    let m: Model
    let pal: Pal

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 6) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(m.title)
                            .font(.system(size: 17, weight: .semibold))
                            .tracking(-0.4)
                            .foregroundStyle(pal.ink())
                            .lineLimit(1)
                        HStack(spacing: 4) {
                            if m.stale {
                                Image(systemName: "icloud.slash")
                                    .font(.system(size: 8, weight: .medium))
                                    .foregroundStyle(pal.amber)
                            }
                            Text(m.month)
                                .font(.system(size: 10))
                                .foregroundStyle(pal.secondary)
                                .lineLimit(1)
                        }
                    }
                    .frame(height: 30, alignment: .leading)
                    GoalsPager(
                        m: m, pal: pal, layoutName: "medium",
                        ringSize: 40, titleSize: 10.5, lines: 3, gap: 7, leftSize: 10, captionSize: 8.5, rowSpacing: 9
                    )
                    .frame(maxHeight: .infinity)
                }
                .frame(width: 101, alignment: .leading)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Today")
                        .font(.system(size: 9))
                        .tracking(0.8)
                        .textCase(.uppercase)
                        .foregroundStyle(pal.ink())
                        .frame(height: 11, alignment: .leading)
                    if m.pageEmpty {
                        EmptyPageView(next: m.emptyNext, pal: pal, compact: true)
                    } else {
                        ItemsView(m: m, pal: pal, style: .medium)
                            .padding(.top, 3)
                        Spacer(minLength: 0)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: .infinity)
            if let compose = m.compose {
                MessageField(compose: compose, pal: pal, height: 26, textSize: 11.5, button: 20, inset: 11)
                    .padding(.top, 6)
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
                                Text(r.title).font(.system(size: 13.5, weight: .semibold)).strikethrough(r.done).foregroundStyle(pal.ink()).lineLimit(1)
                                Text(r.range).font(.system(size: 10.5)).foregroundStyle(pal.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                    }
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
