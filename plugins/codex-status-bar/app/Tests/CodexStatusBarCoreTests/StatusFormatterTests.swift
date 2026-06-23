import XCTest
@testable import CodexStatusBarCore

final class StatusFormatterTests: XCTestCase {
    private let formatter = StatusFormatter()
    private let baseDate = ISO8601DateFormatter().date(from: "2026-06-22T18:00:00Z")!

    func testRendersProgressBeforeRunningCount() {
        var state = sampleState()
        state.progress = ProgressSummary(
            label: "tasks",
            done: 2,
            total: 5,
            items: [
                ProgressItem(step: "Plan install path", status: "completed"),
                ProgressItem(step: "Build hooks", status: "completed"),
                ProgressItem(step: "Launch app", status: "in_progress")
            ],
            source: "tool-input"
        )
        state.sessions["session-a"]?.progress = state.progress

        let rendered = formatter.render(state, now: baseDate.addingTimeInterval(180))

        XCTAssertEqual(rendered.title, "Codex 2/5")
        XCTAssertTrue(rendered.menuLines.contains("2/5 tasks complete"))
        XCTAssertEqual(rendered.sessions.first?.title, "Codex - project - 2/5 tasks")
        XCTAssertFalse(rendered.needsAttention)
    }

    func testApprovalGetsAttention() {
        var state = sampleState()
        state.attention = "approval"
        state.aggregate.approvalsRequired = 1

        let rendered = formatter.render(state, now: baseDate)

        XCTAssertEqual(rendered.title, "Codex !1")
        XCTAssertTrue(rendered.needsAttention)
    }

    func testRunningIncludesElapsedTime() {
        var state = sampleState()
        state.aggregate.runningSessions = 2
        state.aggregate.activeSince = baseDate.addingTimeInterval(-3 * 60 * 60 - 4 * 60)
        state.sessions["session-a"]?.status = "running"

        let rendered = formatter.render(state, now: baseDate)

        XCTAssertEqual(rendered.title, "Codex 2")
        XCTAssertEqual(rendered.menuLines.first, "2 active sessions")
    }

    private func sampleState() -> StatusState {
        let session = SessionSummary(
            id: "session-a",
            cwd: "/tmp/project",
            project: "project",
            model: "gpt-5.5",
            status: "thinking",
            startedAt: baseDate.addingTimeInterval(-120),
            updatedAt: baseDate,
            lastActivityAt: baseDate,
            completedAt: nil,
            currentTurnStartedAt: baseDate.addingTimeInterval(-120),
            currentTool: nil,
            lastEvent: "UserPromptSubmit",
            approvalRequired: false,
            turnsStarted: 1,
            turnsCompleted: 0,
            toolCallsStarted: 0,
            toolCallsCompleted: 0
        )

        return StatusState(
            version: 1,
            installId: "install-a",
            updatedAt: baseDate,
            attention: nil,
            headline: "1 running",
            detail: "Turn started",
            current: CurrentActivity(status: "thinking", event: "UserPromptSubmit", toolName: nil, startedAt: baseDate),
            progress: nil,
            aggregate: AggregateSummary(
                runningSessions: 1,
                completedSessions: 0,
                approvalsRequired: 0,
                totalToolCalls: 0,
                activeSince: baseDate.addingTimeInterval(-120)
            ),
            sessions: ["session-a": session]
        )
    }
}
