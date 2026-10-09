#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! xcodebuild -version >/dev/null 2>&1 || ! xcrun --sdk iphoneos --show-sdk-path >/dev/null 2>&1; then
  echo '需要已安装并选中的完整 Xcode 与 iPhoneOS SDK。当前未产生 .app、IPA 或 DEB。' >&2
  exit 2
fi
if [ ! -f App/Web/app.js ] || [ ! -f web-snapshot.json ]; then
  echo '请先使用 scripts/sync-web.py 同步最终网页资源。' >&2
  exit 3
fi
xcodebuild -project Yubenzhe.xcodeproj -scheme Yubenzhe -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath build/DerivedData \
  CODE_SIGNING_ALLOWED=NO build
printf '%s\n' '已编译未签名设备应用：build/DerivedData/Build/Products/Release-iphoneos/Yubenzhe.app'
printf '%s\n' '尚不可在未越狱 iPhone 安装。请按 README 选择越狱 ad-hoc 签名或正式开发者签名。'
