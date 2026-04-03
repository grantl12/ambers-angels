/**
 * Post-prebuild script: inject DJICameraPackage into MainApplication.kt
 *
 * EAS runs this after `expo prebuild` generates the android/ folder.
 * It patches MainApplication.kt to add DJICameraPackage to the packages list.
 *
 * Usage (via eas.json prebuildCommand or package.json postinstall):
 *   node modules/dji-camera/scripts/register-package.js
 */

const fs = require('fs')
const path = require('path')

const MAIN_APP_PATH = path.join(
  __dirname,
  '../../../android/app/src/main/java/com/ambersangels/app/MainApplication.kt',
)

const IMPORT_LINE = 'import com.ambersangels.djicamera.DJICameraPackage'
const PACKAGE_ENTRY = 'packages.add(DJICameraPackage())'

if (!fs.existsSync(MAIN_APP_PATH)) {
  console.log('[dji-camera] MainApplication.kt not found — skipping (run after prebuild)')
  process.exit(0)
}

let src = fs.readFileSync(MAIN_APP_PATH, 'utf8')

// Add import if missing
if (!src.includes(IMPORT_LINE)) {
  src = src.replace(
    /^(package .+\n)/m,
    `$1\n${IMPORT_LINE}\n`,
  )
}

// Add package entry inside getPackages() if missing
if (!src.includes(PACKAGE_ENTRY)) {
  src = src.replace(
    /override fun getPackages\(\)[^{]*\{[^}]*val packages = PackageList\(this\)\.packages/,
    (match) => match + `\n        ${PACKAGE_ENTRY}`,
  )
}

fs.writeFileSync(MAIN_APP_PATH, src, 'utf8')
console.log('[dji-camera] DJICameraPackage registered in MainApplication.kt')
