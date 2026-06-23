// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "CodexStatusBar",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "CodexStatusBar", targets: ["CodexStatusBar"]),
        .library(name: "CodexStatusBarCore", targets: ["CodexStatusBarCore"])
    ],
    targets: [
        .target(
            name: "CodexStatusBarCore"
        ),
        .executableTarget(
            name: "CodexStatusBar",
            dependencies: ["CodexStatusBarCore"],
            linkerSettings: [
                .linkedFramework("AppKit")
            ]
        ),
        .testTarget(
            name: "CodexStatusBarCoreTests",
            dependencies: ["CodexStatusBarCore"]
        )
    ]
)
