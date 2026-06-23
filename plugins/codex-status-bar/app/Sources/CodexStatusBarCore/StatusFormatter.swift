import Foundation

public struct RenderedStatus: Equatable {
    public var title: String
    public var tooltip: String
    public var menuLines: [String]
    public var needsAttention: Bool
}

public struct StatusFormatter {
    public init() {}

    public func render(_ state: StatusState?, now: Date = Date()) -> RenderedStatus {
        guard let state else {
            return RenderedStatus(
                title: "Codex idle",
                tooltip: "No Codex Status Bar state has been written yet.",
                menuLines: ["Waiting for Codex activity"],
                needsAttention: false
            )
        }

        let title = titleForState(state, now: now)
        var lines = [state.headline, state.detail]

        if let progress = state.progress, progress.total > 0 {
            lines.append("\(progress.done)/\(progress.total) \(progress.label) complete")
            lines.append(contentsOf: progress.items.prefix(5).map { item in
                "\(symbol(for: item.status)) \(item.step)"
            })
        }

        let running = state.sessions.values
            .filter { ["active", "thinking", "running", "approval", "compacting"].contains($0.status) }
            .sorted { $0.lastActivityAt > $1.lastActivityAt }

        if !running.isEmpty {
            lines.append("Running sessions: \(running.count)")
            for session in running.prefix(4) {
                let tool = session.currentTool.map { " · \($0)" } ?? ""
                lines.append("\(statusLabel(session.status)) \(session.project)\(tool)")
            }
        }

        if state.aggregate.completedSessions > 0 {
            lines.append("Completed sessions: \(state.aggregate.completedSessions)")
        }

        if let activeSince = state.aggregate.activeSince {
            lines.append("Active for \(duration(from: activeSince, to: now))")
        }

        lines.append("Updated \(relativeTime(from: state.updatedAt, to: now))")

        return RenderedStatus(
            title: title,
            tooltip: lines.prefix(3).joined(separator: "\n"),
            menuLines: lines,
            needsAttention: state.attention == "approval" || state.aggregate.approvalsRequired > 0
        )
    }

    private func titleForState(_ state: StatusState, now: Date) -> String {
        if state.aggregate.approvalsRequired > 0 {
            return "Codex: \(state.aggregate.approvalsRequired) approval"
        }

        if let progress = state.progress, progress.total > 0 {
            return "Codex: \(progress.done)/\(progress.total) \(progress.label)"
        }

        if state.aggregate.runningSessions > 0 {
            if let activeSince = state.aggregate.activeSince {
                return "Codex: \(state.aggregate.runningSessions) running \(duration(from: activeSince, to: now))"
            }
            return "Codex: \(state.aggregate.runningSessions) running"
        }

        if state.aggregate.completedSessions > 0 {
            return "Codex: \(state.aggregate.completedSessions) done"
        }

        return "Codex idle"
    }

    private func symbol(for status: String) -> String {
        switch status.lowercased() {
        case "completed", "complete", "done":
            return "✓"
        case "in_progress", "running", "active":
            return "…"
        case "failed", "error":
            return "!"
        default:
            return "·"
        }
    }

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "approval":
            return "Approval"
        case "running":
            return "Running"
        case "thinking":
            return "Thinking"
        case "compacting":
            return "Compacting"
        default:
            return status.capitalized
        }
    }

    private func duration(from start: Date, to end: Date) -> String {
        let seconds = max(0, Int(end.timeIntervalSince(start)))
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        let remainder = minutes % 60
        return remainder == 0 ? "\(hours)h" : "\(hours)h \(remainder)m"
    }

    private func relativeTime(from date: Date, to now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 5 { return "just now" }
        if seconds < 60 { return "\(seconds)s ago" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        return "\(hours / 24)d ago"
    }
}
