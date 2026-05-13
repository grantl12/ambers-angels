# App Store Screenshots

5 screenshots designed at **1320 × 2868 px** (iPhone 16 Pro Max — the required size for App Store Connect).

| File | Screen | Caption |
|------|--------|---------|
| 01-map.html | Live Mission Map | "Track every volunteer in real time" |
| 02-camera.html | Camera / Active Scanning | "Scan license plates from the sky" |
| 03-feed.html | Detection Feed | "Every scan. Every hit. Instantly." |
| 04-login.html | Login / Branding | Alert types + stats |
| 05-alerts.html | Alert Types Overview | "Instant alerts. Every case type." |

## How to export as PNG

1. Open a file in **Chrome**
2. Open DevTools (`F12`)
3. Click the **Toggle device toolbar** icon (or `Ctrl+Shift+M`)
4. In the dimensions dropdown, choose **Edit…** → add a custom device:
   - Width: `1320`
   - Height: `2868`
   - Device pixel ratio: `1`
5. Select that device
6. Click the **⋮ menu** in the DevTools toolbar → **Capture screenshot**
7. Chrome saves the PNG at exactly 1320×2868

Repeat for all 5 files. Upload them in order to App Store Connect under the 6.9" display section.

## App Store Connect notes

- These cover the **6.9" display** requirement (mandatory)
- Apple will auto-scale them for 6.5" and 5.5" if you don't provide those separately
- No iPad screenshots needed (`supportsTablet: false` in app.config.js)
- You need at least 1 screenshot; Apple recommends 3–5
