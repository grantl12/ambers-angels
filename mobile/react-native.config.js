/**
 * Exclude local native modules from React Native autolinking.
 *
 * dji-camera and phone-camera are wired manually via their Expo config plugins
 * (settings.gradle subproject include + MainApplication.kt registration).
 * Autolinking must not also try to register them — that would cause double
 * registration and codegen failures on the new architecture.
 */
module.exports = {
  dependencies: {
    '@ambersangels/dji-camera':    { platforms: { android: null } },
    '@ambersangels/phone-camera':  { platforms: { android: null } },
  },
}
