import CodexStatusBarCore
import Foundation

struct Options {
    var statePath: String
    var now: Date
}

func parseOptions(_ arguments: [String]) throws -> Options {
    var statePath = FileManager.default
        .homeDirectoryForCurrentUser
        .appendingPathComponent(".codex/statusbar/state.json")
        .path
    var now = Date()
    var index = 0

    while index < arguments.count {
        let argument = arguments[index]
        switch argument {
        case "--state":
            index += 1
            guard index < arguments.count else {
                throw RenderError.message("--state requires a path")
            }
            statePath = arguments[index]
        case "--now":
            index += 1
            guard index < arguments.count else {
                throw RenderError.message("--now requires an ISO-8601 timestamp")
            }
            now = try parseDate(arguments[index])
        case "--help", "-h":
            printUsage()
            exit(0)
        default:
            throw RenderError.message("unknown option \(argument)")
        }
        index += 1
    }

    return Options(statePath: statePath, now: now)
}

func parseDate(_ value: String) throws -> Date {
    if let date = makeISO8601Formatter(fractionalSeconds: true).date(from: value) {
        return date
    }
    if let date = makeISO8601Formatter(fractionalSeconds: false).date(from: value) {
        return date
    }
    throw RenderError.message("invalid ISO-8601 timestamp \(value)")
}

func makeISO8601Formatter(fractionalSeconds: Bool) -> ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = fractionalSeconds
        ? [.withInternetDateTime, .withFractionalSeconds]
        : [.withInternetDateTime]
    return formatter
}

func printUsage() {
    print("Usage: CodexStatusBarRender [--state path/to/state.json] [--now 2026-06-23T18:00:00Z]")
}

enum RenderError: Error, CustomStringConvertible {
    case message(String)

    var description: String {
        switch self {
        case .message(let value):
            return value
        }
    }
}

do {
    let options = try parseOptions(Array(CommandLine.arguments.dropFirst()))
    let state = try StatusStateReader.read(from: URL(fileURLWithPath: options.statePath))
    let rendered = StatusFormatter().render(state, now: options.now)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(rendered)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    FileHandle.standardError.write(Data("CodexStatusBarRender failed: \(error)\n".utf8))
    exit(1)
}
