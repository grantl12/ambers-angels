/**
 * Expo config plugin: injects PrivacyInfo.xcprivacy into the iOS bundle.
 * Required by Apple since May 2024 for apps using UserDefaults (AsyncStorage)
 * and file timestamp APIs. Without this, App Store submission will be rejected.
 *
 * Reason codes:
 *   CA92.1 — UserDefaults accessed to store user preferences (AsyncStorage)
 *   C617.1 — File timestamps accessed to manage local cache files
 */
const { withDangerousMod } = require("@expo/config-plugins")
const path = require("path")
const fs   = require("fs")

const PRIVACY_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSPrivacyAccessedAPITypes</key>
    <array>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <string>CA92.1</string>
            </array>
        </dict>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array>
                <string>C617.1</string>
            </array>
        </dict>
    </array>
    <key>NSPrivacyCollectedDataTypes</key>
    <array/>
    <key>NSPrivacyTracking</key>
    <false/>
</dict>
</plist>
`

module.exports = function withPrivacyManifest(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const iosDir  = path.join(cfg.modRequest.platformProjectRoot)
      const appDir  = path.join(iosDir, cfg.modRequest.projectName)
      const outPath = path.join(appDir, "PrivacyInfo.xcprivacy")
      fs.mkdirSync(appDir, { recursive: true })
      fs.writeFileSync(outPath, PRIVACY_MANIFEST, "utf8")
      return cfg
    },
  ])
}
