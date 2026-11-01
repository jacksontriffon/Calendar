// The taps that move the Large and Medium carousels (Design Spec WG 1h, 1i, 2i).
//
// A widget cannot swipe or scroll, so a tap on a peek, a dot or the goals runs one of these App
// Intents (iOS 17): it stores the page in the App Group (`CarouselStore`, mirroring
// src/features/widget/carousel.ts) and reloads the timeline, which redraws the widget at once
// with no animation. Nothing opens the app. Each piece goes home (Today, the first goal) 5 minutes
// after its last tap and at midnight; the timeline adds an entry at the expiry (CalendarWidget.swift).
//
// The target page is passed in by the view, which knows the page count, so an intent never has to
// read the snapshot.
//
// NOTE: this file has not been compiled (no Xcode in the build environment).

import AppIntents
import WidgetKit

/// Show Yesterday (-1), Today (0) or Tomorrow (1) on Large.
struct ShowDayIntent: AppIntent {
    static var title: LocalizedStringResource = "Show day"
    static var description = IntentDescription("Moves the Calendar widget to another day.")
    // Only the widget uses it; keep it out of Shortcuts and Spotlight.
    static var isDiscoverable: Bool = false

    @Parameter(title: "Day")
    var offset: Int

    init() {}

    init(offset: Int) {
        self.offset = offset
    }

    func perform() async throws -> some IntentResult {
        CarouselStore.tap(day: max(-1, min(1, offset)))
        WidgetCenter.shared.reloadTimelines(ofKind: Shared.widgetKind)
        return .result()
    }
}

/// Show another page of goals: two a page on Large (`layout` "large"), one on Medium ("medium").
struct ShowGoalPageIntent: AppIntent {
    static var title: LocalizedStringResource = "Show goals"
    static var description = IntentDescription("Moves the Calendar widget to the next goals.")
    static var isDiscoverable: Bool = false

    @Parameter(title: "Widget")
    var layout: String

    @Parameter(title: "Page")
    var page: Int

    init() {}

    init(layout: String, page: Int) {
        self.layout = layout
        self.page = page
    }

    func perform() async throws -> some IntentResult {
        let p = max(0, page)
        if layout == "medium" {
            CarouselStore.tap(medium: p)
        } else {
            CarouselStore.tap(large: p)
        }
        WidgetCenter.shared.reloadTimelines(ofKind: Shared.widgetKind)
        return .result()
    }
}
