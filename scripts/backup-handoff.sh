#!/usr/bin/env bash
# 모두봄 인수인계 백업 — GitHub에 없는 로컬 전용 파일(비밀키·클로드 메모리·대화기록)을
# Desktop에 하나의 압축파일로 묶는다. 새 노트북에서 이 파일을 풀어 복원.
# ⚠️ 결과물엔 비밀키가 들어있으니 USB/개인 클라우드로만 옮기고, 공개된 곳에 올리지 말 것.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATE="$(date +%Y%m%d)"
STAGE="$(mktemp -d)"
OUT="$HOME/Desktop/modoo-bom-handoff-$DATE.tar.gz"

echo "🧳 모두봄 인수인계 백업 만들기"
echo ""

# 1) 비밀키 (.env)
if [ -f "$ROOT/frontend/.env" ]; then cp "$ROOT/frontend/.env" "$STAGE/frontend.env"; echo "  + frontend/.env (Supabase 키)"; fi
if [ -f "$ROOT/backend/.env" ];  then cp "$ROOT/backend/.env"  "$STAGE/backend.env";  echo "  + backend/.env (data.go.kr 등 키)"; fi

# 2) 클로드 메모리 (경로 인코딩: /Users/it → -Users-it)
USERENC="$(printf '%s' "$HOME" | sed 's#/#-#g')"
MEMDIR="$HOME/.claude/projects/${USERENC}/memory"
if [ -d "$MEMDIR" ]; then cp -R "$MEMDIR" "$STAGE/claude-memory"; echo "  + 클로드 메모리 ($(du -sh "$MEMDIR" | cut -f1))"; fi

# 프로젝트 컨텍스트 사본(참고용, 레포에도 있음)
[ -f "$ROOT/CLAUDE.md" ] && cp "$ROOT/CLAUDE.md" "$STAGE/CLAUDE.md"
[ -f "$ROOT/HANDOFF.md" ] && cp "$ROOT/HANDOFF.md" "$STAGE/HANDOFF.md"

# 3) 클로드 대화기록 (선택 — 용량 큼)
HISTDIR="$HOME/.claude/projects/${USERENC}-Desktop"
if [ -d "$HISTDIR" ]; then
  SZ="$(du -sh "$HISTDIR" | cut -f1)"
  printf "  클로드 대화기록 전체(%s)도 담을까요? [y/N] " "$SZ"
  read -r yn
  if [ "${yn:-N}" = "y" ] || [ "${yn:-N}" = "Y" ]; then
    cp -R "$HISTDIR" "$STAGE/claude-history"; echo "  + 대화기록 포함"
  else
    echo "  (대화기록 제외 — 메모리+CLAUDE.md로도 흐름은 이어집니다)"
  fi
fi

tar -czf "$OUT" -C "$STAGE" .
rm -rf "$STAGE"

echo ""
echo "✅ 완료: $OUT"
echo "   → USB나 개인 클라우드로 옮기세요. 새 노트북에서 tar -xzf 로 풀어 복원."
echo "   ⚠️ 비밀키 포함 — GitHub 등 공개된 곳에 올리지 마세요."
