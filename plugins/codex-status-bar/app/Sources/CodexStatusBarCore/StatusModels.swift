import Foundation

public struct StatusState: Codable, Equatable {
    public var version: Int
    public var installId: String
    public var updatedAt: Date
    public var attention: String?
    public var headline: String
    public var detail: String
    public var current: CurrentActivity
    public var progress: ProgressSummary?
    public var aggregate: AggregateSummary
    public var sessions: [String: SessionSummary]
}

public struct CurrentActivity: Codable, Equatable {
    public var status: String
    public var event: String?
    public var toolName: String?
    public var startedAt: Date?
}

public struct ProgressSummary: Codable, Equatable {
    public var label: String
    public var done: Int
    public var total: Int
    public var items: [ProgressItem]
    public var source: String?
}

public struct ProgressItem: Codable, Equatable {
    public var step: String
    public var status: String
}

public struct AggregateSummary: Codable, Equatable {
    public var runningSessions: Int
    public var completedSessions: Int
    public var approvalsRequired: Int
    public var totalToolCalls: Int
    public var activeSince: Date?
}

public struct SessionSummary: Codable, Equatable {
    public var id: String
    public var threadId: String?
    public var shortId: String?
    public var displayName: String?
    public var label: String?
    public var labelSource: String?
    public var openURL: String?
    public var cwd: String
    public var project: String
    public var model: String?
    public var status: String
    public var startedAt: Date
    public var updatedAt: Date
    public var lastActivityAt: Date
    public var completedAt: Date?
    public var currentTurnStartedAt: Date?
    public var currentTool: String?
    public var lastEvent: String?
    public var approvalRequired: Bool
    public var turnsStarted: Int
    public var turnsCompleted: Int
    public var toolCallsStarted: Int
    public var toolCallsCompleted: Int
    public var progress: ProgressSummary?
    public var goal: GoalSummary?
    public var stale: Bool?

    public init(
        id: String,
        threadId: String? = nil,
        shortId: String? = nil,
        displayName: String? = nil,
        label: String? = nil,
        labelSource: String? = nil,
        openURL: String? = nil,
        cwd: String,
        project: String,
        model: String?,
        status: String,
        startedAt: Date,
        updatedAt: Date,
        lastActivityAt: Date,
        completedAt: Date?,
        currentTurnStartedAt: Date?,
        currentTool: String?,
        lastEvent: String?,
        approvalRequired: Bool,
        turnsStarted: Int,
        turnsCompleted: Int,
        toolCallsStarted: Int,
        toolCallsCompleted: Int,
        progress: ProgressSummary? = nil,
        goal: GoalSummary? = nil,
        stale: Bool? = nil
    ) {
        self.id = id
        self.threadId = threadId
        self.shortId = shortId
        self.displayName = displayName
        self.label = label
        self.labelSource = labelSource
        self.openURL = openURL
        self.cwd = cwd
        self.project = project
        self.model = model
        self.status = status
        self.startedAt = startedAt
        self.updatedAt = updatedAt
        self.lastActivityAt = lastActivityAt
        self.completedAt = completedAt
        self.currentTurnStartedAt = currentTurnStartedAt
        self.currentTool = currentTool
        self.lastEvent = lastEvent
        self.approvalRequired = approvalRequired
        self.turnsStarted = turnsStarted
        self.turnsCompleted = turnsCompleted
        self.toolCallsStarted = toolCallsStarted
        self.toolCallsCompleted = toolCallsCompleted
        self.progress = progress
        self.goal = goal
        self.stale = stale
    }
}

public struct GoalSummary: Codable, Equatable {
    public var status: String
    public var tokenBudget: Int?
    public var tokensUsed: Int
    public var timeUsedSeconds: Int
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        status: String,
        tokenBudget: Int?,
        tokensUsed: Int,
        timeUsedSeconds: Int,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.status = status
        self.tokenBudget = tokenBudget
        self.tokensUsed = tokensUsed
        self.timeUsedSeconds = timeUsedSeconds
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public enum StatusStateReader {
    public static func read(from url: URL) throws -> StatusState {
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = makeISO8601Formatter(fractionalSeconds: true).date(from: value) {
                return date
            }
            if let date = makeISO8601Formatter(fractionalSeconds: false).date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO-8601 date: \(value)"
            )
        }
        return try decoder.decode(StatusState.self, from: data)
    }
}

private func makeISO8601Formatter(fractionalSeconds: Bool) -> ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = fractionalSeconds
        ? [.withInternetDateTime, .withFractionalSeconds]
        : [.withInternetDateTime]
    return formatter
}
