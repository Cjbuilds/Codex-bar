import AppKit
import CodexStatusBarCore
import Foundation

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let formatter = StatusFormatter()
    private var timer: Timer?
    private var collectorProcess: Process?
    private var lastStateFingerprint: String?
    private var stateURL: URL {
        if let override = ProcessInfo.processInfo.environment["CODEX_STATUS_BAR_STATE"], !override.isEmpty {
            return URL(fileURLWithPath: override)
        }
        return FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent(".codex/statusbar/state.json")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configureStatusItem()
        startCollector()
        reload(force: true)

        let timer = Timer(timeInterval: 1.0, repeats: true) { _ in
            Task { @MainActor [weak self] in
                self?.reload()
            }
        }
        timer.tolerance = 0.5
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        collectorProcess?.terminate()
    }

    private func configureStatusItem() {
        statusItem.button?.font = NSFont.menuBarFont(ofSize: 0)
        statusItem.button?.imagePosition = .imageLeft
        statusItem.menu = NSMenu()
    }

    private func startCollector() {
        let env = ProcessInfo.processInfo.environment
        if env["CODEX_STATUS_BAR_DISABLE_COLLECTOR"] == "1" {
            return
        }

        let collectorURL: URL?
        if let override = env["CODEX_STATUS_BAR_COLLECTOR"], !override.isEmpty {
            collectorURL = URL(fileURLWithPath: override)
        } else {
            collectorURL = Bundle.main.url(forResource: "collector", withExtension: "mjs")
        }
        guard let collectorURL else {
            return
        }

        var childEnv = env
        childEnv["CODEX_STATUS_BAR_STATE"] = stateURL.path
        childEnv["CODEX_STATUS_BAR_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", collectorURL.path, "--watch"]
        process.environment = childEnv

        do {
            try process.run()
            collectorProcess = process
        } catch {
            collectorProcess = nil
        }
    }

    private func reload(force: Bool = false) {
        let fingerprint = stateFingerprint()
        if !force, fingerprint == lastStateFingerprint {
            return
        }
        lastStateFingerprint = fingerprint

        let state = try? StatusStateReader.read(from: stateURL)
        let rendered = formatter.render(state)
        statusItem.button?.title = rendered.title
        statusItem.button?.toolTip = rendered.tooltip
        statusItem.button?.contentTintColor = rendered.needsAttention ? NSColor.systemOrange : nil
        rebuildMenu(rendered)
    }

    private func stateFingerprint() -> String {
        guard
            let attributes = try? FileManager.default.attributesOfItem(atPath: stateURL.path),
            let modifiedAt = attributes[.modificationDate] as? Date
        else {
            return "missing"
        }
        let size = attributes[.size] as? NSNumber
        return "\(modifiedAt.timeIntervalSince1970):\(size?.intValue ?? 0)"
    }

    private func rebuildMenu(_ rendered: RenderedStatus) {
        let menu = NSMenu()

        if let summary = rendered.menuLines.first {
            menu.addItem(headerItem(summary))
        }

        if !rendered.sessions.isEmpty {
            menu.addItem(.separator())
            for session in rendered.sessions {
                let item = NSMenuItem(title: session.title, action: #selector(openThread(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = session.openURL
                item.toolTip = session.detail
                if session.needsAttention {
                    item.attributedTitle = NSAttributedString(
                        string: session.title,
                        attributes: [
                            .font: NSFont.systemFont(ofSize: 13, weight: .semibold),
                            .foregroundColor: NSColor.systemOrange
                        ]
                    )
                }
                menu.addItem(item)
            }
        }

        let progressOffset = 1 + rendered.sessions.count
        let progressLines = rendered.menuLines.dropFirst(progressOffset)
        if !progressLines.isEmpty {
            menu.addItem(.separator())
            for line in progressLines {
                menu.addItem(NSMenuItem(title: line, action: nil, keyEquivalent: ""))
            }
        }

        menu.addItem(.separator())
        let openCodex = NSMenuItem(title: "Open Codex", action: #selector(openCodex), keyEquivalent: "")
        openCodex.target = self
        menu.addItem(openCodex)
        let quit = NSMenuItem(title: "Quit Codex Bar", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        statusItem.menu = menu
    }

    private func headerItem(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.attributedTitle = NSAttributedString(
            string: title,
            attributes: [.font: NSFont.systemFont(ofSize: 13, weight: .semibold)]
        )
        return item
    }

    @objc private func openThread(_ sender: NSMenuItem) {
        guard
            let raw = sender.representedObject as? String,
            let url = URL(string: raw)
        else {
            openCodex()
            return
        }
        NSWorkspace.shared.open(url)
    }

    @objc private func openCodex() {
        if let url = URL(string: "codex://threads/new") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
