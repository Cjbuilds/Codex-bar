import AppKit
import CodexStatusBarCore
import Foundation

struct Options {
    var statePath: String
    var outputPath: String
    var now: Date
}

struct SnapshotReport: Codable {
    var output: String
    var width: Int
    var height: Int
    var fileSize: Int
    var nonBackgroundPixels: Int
    var title: String
    var needsAttention: Bool
    var menuLines: [String]
    var sessions: [RenderedSession]
}

enum SnapshotError: Error, CustomStringConvertible {
    case message(String)

    var description: String {
        switch self {
        case .message(let value):
            return value
        }
    }
}

func parseOptions(_ arguments: [String]) throws -> Options {
    var statePath = FileManager.default
        .homeDirectoryForCurrentUser
        .appendingPathComponent(".codex/statusbar/state.json")
        .path
    var outputPath: String?
    var now = Date()
    var index = 0

    while index < arguments.count {
        let argument = arguments[index]
        switch argument {
        case "--state":
            index += 1
            guard index < arguments.count else {
                throw SnapshotError.message("--state requires a path")
            }
            statePath = arguments[index]
        case "--output":
            index += 1
            guard index < arguments.count else {
                throw SnapshotError.message("--output requires a path")
            }
            outputPath = arguments[index]
        case "--now":
            index += 1
            guard index < arguments.count else {
                throw SnapshotError.message("--now requires an ISO-8601 timestamp")
            }
            now = try parseDate(arguments[index])
        case "--help", "-h":
            printUsage()
            exit(0)
        default:
            throw SnapshotError.message("unknown option \(argument)")
        }
        index += 1
    }

    guard let outputPath else {
        throw SnapshotError.message("--output is required")
    }

    return Options(statePath: statePath, outputPath: outputPath, now: now)
}

func parseDate(_ value: String) throws -> Date {
    if let date = makeISO8601Formatter(fractionalSeconds: true).date(from: value) {
        return date
    }
    if let date = makeISO8601Formatter(fractionalSeconds: false).date(from: value) {
        return date
    }
    throw SnapshotError.message("invalid ISO-8601 timestamp \(value)")
}

func makeISO8601Formatter(fractionalSeconds: Bool) -> ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = fractionalSeconds
        ? [.withInternetDateTime, .withFractionalSeconds]
        : [.withInternetDateTime]
    return formatter
}

func printUsage() {
    print("Usage: CodexStatusBarSnapshot --output dist/snapshots/progress.png [--state path/to/state.json] [--now 2026-06-23T18:00:00Z]")
}

func clipped(_ value: String, maxLength: Int) -> String {
    if value.count <= maxLength {
        return value
    }
    let end = value.index(value.startIndex, offsetBy: max(0, maxLength - 3))
    return "\(value[..<end])..."
}

func drawText(_ value: String, in rect: NSRect, attributes: [NSAttributedString.Key: Any]) {
    NSString(string: value).draw(in: rect, withAttributes: attributes)
}

func fillRounded(_ rect: NSRect, radius: CGFloat, color: NSColor) {
    color.setFill()
    NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
}

func fillRect(_ rect: NSRect, color: NSColor) {
    color.setFill()
    rect.fill()
}

func strokeLine(from start: NSPoint, to end: NSPoint, color: NSColor) {
    color.setStroke()
    let path = NSBezierPath()
    path.move(to: start)
    path.line(to: end)
    path.lineWidth = 1
    path.stroke()
}

