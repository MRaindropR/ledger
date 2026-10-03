#!/usr/bin/env bash
set -euo pipefail
export SMOKE_FIXTURE_DATE=$(date -u +%F)
mkdir -p build/simulator
xcodebuild -version > build/simulator/tools.log
xcrun simctl help launch >> build/simulator/tools.log
xcrun simctl list devices available --json > build/simulator/devices.json
device=$(node -e 'const data=require("./build/simulator/devices.json");const groups=Object.entries(data.devices).filter(([runtime])=>runtime.includes("iOS")).sort(([a],[b])=>b.localeCompare(a,undefined,{numeric:true}));for(const [,devices] of groups){const d=devices.find(x=>x.isAvailable&&x.name.startsWith("iPhone"));if(d){process.stdout.write(d.udid);process.exit(0);}}throw Error("No available iPhone simulator");')
printf '%s\n' "$device" > build/simulator/device-id.txt
cleanup() { xcrun simctl shutdown "$device" >/dev/null 2>&1 || true; }
trap cleanup EXIT
xcrun simctl boot "$device" || true
xcrun simctl bootstatus "$device" -b
npx expo prebuild --platform ios --no-install
(cd ios && pod install)
xcodebuild -workspace ios/SmartLedger.xcworkspace -scheme SmartLedger \
  -configuration Release -sdk iphonesimulator -destination "platform=iOS Simulator,id=$device" \
  -derivedDataPath "$PWD/build/simulator/DerivedData" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' \
  build | tee build/simulator/xcodebuild.log
app='build/simulator/DerivedData/Build/Products/Release-iphonesimulator/SmartLedger.app'
test -d "$app"
bundle='com.mraindropr.smartledger'
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")" = "$bundle"
xcrun simctl install "$device" "$app"
container=$(xcrun simctl get_app_container "$device" "$bundle" data)
# This is the installed CI app's own sandbox, never a developer/user data directory.
case "$container" in *CoreSimulator*Application*) ;; *) echo 'Unexpected simulator data path'; exit 1 ;; esac
mkdir -p "$container/Documents/SQLite"
database="$container/Documents/SQLite/smartledger.sqlite"
node scripts/simulator-fixture.cjs "$database"
xcrun swiftc scripts/verify-simulator-screen.swift -o build/simulator/verify-screen
for launch in first restart; do
  xcrun simctl launch --stdout="$PWD/build/simulator/$launch.stdout.log" \
    --stderr="$PWD/build/simulator/$launch.stderr.log" "$device" "$bundle" \
    | tee "build/simulator/$launch.launch.log"
  verified=false
  for attempt in {1..12}; do
    sleep 5
    xcrun simctl io "$device" screenshot "build/simulator/$launch.png"
    if build/simulator/verify-screen "build/simulator/$launch.png" > "build/simulator/$launch.ocr.txt" 2>&1; then
      verified=true
      break
    fi
  done
  if [ "$verified" != true ]; then
    cat "build/simulator/$launch.ocr.txt"
    xcrun simctl spawn "$device" log show --last 2m --predicate 'process == "SmartLedger"' > "build/simulator/$launch.system.log" || true
    echo 'Native dashboard did not render the seeded SQLite values'
    exit 1
  fi
  xcrun simctl terminate "$device" "$bundle"
  node scripts/simulator-fixture.cjs "$database" verify | tee "build/simulator/$launch.database.txt"
done
printf 'Release simulator launch, native SQLite migration/read and restart verified.\n' > build/simulator/result.txt
