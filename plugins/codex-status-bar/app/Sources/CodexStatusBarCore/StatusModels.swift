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
