/**
 * Expo config plugin for DJI MSDK V5 (Android only).
 *
 * What it does:
 *   1. Adds the DJI Maven artifact repository to android/build.gradle
 *   2. Adds DJI SDK dependencies + packagingOptions to android/app/build.gradle
 *   3. Injects the DJI_APP_KEY meta-data into AndroidManifest.xml
 *   4. Registers DJICameraPackage in MainApplication via react-native-community auto-linking shim
 *
 * Set your DJI App Key via EAS secret:
 *   eas secret:create --scope project --name DJI_APP_KEY --value <your_key>
 * or locally in mobile/.env:
 *   DJI_APP_KEY=your_key_here
 */

const { withProjectBuildGradle, withAppBuildGradle, withAndroidManifest, withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins')
const path = require('path')
const fs = require('fs')

// ─── 1. Add DJI Maven repo to root build.gradle ─────────────────────────────
function withDJIMavenRepo(config) {
  return withProjectBuildGradle(config, (mod) => {
    const gradle = mod.modResults.contents

    if (gradle.includes('artifact.bytedance.com')) return mod  // already added

    // Insert after allprojects { repositories { block
    mod.modResults.contents = gradle.replace(
      /allprojects\s*\{[\s\S]*?repositories\s*\{/,
      (match) =>
        match +
        `
        maven {
            url 'https://artifact.bytedance.com/repository/piper-releases/'
        }`,
    )
    return mod
  })
}

// ─── 2. Add DJI dependencies + packagingOptions to app/build.gradle ─────────
function withDJIAppGradle(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents

    if (gradle.includes('dji-sdk-v5-aircraft')) return mod  // already added

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

    // Add dependencies
    gradle = gradle.replace(
      /dependencies\s*\{/,
      `dependencies {
    // DJI Mobile SDK V5
    implementation 'com.dji:dji-sdk-v5-aircraft:5.10.0'
    implementation 'com.dji:dji-sdk-v5-networkImp:5.10.0'`,
    )

    mod.modResults.contents = gradle
    return mod
  })
}

// ─── 3. Inject DJI_APP_KEY into AndroidManifest.xml ─────────────────────────
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

// ─── 4. Register DJICameraPackage in MainApplication.kt ─────────────────────
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
      const PACKAGE_ENTRY = 'packages.add(DJICameraPackage())'

      if (!src.includes(IMPORT_LINE)) {
        src = src.replace(/^(package .+\n)/m, `$1\n${IMPORT_LINE}\n`)
      }

      if (!src.includes(PACKAGE_ENTRY)) {
        src = src.replace(
          /override fun getPackages\(\)[^{]*\{[^}]*val packages = PackageList\(this\)\.packages/,
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
  config = withDJIAppGradle(config)
  config = withDJIManifest(config)
  config = withDJIPackageRegistration(config)
  return config
}

module.exports = createRunOncePlugin(withDJICamera, 'dji-camera', '1.0.0')
