#!/usr/bin/env bash
# 새 노트북 완전 자동 셋업: 코드 clone → 백업 복원(키+클로드기록) → 의존성 설치 → 개발서버 실행.
#
# 사용법(둘 중 하나):
#   A) 한 줄 실행(추천):
#      curl -fsSL https://raw.githubusercontent.com/BioCode67/modoo-bom/main/scripts/setup-new-laptop.sh | bash
#   B) 이미 clone 했다면 레포 안에서:
#      bash scripts/setup-new-laptop.sh
#
# 사전: 구글드라이브의 백업(modoo-bom-handoff-*.tar.gz)을 Downloads에 다운로드해두면 키·클로드기록까지 복원됨.
#       (없어도 앱은 전 기능 동작 — 로그인·백엔드 RPA만 비활성)
set -uo pipefail
DEST="$HOME/Desktop/modoo-bom"

echo "🌱 모두봄 새 노트북 자동 셋업 (clone → 복원 → 설치 → 실행)"
echo ""

# 0) 필수 도구 확인
if ! command -v git >/dev/null 2>&1; then
  echo "❌ git이 없어요. 터미널에 'xcode-select --install' 실행 후 다시 시도하세요."; exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ node/npm이 없어요. https://nodejs.org 에서 LTS 버전 설치 후 다시 실행하세요."; exit 1
fi

# 1) 코드 clone (이미 있으면 최신화)
if [ -d "$DEST/.git" ]; then
  echo "✓ 이미 클론돼 있어요: $DEST"
  ( cd "$DEST" && git pull --ff-only 2>/dev/null || true )
else
  echo "📥 코드 내려받는 중..."
  git clone https://github.com/BioCode67/modoo-bom.git "$DEST" || { echo "❌ git clone 실패"; exit 1; }
fi
cd "$DEST"

# 2) 백업 복원 (비밀키 + 클로드 메모리/대화기록) — 백업 없으면 조용히 스킵
echo ""
echo "🔑 백업 복원 시도 (Downloads/Desktop의 modoo-bom-handoff-*.tar.gz)..."
bash scripts/restore-handoff.sh || echo "  ⚠️ 백업을 못 찾아 스킵했어요. 나중에 'bash scripts/restore-handoff.sh' 로 복원 가능(앱은 그대로 동작)."

# 3) 의존성 설치
echo ""
echo "📦 프론트엔드 의존성 설치 중 (npm install — 처음엔 1~2분 걸려요)..."
( cd frontend && npm install )

# 4) 개발 서버 실행 (종료는 Ctrl+C)
echo ""
echo "✅ 셋업 완료! 개발 서버를 시작합니다 → 브라우저에서 http://localhost:5173"
echo "   (서버 종료: Ctrl+C  ·  다시 실행: cd ~/Desktop/modoo-bom/frontend && npm run dev)"
echo ""
cd frontend && npm run dev
