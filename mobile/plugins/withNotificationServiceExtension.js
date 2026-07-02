/**
 * Expo config plugin: adds a Notification Service Extension (NSE) to the iOS build.
 *
 * The NSE intercepts push notifications before display and downloads the
 * vehicleImageUrl from the notification payload, attaching it as a banner
 * image. Without this, iOS cannot show images in push notification banners.
 *
 * Requires mutableContent: true in the Expo push message (set in fema_connector.py).
 */

const { withXcodeProject, withDangerousMod } = require("@expo/config-plugins")
const path = require("path")
const fs = require("fs")

const NSE_TARGET = "NotificationServiceExtension"

const SWIFT_SOURCE = `import UserNotifications

class NotificationService: UNNotificationServiceExtension {
    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent

        guard
            let content = bestAttemptContent,
            // Expo promotes data keys to top-level in the APNs payload
            let urlString = content.userInfo["vehicleImageUrl"] as? String,
            let url = URL(string: urlString)
        else {
            contentHandler(request.content)
            return
        }

        URLSession.shared.downloadTask(with: url) { [weak self] location, _, _ in
            guard let self, let location else {
                contentHandler(request.content)
                return
            }
            let tmp = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension("jpg")
            do {
                try FileManager.default.moveItem(at: location, to: tmp)
                let attachment = try UNNotificationAttachment(identifier: "vehicle", url: tmp)
                content.attachments = [attachment]
            } catch {}
            contentHandler(content)
        }.resume()
    }

    override func serviceExtensionTimeWillExpire() {
        if let handler = contentHandler, let content = bestAttemptContent {
            handler(content)
        }
    }
}
`

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.usernotifications.service</string>
        <key>NSExtensionPrincipalClass</key>
        <string>$(PRODUCT_MODULE_NAME).NotificationService</string>
    </dict>
</dict>
</plist>
`

// Xcode 14+ signs resource bundle targets by default, which breaks builds when
// those bundles don't have a development team. Patch the generated Podfile to
// opt resource bundle targets out of code signing.
function withPodfileResourceBundleFix(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfilePath = require("path").join(cfg.modRequest.platformProjectRoot, "Podfile")
      let podfile = require("fs").readFileSync(podfilePath, "utf8")

      const fix = `
  installer.pods_project.targets.each do |target|
    if target.respond_to?(:product_type) && target.product_type == "com.apple.product-type.bundle"
      target.build_configurations.each do |config|
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
      end
    end
  end
`
      // Append inside the existing post_install block that Expo always generates
      if (!podfile.includes("CODE_SIGNING_ALLOWED")) {
        podfile = podfile.replace(
          /^(post_install do \|installer\|)/m,
          `$1\n${fix}`
        )
        require("fs").writeFileSync(podfilePath, podfile, "utf8")
      }
      return cfg
    },
  ])
}

// Write Swift source + Info.plist into the ios/ project directory during pre-build
function withNSEFiles(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const nseDir = path.join(cfg.modRequest.platformProjectRoot, NSE_TARGET)
      fs.mkdirSync(nseDir, { recursive: true })
      fs.writeFileSync(path.join(nseDir, "NotificationService.swift"), SWIFT_SOURCE, "utf8")
      fs.writeFileSync(path.join(nseDir, "Info.plist"), INFO_PLIST, "utf8")
      return cfg
    },
  ])
}

// Add the NSE target to the Xcode project
function withNSETarget(config) {
  return withXcodeProject(config, (cfg) => {
    const proj = cfg.modResults
    const bundleId = cfg.ios.bundleIdentifier
    const nseBundleId = `${bundleId}.${NSE_TARGET}`
    const deploymentTarget = cfg.ios.deploymentTarget || "15.1"

    // Idempotent — skip if already added
    if (proj.pbxTargetByName(NSE_TARGET)) return cfg

    // Snapshot XCBuildConfiguration UUIDs BEFORE addTarget so we can diff
    // afterwards to find exactly which configs belong to the new NSE target.
    const objects = proj.hash.project.objects
    const buildConfigs = objects["XCBuildConfiguration"] || {}
    const beforeUuids = new Set(
      Object.keys(buildConfigs).filter((k) => !k.endsWith("_comment"))
    )

    // Create the extension target
    const target = proj.addTarget(NSE_TARGET, "app_extension", NSE_TARGET)

    // Build phases
    proj.addBuildPhase(
      ["NotificationService.swift"],
      "PBXSourcesBuildPhase",
      "Sources",
      target.uuid
    )
    proj.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid)
    proj.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid)

    // File group in the Xcode navigator
    const groupResult = proj.addPbxGroup(
      ["NotificationService.swift", "Info.plist"],
      NSE_TARGET,
      NSE_TARGET
    )
    const mainGroupKey = proj.findPBXGroupKey({ name: cfg.modRequest.projectName })
    if (mainGroupKey && groupResult?.uuid) {
      proj.addToPbxGroup(groupResult.uuid, mainGroupKey)
    }

    // Diff: new UUIDs added by addTarget are the NSE's Debug + Release configs
    const nseConfigUuids = Object.keys(buildConfigs).filter(
      (k) => !k.endsWith("_comment") && !beforeUuids.has(k)
    )

    for (const uuid of nseConfigUuids) {
      if (buildConfigs[uuid]?.buildSettings !== undefined) {
        Object.assign(buildConfigs[uuid].buildSettings, {
          CODE_SIGN_STYLE: "Automatic",
          INFOPLIST_FILE: `${NSE_TARGET}/Info.plist`,
          IPHONEOS_DEPLOYMENT_TARGET: deploymentTarget,
          PRODUCT_BUNDLE_IDENTIFIER: nseBundleId,
          SKIP_INSTALL: "YES",
          SWIFT_VERSION: "5.0",
          TARGETED_DEVICE_FAMILY: '"1,2"',
        })
      }
    }

    return cfg
  })
}

module.exports = function withNotificationServiceExtension(config) {
  config = withNSEFiles(config)
  config = withNSETarget(config)
  config = withPodfileResourceBundleFix(config)
  return config
}
