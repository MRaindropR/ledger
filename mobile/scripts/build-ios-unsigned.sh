#!/usr/bin/env bash
set -euo pipefail
# A real-device build, deliberately unsigned. Final signing takes place on the user's computer.
npx expo prebuild --platform ios --no-install
(cd ios && pod install)
mkdir -p build
xcodebuild -workspace ios/SmartLedger.xcworkspace -scheme SmartLedger \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -archivePath "$PWD/build/SmartLedger.xcarchive" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' \
  archive | tee build/xcodebuild.log
app='build/SmartLedger.xcarchive/Products/Applications/SmartLedger.app'
test -d "$app"
lipo -archs "$app/SmartLedger" | grep -q arm64
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")" = 'com.mraindropr.smartledger'
mkdir -p build/Payload
cp -R "$app" build/Payload/
(cd build && zip -qry SmartLedger-unsigned.ipa Payload)
shasum -a 256 build/SmartLedger-unsigned.ipa > build/SmartLedger-unsigned.ipa.sha256
