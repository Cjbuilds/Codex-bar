import Foundation

public struct RenderedStatus: Equatable {
    public var title: String
    public var tooltip: String
    public var menuLines: [String]
    public var sessions: [RenderedSession]
    public var needsAttention: Bool
}

public struct RenderedSession: Equatable {
    public var id: String
    public var title: String
    public var detail: String
    public var openURL: String?
    public var needsAttention: Bool
}

public struct StatusFormatter {
    public init() {}

    public func render(_ state: StatusState?, now: Date = Date()) -> RenderedStatus {
        guard let state else {
            return RenderedStatus(
                title: "Codex",
                tooltip: "Waiting for Codex activity.",
                menuLines: ["Waiting for Codex activity"],
                sessions: [],
                needsAttention: false
            )
        }

        let renderedSessions = sessionRows(for: state, now: now)
        var lines = [summaryLine(for: state, renderedSessions: renderedSessions)]
        lines.append(contentsOf: renderedSessions.map(\.title))

        if let first = activeSession(from: state), let progress = first.progress, progress.total > 0 {
            lines.append(contentsOf: progress.items.prefix(5).map { item in
                "\(symbol(for: item.status)) \(item.step)"
            })
        }

        return RenderedStatus(
            title: titleForState(state, now: now),
            tooltip: lines.prefix(3).joined(separator: "\n"),
            menuLines: lines,
            sessions: renderedSessions,
            needsAttention: state.attention == "approval" || state.aggregate.approvalsRequired > 0
        )
    }

    private func titleForState(_ state: StatusState, now: Date) -> String {
        if state.aggregate.approvalsRequired > 0 {
            return "Codex !\(state.aggregate.approvalsRequired)"
        }

        if let progress = state.progress, progress.total > 0 {
            return "Codex \(progress.done)/\(progress.total)"
        }

        if state.aggregate.runningSessions > 0 {
            if state.aggregate.runningSessions == 1, let session = activeSession(from: state) {
                if let goal = session.goal, goal.status == "active", session.progress == nil {
                    return "Codex goal"
                }
                if let activeSince = state.aggregate.activeSince {
                    return "Codex \(duration(from: activeSince, to: now))"
                }
            }
            return "Codex \(state.aggregate.runningSessions)"
        }

        if state.aggregate.completedSessions > 0 {
            return "Codex done"
        }

        return "Codex"
    }

    private func summaryLine(for state: StatusState, renderedSessions: [RenderedSession]) -> String {
        if state.aggregate.approvalsRequired > 0 {
            return "\(state.aggregate.approvalsRequired) session\(state.aggregate.approvalsRequired == 1 ? "" : "s") waiting for approval"
        }
        if let progress = state.progress, progress.total > 0 {
            return "\(progress.done)/\(progress.total) \(progress.label) complete"
        }
        if state.aggregate.runningSessions > 0 {
            return "\(state.aggregate.runningSessions) active session\(state.aggregate.runningSessions == 1 ? "" : "s")"
        }
        if renderedSessions.isEmpty {
            return "Waiting for Codex activity"
        }
        return "Recent Codex sessions"
    }

    private func sessionRows(for state: StatusState, now: Date) -> [RenderedSession] {
        state.sessions.values
            .sorted { lhs, rhs in
                rank(lhs) == rank(rhs) ? lhs.lastActivityAt > rhs.lastActivityAt : rank(lhs) < rank(rhs)
            }
            .prefix(6)
            .map { session in
                let name = session.displayName ?? "Codex"
                let status = statusLabel(session.status)
                let work = workSummary(for: session, now: now)
                let title = "\(name) - \(session.project) - \(work)"
                let detail = "\(status) - \(detail(for: session, now: now))"
                return RenderedSession(
                    id: session.id,
                    title: title,
                    detail: detail,
                    openURL: session.openURL,
                    needsAttention: session.approvalRequired
                )
            }
    }

    private func activeSession(from state: StatusState) -> SessionSummary? {
        state.sessions.values
            .filter { ["approval", "running", "thinking", "active", "goal", "compacting"].contains($0.status) }
            .sorted { $0.lastActivityAt > $1.lastActivityAt }
            .first
    }

    private func rank(_ session: SessionSummary) -> Int {
        if session.approvalRequired { return 0 }
        switch session.status {
        case "running", "thinking", "active", "goal", "compacting":
            return 1
        case "completed":
            return 2
        default:
            return 3
        }
    }

    private func workSummary(for session: SessionSummary, now: Date) -> String {
        if session.approvalRequired {
            return "approval needed"
        }
        if let progress = session.progress, progress.total > 0 {
            return "\(progress.done)/\(progress.total) \(progress.label)"
        }
        if let goal = session.goal {
            if goal.status == "complete" {
                return "goal complete"
            }
            if goal.status == "active" {
                return "goal active"
            }
            return "goal \(goal.status)"
        }
        if ["running", "thinking", "active", "goal", "compacting"].contains(session.status) {
            return duration(from: session.currentTurnStartedAt ?? session.startedAt, to: now)
        }
        return statusLabel(session.status).lowercased()
    }

    private func detail(for session: SessionSummary, now: Date) -> String {
        if let tool = session.currentTool, !tool.isEmpty {
            return tool
        }
        if let goal = session.goal, goal.status == "active" {
            return "goal running \(duration(seconds: goal.timeUsedSeconds))"
        }
        if let completedAt = session.completedAt {
            return "finished \(relativeTime(from: completedAt, to: now))"
        }
        return "updated \(relativeTime(from: session.lastActivityAt, to: now))"
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
        case "active":
            return "Active"
        case "goal":
            return "Goal"
        case "compacting":
            return "Compacting"
        case "completed":
            return "Done"
        case "idle":
            return "Idle"
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

    private func duration(seconds: Int) -> String {
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