func drawSnapshot(rendered: RenderedStatus, outputPath: String) throws -> SnapshotReport {
    let width = 820
    let progressLines = Array(rendered.menuLines.dropFirst(1 + rendered.sessions.count))
    let contentHeight = 178 + (max(rendered.sessions.count, 1) * 44) + (progressLines.count * 28) + 116
    let height = max(430, min(860, contentHeight))
    let background = NSColor(calibratedRed: 248 / 255, green: 250 / 255, blue: 252 / 255, alpha: 1)

    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width,
        pixelsHigh: height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw SnapshotError.message("could not allocate snapshot bitmap")
    }
    bitmap.size = NSSize(width: width, height: height)

    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw SnapshotError.message("could not create snapshot graphics context")
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context

    let page = NSRect(x: 0, y: 0, width: width, height: height)
    fillRect(page, color: background)

    let text = NSColor(calibratedRed: 15 / 255, green: 23 / 255, blue: 42 / 255, alpha: 1)
    let muted = NSColor(calibratedRed: 71 / 255, green: 85 / 255, blue: 105 / 255, alpha: 1)
    let line = NSColor(calibratedRed: 203 / 255, green: 213 / 255, blue: 225 / 255, alpha: 1)
    let softLine = NSColor(calibratedRed: 226 / 255, green: 232 / 255, blue: 240 / 255, alpha: 1)
    let accent = rendered.needsAttention ? NSColor.systemOrange : NSColor.systemTeal

    let barY = CGFloat(height - 56)
    fillRect(NSRect(x: 54, y: barY, width: 712, height: 46), color: .white)
    strokeLine(from: NSPoint(x: 54, y: barY), to: NSPoint(x: 766, y: barY), color: line)
    drawText("Finder", in: NSRect(x: 76, y: barY + 14, width: 74, height: 18), attributes: [
        .font: NSFont.menuBarFont(ofSize: 0),
        .foregroundColor: text
    ])
    drawText("File", in: NSRect(x: 158, y: barY + 14, width: 54, height: 18), attributes: [
        .font: NSFont.menuBarFont(ofSize: 0),
        .foregroundColor: text
    ])
    fillRounded(NSRect(x: 522, y: barY + 8, width: 160, height: 30), radius: 6, color: NSColor(calibratedRed: 226 / 255, green: 232 / 255, blue: 240 / 255, alpha: 1))
    drawText(rendered.title, in: NSRect(x: 538, y: barY + 15, width: 132, height: 18), attributes: [
        .font: NSFont.menuBarFont(ofSize: 0),
        .foregroundColor: rendered.needsAttention ? NSColor.systemOrange : text
    ])

    let panelY = CGFloat(44)
    let panelHeight = CGFloat(height - 122)
    fillRounded(NSRect(x: 54, y: panelY, width: 712, height: panelHeight), radius: 8, color: .white)
    NSColor(calibratedRed: 203 / 255, green: 213 / 255, blue: 225 / 255, alpha: 1).setStroke()
    NSBezierPath(roundedRect: NSRect(x: 54, y: panelY, width: 712, height: panelHeight), xRadius: 8, yRadius: 8).stroke()

    let top = panelY + panelHeight
    let header = rendered.menuLines.first ?? "Waiting for Codex activity"
    drawText(header, in: NSRect(x: 78, y: top - 48, width: 640, height: 24), attributes: [
        .font: NSFont.systemFont(ofSize: 15, weight: .semibold),
        .foregroundColor: text
    ])
    strokeLine(from: NSPoint(x: 78, y: top - 62), to: NSPoint(x: 742, y: top - 62), color: softLine)

    var y = top - 104
    let statusFont = NSFont.systemFont(ofSize: 12, weight: .semibold)
    for session in rendered.sessions {
        let parts = session.title.components(separatedBy: " · ")
        let name = parts.indices.contains(0) ? parts[0] : session.title
        let project = parts.indices.contains(1) ? parts[1] : ""
        let label = parts.indices.contains(2) ? parts[2] : ""
        let work = parts.indices.contains(3) ? parts[3] : ""
        drawText(name, in: NSRect(x: 78, y: y, width: 80, height: 20), attributes: [
            .font: NSFont.systemFont(ofSize: 14, weight: .semibold),
            .foregroundColor: session.needsAttention ? NSColor.systemOrange : text
        ])
        drawText(project, in: NSRect(x: 164, y: y, width: 142, height: 20), attributes: [
            .font: NSFont.systemFont(ofSize: 13),
            .foregroundColor: muted
        ])
        drawText(clipped(label, maxLength: 34), in: NSRect(x: 318, y: y, width: 216, height: 20), attributes: [
            .font: NSFont.systemFont(ofSize: 13),
            .foregroundColor: muted
        ])
        fillRounded(NSRect(x: 596, y: y - 2, width: 112, height: 24), radius: 6, color: accent.withAlphaComponent(0.13))
        drawText(clipped(work, maxLength: 16), in: NSRect(x: 608, y: y + 4, width: 88, height: 14), attributes: [
            .font: statusFont,
            .foregroundColor: accent
        ])
        y -= 44
    }

    strokeLine(from: NSPoint(x: 78, y: y + 14), to: NSPoint(x: 742, y: y + 14), color: softLine)
    y -= 16
    for progress in progressLines.prefix(6) {
        drawText(progress, in: NSRect(x: 84, y: y, width: 612, height: 20), attributes: [
            .font: NSFont.systemFont(ofSize: 13),
            .foregroundColor: text
        ])
        y -= 28
    }

    strokeLine(from: NSPoint(x: 78, y: panelY + 58), to: NSPoint(x: 742, y: panelY + 58), color: softLine)
    drawText("Open Codex", in: NSRect(x: 78, y: panelY + 34, width: 180, height: 18), attributes: [
        .font: NSFont.systemFont(ofSize: 13),
        .foregroundColor: text
    ])
    drawText("Quit Codex Bar", in: NSRect(x: 78, y: panelY + 12, width: 180, height: 18), attributes: [
        .font: NSFont.systemFont(ofSize: 13),
        .foregroundColor: text
    ])

    NSGraphicsContext.restoreGraphicsState()

    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw SnapshotError.message("could not encode snapshot PNG")
    }

    let outputURL = URL(fileURLWithPath: outputPath)
    try FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    try png.write(to: outputURL)

    let fileSize = try FileManager.default
        .attributesOfItem(atPath: outputURL.path)[.size] as? NSNumber
    let nonBackgroundPixels = countNonBackgroundPixels(bitmap, background: background)

    return SnapshotReport(
        output: outputURL.path,
        width: width,
        height: height,
        fileSize: fileSize?.intValue ?? png.count,
        nonBackgroundPixels: nonBackgroundPixels,
        title: rendered.title,
        needsAttention: rendered.needsAttention,
        menuLines: rendered.menuLines,
        sessions: rendered.sessions
    )
}

