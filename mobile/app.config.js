// Dynamic config — reads secrets from environment variables.
// For EAS Build, set GOOGLE_MAPS_API_KEY as an EAS secret:
//   eas secret:create --scope project --name GOOGLE_MAPS_API_KEY --value <key>
// For local dev, set it in mobile/.env (which is gitignored).

const base = require("./app.json")

module.exports = {
  ...base,
  expo: {
    ...base.expo,
    android: {
      ...base.expo.android,
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
        },
      },
    },
  },
}
