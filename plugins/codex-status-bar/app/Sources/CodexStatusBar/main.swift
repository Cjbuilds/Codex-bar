import AppKit
import CodexStatusBarCore
import Foundation

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let formatter = StatusFormatter()
    private var timer: Timer?
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
        reload()

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
    }

    private func configureStatusItem() {
        statusItem.button?.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)
        statusItem.button?.imagePosition = .imageLeft
        statusItem.menu = NSMenu()
    }

    private func reload() {
        let state = try? StatusStateReader.read(from: stateURL)
        let rendered = formatter.render(state)
        statusItem.button?.title = rendered.title
        statusItem.button?.toolTip = rendered.tooltip
        statusItem.button?.contentTintColor = rendered.needsAttention ? NSColor.systemOrange : nil
        rebuildMenu(rendered)
    }

    private func rebuildMenu(_ rendered: RenderedStatus) {
        let menu = NSMenu()

        for (index, line) in rendered.menuLines.enumerated() {
            let item = NSMenuItem(title: line, action: nil, keyEquivalent: "")
            if index == 0 {
                item.attributedTitle = NSAttributedString(
                    string: line,
                    attributes: [.font: NSFont.systemFont(ofSize: 13, weight: .semibold)]
                )
            }
            menu.addItem(item)
        }

        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Open State Folder", action: #selector(openStateFolder), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Refresh", action: #selector(refreshNow), keyEquivalent: "r"))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Codex Status Bar", action: #selector(quit), keyEquivalent: "q"))

        for item in menu.items where item.action != nil {
            item.target = self
        }
        statusItem.menu = menu
    }

    @objc private func refreshNow() {
        reload()
    }

    @objc private func openStateFolder() {
        NSWorkspace.shared.activateFileViewerSelecting([stateURL])
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