func countNonBackgroundPixels(_ bitmap: NSBitmapImageRep, background: NSColor) -> Int {
    var bgR: CGFloat = 0
    var bgG: CGFloat = 0
    var bgB: CGFloat = 0
    var bgA: CGFloat = 0
    background.usingColorSpace(.deviceRGB)?.getRed(&bgR, green: &bgG, blue: &bgB, alpha: &bgA)

    var count = 0
    for y in 0..<bitmap.pixelsHigh {
        for x in 0..<bitmap.pixelsWide {
            guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else {
                continue
            }
            var r: CGFloat = 0
            var g: CGFloat = 0
            var b: CGFloat = 0
            var a: CGFloat = 0
            color.getRed(&r, green: &g, blue: &b, alpha: &a)
            let delta = abs(r - bgR) + abs(g - bgG) + abs(b - bgB)
            if a > 0.5 && delta > 0.05 {
                count += 1
            }
        }
    }
    return count
}

do {
    let options = try parseOptions(Array(CommandLine.arguments.dropFirst()))
    let state = try StatusStateReader.read(from: URL(fileURLWithPath: options.statePath))
    let rendered = StatusFormatter().render(state, now: options.now)
    let report = try drawSnapshot(rendered: rendered, outputPath: options.outputPath)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(report)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    FileHandle.standardError.write(Data("CodexStatusBarSnapshot failed: \(error)\n".utf8))
    exit(1)
}
