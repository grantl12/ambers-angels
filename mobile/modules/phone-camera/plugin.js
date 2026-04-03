/**
 * Expo config plugin for the phone-camera background scan module (Android only).
 *
 * What it does:
 *   1. Includes :phone-camera as a Gradle subproject in settings.gradle
 *   2. Adds implementation project(':phone-camera') to app/build.gradle
 *   3. Registers PhoneCameraPackage in MainApplication.kt
 *
 * Permissions (CAMERA, FOREGROUND_SERVICE, LOCATION, POST_NOTIFICATIONS) are
 * declared in the module's own AndroidManifest.xml and merged automatically.
 */

const { withAppBuildGradle, withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins')
const path = require('path')
const fs   = require('fs')

// ─── 1. Include :phone-camera subproject in settings.gradle ──────────────────
function withPhoneCameraSettings(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const settingsPath = path.join(
        config.modRequest.platformProjectRoot,
        'settings.gradle',
      )
      if (!fs.existsSync(settingsPath)) return config

      let src = fs.readFileSync(settingsPath, 'utf8')
      if (src.includes(':phone-camera')) return config   // already added

      src += `\ninclude ':phone-camera'\nproject(':phone-camera').projectDir = new File(rootProject.projectDir, '../modules/phone-camera/android')\n`
      fs.writeFileSync(settingsPath, src, 'utf8')
      console.log('[phone-camera] :phone-camera subproject added to settings.gradle')
      return config
    },
  ])
}

// ─── 2. Add project dependency to app/build.gradle ───────────────────────────
function withPhoneCameraAppGradle(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents

    if (gradle.includes("project(':phone-camera')")) return mod

    gradle = gradle.replace(
      /dependencies\s*\{/,
      `dependencies {\n    implementation project(':phone-camera')`,
    )
    mod.modResults.contents = gradle
    return mod
  })
}

// ─── 3. Register PhoneCameraPackage in MainApplication.kt ────────────────────
function withPhoneCameraPackageRegistration(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const mainAppPath = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/java/com/ambersangels/app/MainApplication.kt',
      )
      if (!fs.existsSync(mainAppPath)) {
        console.log('[phone-camera] MainApplication.kt not found — skipping')
        return config
      }

      let src = fs.readFileSync(mainAppPath, 'utf8')

      const IMPORT_LINE  = 'import com.ambersangels.phonecamera.PhoneCameraPackage'
      const PACKAGE_ENTRY = 'add(PhoneCameraPackage())'

      if (!src.includes(IMPORT_LINE)) {
        src = src.replace(/^(package .+\n)/m, `$1\n${IMPORT_LINE}\n`)
      }

      if (!src.includes(PACKAGE_ENTRY)) {
        src = src.replace(
          /PackageList\(this\)\.packages\.apply\s*\{/,
          (match) => match + `\n        ${PACKAGE_ENTRY}`,
        )
      }

      fs.writeFileSync(mainAppPath, src, 'utf8')
      console.log('[phone-camera] PhoneCameraPackage registered in MainApplication.kt')
      return config
    },
  ])
}

// ─── Compose ─────────────────────────────────────────────────────────────────
const withPhoneCamera = (config) => {
  config = withPhoneCameraSettings(config)
  config = withPhoneCameraAppGradle(config)
  config = withPhoneCameraPackageRegistration(config)
  return config
}

module.exports = createRunOncePlugin(withPhoneCamera, 'phone-camera', '1.0.0')
