// The check button on a task or goal session (Design Spec WG 5a, pin 2).
// Marks the event done without opening the app: the event id goes on the queue
// in the App Group, the row redraws dimmed and the goal ring moves at once, and
// the app applies the change through its store (so it syncs) the next time it
// runs: launch, foreground or background refresh. See src/features/widget/queue.ts.
//
// NOTE: this file has not been compiled (no Xcode in the build environment).

import AppIntents
import WidgetKit

struct MarkDoneIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark done"
    static var description = IntentDescription("Marks a session on your calendar as done.")
    // Only the widget uses it; keep it out of Shortcuts and Spotlight.
    static var isDiscoverable: Bool = false

    @Parameter(title: "Event")
    var eventID: String

    init() {}

    init(eventID: String) {
        self.eventID = eventID
    }

    func perform() async throws -> some IntentResult {
        Store.appendDone(eventID: eventID)
        WidgetCenter.shared.reloadTimelines(ofKind: Shared.widgetKind)
        return .result()
    }
}
