#!/usr/bin/env bash
# OG 공유 이미지 & PWA 아이콘 재생성 스크립트 (macOS 전용)
#
# 입력 소스:
#   - public/favicon.svg : 새싹 마스코트 마크 (PWA 아이콘 원본)
#   - scripts/og.svg      : OG 공유 카드 (마스코트 + 카피)
# 출력:
#   - public/og.png            (1200x1200, 공유 미리보기)
#   - public/pwa-512x512.png   (PWA 아이콘)
#   - public/pwa-192x192.png   (PWA 아이콘)
#   - public/apple-touch-icon.png (iOS 홈화면)
#
# 의존성: macOS 기본 도구 qlmanage(QuickLook), sips. 별도 설치 불필요.
# 사용:  bash scripts/gen-assets.sh   (frontend/ 에서 실행)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ OG 이미지 생성 (scripts/og.svg → public/og.png, 1200x1200)"
rm -f public/og.png public/og.svg.png
qlmanage -t -s 1200 -o public scripts/og.svg >/dev/null 2>&1
mv public/og.svg.png public/og.png

echo "▸ PWA 아이콘 생성 (public/favicon.svg → 512/192/180)"
rm -f public/pwa-512x512.png public/pwa-192x192.png public/apple-touch-icon.png public/favicon.svg.png
qlmanage -t -s 512 -o public public/favicon.svg >/dev/null 2>&1
mv public/favicon.svg.png public/pwa-512x512.png
cp public/pwa-512x512.png public/pwa-192x192.png && sips -z 192 192 public/pwa-192x192.png >/dev/null
cp public/pwa-512x512.png public/apple-touch-icon.png && sips -z 180 180 public/apple-touch-icon.png >/dev/null

echo "✅ 완료:"
ls -la public/og.png public/pwa-512x512.png public/pwa-192x192.png public/apple-touch-icon.png | awk '{print "   "$5"\t"$9}'
