/**
 * Expo config plugin for DJI MSDK V5 (Android only).
 *
 * What it does:
 *   1. Adds the DJI Maven artifact repository to android/build.gradle
 *   2. Includes :dji-camera as a Gradle subproject in settings.gradle
 *   3. Adds packagingOptions + project dependency to android/app/build.gradle
 *   4. Injects the DJI_APP_KEY meta-data into AndroidManifest.xml
 *   5. Registers DJICameraPackage in MainApplication.kt
 *
 * Set your DJI App Key via EAS secret:
 *   eas secret:create --scope project --name DJI_APP_KEY --value <key>
 * or locally in mobile/.env:
 *   DJI_APP_KEY=your_key_here
 */

const { withProjectBuildGradle, withAppBuildGradle, withAndroidManifest, withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins')
const path = require('path')
const fs = require('fs')

// ─── 1. DJI SDK V5 is on Maven Central — no custom repo needed ───────────────
// DJI migrated from artifact.bytedance.com to Maven Central (mavenCentral()).
// Expo's generated build.gradle already includes mavenCentral(), so this is a no-op.
function withDJIMavenRepo(config) {
  return withProjectBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents

    // Remove any stale ByteDance repo entry from previous versions of this plugin
    gradle = gradle.replace(
      /\s*maven\s*\{\s*url\s*['"]https:\/\/artifact\.bytedance\.com[^'"]*['"]\s*\}/g,
      '',
    )

    mod.modResults.contents = gradle
    return mod
  })
}

// ─── 2. Include :dji-camera as a Gradle subproject in settings.gradle ────────
function withDJISettings(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const settingsPath = path.join(
        config.modRequest.platformProjectRoot,
        'settings.gradle',
      )

      if (!fs.existsSync(settingsPath)) return config

      let src = fs.readFileSync(settingsPath, 'utf8')

      if (src.includes(':dji-camera')) return config  // already added

      src += `\ninclude ':dji-camera'\nproject(':dji-camera').projectDir = new File(rootProject.projectDir, '../modules/dji-camera/android')\n`
      fs.writeFileSync(settingsPath, src, 'utf8')
      console.log('[dji-camera] :dji-camera subproject added to settings.gradle')
      return config
    },
  ])
}

// ─── 3. Add packagingOptions + project dependency to app/build.gradle ────────
function withDJIAppGradle(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents

    if (gradle.includes("project(':dji-camera')")) return mod  // already added

    // Add packagingOptions inside android { } block
    gradle = gradle.replace(
      /android\s*\{/,
      `android {
    packagingOptions {
        pickFirst 'lib/armeabi-v7a/libcrypto.so'
        pickFirst 'lib/arm64-v8a/libcrypto.so'
        pickFirst 'lib/x86/libcrypto.so'
        pickFirst 'lib/x86_64/libcrypto.so'
        doNotStrip '*/*/libdjivideo.so'
        doNotStrip '*/*/libstaticlink.so'
        doNotStrip '*/*/libdji_innertools.so'
        doNotStrip '*/*/libdji_livelink.so'
        doNotStrip '*/*/libdji_mobile.so'
        doNotStrip '*/*/libdji_rtspeng.so'
        doNotStrip '*/*/libdji_codec_demo.so'
        doNotStrip '*/*/libRTSPClient.so'
        doNotStrip '*/*/libMediaInfoLib.so'
    }`,
    )

    // Add project dependency (the module's build.gradle declares the DJI SDK deps)
    gradle = gradle.replace(
      /dependencies\s*\{/,
      `dependencies {
    // DJI Camera local module (includes DJI MSDK V5)
    implementation project(':dji-camera')`,
    )

    mod.modResults.contents = gradle
    return mod
  })
}

// ─── 4. Inject DJI_APP_KEY into AndroidManifest.xml ─────────────────────────
function withDJIManifest(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults
    const appKey = process.env.DJI_APP_KEY ?? ''
    const mainApplication = manifest.manifest.application?.[0]
    if (!mainApplication) return mod

    // Remove existing entry if present
    const metaData = mainApplication['meta-data'] ?? []
    const filtered = metaData.filter(
      (m) => m.$?.['android:name'] !== 'com.dji.sdk.API_KEY',
    )

    filtered.push({
      $: {
        'android:name': 'com.dji.sdk.API_KEY',
        'android:value': appKey,
      },
    })

    // USB accessory filter for RC dongle
    filtered.push({
      $: {
        'android:name': 'android.hardware.usb.action.USB_ACCESSORY_ATTACHED',
      },
    })

    mainApplication['meta-data'] = filtered

    // Ensure USB host feature is declared
    if (!manifest.manifest['uses-feature']) {
      manifest.manifest['uses-feature'] = []
    }
    const features = manifest.manifest['uses-feature']
    if (!features.find((f) => f.$?.['android:name'] === 'android.hardware.usb.host')) {
      features.push({
        $: { 'android:name': 'android.hardware.usb.host', 'android:required': 'false' },
      })
    }

    return mod
  })
}

// ─── 5. Register DJICameraPackage in MainApplication.kt ─────────────────────
//
// EAS prebuild generates MainApplication.kt via autolinking. DJICameraPackage
// is a local module so we patch it in via withDangerousMod after prebuild.
function withDJIPackageRegistration(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const mainAppPath = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/java/com/ambersangels/app/MainApplication.kt',
      )

      if (!fs.existsSync(mainAppPath)) {
        console.log('[dji-camera] MainApplication.kt not found — skipping')
        return config
      }

      let src = fs.readFileSync(mainAppPath, 'utf8')

      const IMPORT_LINE = 'import com.ambersangels.djicamera.DJICameraPackage'
      const PACKAGE_ENTRY = 'add(DJICameraPackage())'

      if (!src.includes(IMPORT_LINE)) {
        src = src.replace(/^(package .+\n)/m, `$1\n${IMPORT_LINE}\n`)
      }

      if (!src.includes(PACKAGE_ENTRY)) {
        // Generated MainApplication.kt uses PackageList(this).packages.apply { ... }
        src = src.replace(
          /PackageList\(this\)\.packages\.apply\s*\{/,
          (match) => match + `\n        ${PACKAGE_ENTRY}`,
        )
      }

      fs.writeFileSync(mainAppPath, src, 'utf8')
      console.log('[dji-camera] DJICameraPackage registered in MainApplication.kt')
      return config
    },
  ])
}

// ─── Compose ─────────────────────────────────────────────────────────────────
const withDJICamera = (config) => {
  config = withDJIMavenRepo(config)
  config = withDJISettings(config)
  config = withDJIAppGradle(config)
  config = withDJIManifest(config)
  config = withDJIPackageRegistration(config)
  return config
}

module.exports = createRunOncePlugin(withDJICamera, 'dji-camera', '1.0.0')
