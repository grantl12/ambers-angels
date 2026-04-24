// Single source of truth for Expo config.
// EAS secrets needed:
//   eas secret:create --scope project --name GOOGLE_MAPS_API_KEY --value <key>
//   eas secret:create --scope project --name DJI_APP_KEY --value <key>
// For local dev, set these in mobile/.env (gitignored).

module.exports = {
  expo: {
    name: "Amber's Angels",
    slug: "ambers-angels",
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "dark",
    scheme: "ambersangels",

    // OTA updates via EAS Update — JS-only changes ship without a full rebuild.
    // runtimeVersion tied to appVersion so native builds only receive compatible JS.
    updates: {
      url: "https://u.expo.dev/4f470b02-19e3-47a7-9f48-663dc49603bd",
      enabled: true,
      fallbackToCacheTimeout: 0,
    },
    runtimeVersion: {
      policy: "appVersion",
    },

    icon: "./assets/icon.png",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#050a0f",
    },

    ios: {
      bundleIdentifier: "com.ambersangels.app",
      supportsTablet: false,
      usesAppleSignIn: true,
      icon: "./assets/icon.png",
      infoPlist: {
        // Camera + location permission strings
        NSCameraUsageDescription:
          "Camera is used to capture frames for license plate recognition.",
        NSLocationWhenInUseUsageDescription:
          "Location is used to tag detections and update your drone position on the mission map.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "Location is used in the background to keep your drone position live during a mission.",
        NSLocationAlwaysUsageDescription:
          "Location is used in the background to keep your drone position live during a mission.",

        // Required for iOS background location — without this iOS kills
        // the location subscription when the app is backgrounded, breaking
        // mission telemetry entirely.
        UIBackgroundModes: ["location", "fetch", "remote-notification"],

        // Apple compliance
        ITSAppUsesNonExemptEncryption: false,
      },
    },

    android: {
      package: "com.ambersangels.app",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#050a0f",
      },
      permissions: [
        "CAMERA",
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "FOREGROUND_SERVICE",
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.VIBRATE",
      ],
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
        },
      },
    },

    web: {
      favicon: "./assets/favicon.png",
    },

    notification: {
      icon: "./assets/icon.png",
      color: "#f59e0b",
      androidMode: "default",
    },

    plugins: [
      "expo-updates",
      "./plugins/withPrivacyManifest",
      "./modules/dji-camera/plugin",
      "./modules/phone-camera/plugin",
      [
        "expo-notifications",
        {
          icon: "./assets/icon.png",
          color: "#f59e0b",
          sounds: [],
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission:
            "Allow Amber's Angels to access your camera for license plate capture.",
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "Allow Amber's Angels to use your location during missions.",
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
        },
      ],
    ],

    extra: {
      eas: {
        projectId: "4f470b02-19e3-47a7-9f48-663dc49603bd",
      },
      googleIosClientId:     process.env.GOOGLE_IOS_CLIENT_ID     ?? "",
      googleAndroidClientId: process.env.GOOGLE_ANDROID_CLIENT_ID ?? "",
      googleWebClientId:     process.env.GOOGLE_WEB_CLIENT_ID     ?? "",
    },
    owner: "ambersangels",
  },
}
