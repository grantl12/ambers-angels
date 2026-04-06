#!/usr/bin/env bash
# Run this before every EAS build to catch issues locally.
# Usage: bash scripts/preflight.sh [android|ios|all]
set -euo pipefail
cd "$(dirname "$0")/.."

PLATFORM="${1:-all}"
PASS=0; FAIL=0

check() {
  local desc="$1"; local result="$2"
  if [ "$result" = "ok" ]; then
    echo "  ✅  $desc"; PASS=$((PASS+1))
  else
    echo "  ❌  $desc — $result"; FAIL=$((FAIL+1))
  fi
}

# ── Assets ──────────────────────────────────────────────────────────────────
echo "── Assets ──"
for f in assets/icon.png assets/adaptive-icon.png assets/splash.png assets/favicon.png; do
  [ -f "$f" ] && check "$f" "ok" || check "$f" "MISSING"
done

echo ""
echo "── Config plugins ──"
for f in plugins/withPrivacyManifest.js modules/dji-camera/plugin.js modules/phone-camera/plugin.js; do
  [ -f "$f" ] && check "$f" "ok" || check "$f" "MISSING"
done

# ── Prebuild dry-run ─────────────────────────────────────────────────────────
echo ""
echo "── Prebuild (${PLATFORM}) ──"
if [[ "$PLATFORM" == "android" || "$PLATFORM" == "all" ]]; then
  if npx expo prebuild --platform android --clean 2>&1 | grep -q "Finished prebuild"; then
    check "Android prebuild" "ok"
  else
    check "Android prebuild" "FAILED — run manually for details"
  fi
fi

if [[ "$PLATFORM" == "ios" || "$PLATFORM" == "all" ]]; then
  if npx expo prebuild --platform ios --clean 2>&1 | grep -q "Finished prebuild"; then
    check "iOS prebuild" "ok"
  else
    check "iOS prebuild" "FAILED — run manually for details"
  fi
fi

# ── Git state ───────────────────────────────────────────────────────────────
echo ""
echo "── Git ──"
UNCOMMITTED=$(git status --porcelain | wc -l | tr -d ' ')
[ "$UNCOMMITTED" = "0" ] \
  && check "Working tree clean" "ok" \
  || check "Working tree" "${UNCOMMITTED} uncommitted file(s) — EAS builds from HEAD"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────"
echo "  ${PASS} passed   ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  echo "  Fix failures before queueing a build."
  exit 1
else
  echo "  OK to queue."
fi
