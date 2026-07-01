#!/usr/bin/env bash
# 새 노트북에서 인수인계 백업을 '한 번에' 복원한다.
# 사용법:
#   1) 이 레포를 git clone
#   2) 구글드라이브 등에서 modoo-bom-handoff-*.tar.gz 를 Downloads(또는 Desktop)에 다운로드
#   3) 레포 안에서:  bash scripts/restore-handoff.sh
#      (백업 경로를 직접 줄 수도 있음:  bash scripts/restore-handoff.sh ~/어디/파일.tar.gz)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "🧳 모두봄 인수인계 자동 복원"
echo ""

# 1) 백업 파일 찾기 (인자 우선, 없으면 Downloads/Desktop 자동 탐색)
ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ]; then
  ARCHIVE="$(ls -t "$HOME"/Downloads/modoo-bom-handoff-*.tar.gz "$HOME"/Desktop/modoo-bom-handoff-*.tar.gz 2>/dev/null | head -1)"
fi
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "❌ 백업 파일(modoo-bom-handoff-*.tar.gz)을 못 찾았어요."
  echo "   → Downloads나 Desktop에 두거나, 경로를 직접 지정하세요:"
  echo "     bash scripts/restore-handoff.sh /경로/modoo-bom-handoff-YYYYMMDD.tar.gz"
  exit 1
fi
echo "  백업 파일: $ARCHIVE"

# 2) 임시 폴더에 압축 해제
TMP="$(mktemp -d)"
tar -xzf "$ARCHIVE" -C "$TMP" || { echo "❌ 압축 해제 실패"; rm -rf "$TMP"; exit 1; }

# 3) 비밀키 복원
if [ -f "$TMP/frontend.env" ]; then cp "$TMP/frontend.env" "$ROOT/frontend/.env"; echo "  ✓ frontend/.env 복원"; fi
if [ -f "$TMP/backend.env" ];  then cp "$TMP/backend.env"  "$ROOT/backend/.env";  echo "  ✓ backend/.env 복원"; fi

# 4) 클로드 메모리·대화기록 복원 (이 컴퓨터의 홈 경로에 맞춰 폴더명 자동 계산)
USERENC="$(printf '%s' "$HOME" | sed 's#/#-#g')"   # 예: /Users/kim → -Users-kim
PROJ="$HOME/.claude/projects"
if [ -d "$TMP/claude-memory" ]; then
  mkdir -p "$PROJ/${USERENC}/memory"
  cp -R "$TMP/claude-memory/." "$PROJ/${USERENC}/memory/"
  echo "  ✓ 클로드 메모리 → $PROJ/${USERENC}/memory"
fi
if [ -d "$TMP/claude-history" ]; then
  mkdir -p "$PROJ/${USERENC}-Desktop"
  cp -R "$TMP/claude-history/." "$PROJ/${USERENC}-Desktop/"
  echo "  ✓ 클로드 대화기록 → $PROJ/${USERENC}-Desktop"
fi

rm -rf "$TMP"
echo ""
echo "✅ 복원 완료! 이제 앱을 실행하세요:"
echo "     cd frontend && npm install && npm run dev"
echo "   그리고 이 폴더에서 클로드 코드를 열면 이전 흐름을 그대로 이어갑니다."
