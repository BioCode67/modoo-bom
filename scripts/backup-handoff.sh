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

# 1) 비밀키(.env) — Desktop의 '모든 프로젝트'에서 수집(통합 백업)
echo "  🔑 비밀키(.env) 수집 — 모든 Desktop 프로젝트:"
for proj in "$HOME"/Desktop/*/; do
  [ -d "$proj/.git" ] || continue          # git 프로젝트만
  pname="$(basename "$proj")"
  for rel in ".env" "frontend/.env" "backend/.env"; do
    if [ -f "$proj$rel" ]; then
      mkdir -p "$STAGE/envs/$pname/$(dirname "$rel")"
      cp "$proj$rel" "$STAGE/envs/$pname/$rel"
      echo "     + $pname/$rel"
    fi
  done
done
# (하위호환) modoo-bom .env를 최상위에도 둔다 — 구버전 restore 스크립트 대비
[ -f "$ROOT/frontend/.env" ] && cp "$ROOT/frontend/.env" "$STAGE/frontend.env"
[ -f "$ROOT/backend/.env" ]  && cp "$ROOT/backend/.env"  "$STAGE/backend.env"

# 2) 클로드 메모리 — Mac(/Users/it → -Users-it) / Windows(C--Users-...-modoo-bom) 경로 인코딩 모두 대응
USERENC="$(printf '%s' "$HOME" | sed 's#/#-#g')"
MEMDIR=""
for cand in \
  "$HOME/.claude/projects/${USERENC}/memory" \
  "$HOME/.claude/projects/${USERENC}-Desktop-modoo-bom/memory"; do
  [ -d "$cand" ] && MEMDIR="$cand" && break
done
# 못 찾으면 modoo-bom 관련 memory 폴더를 글롭으로 탐색(가장 안전)
[ -z "$MEMDIR" ] && MEMDIR="$(ls -d "$HOME"/.claude/projects/*modoo-bom*/memory 2>/dev/null | head -1)"
if [ -n "$MEMDIR" ] && [ -d "$MEMDIR" ]; then
  cp -R "$MEMDIR" "$STAGE/claude-memory"; echo "  + 클로드 메모리 ($(du -sh "$MEMDIR" | cut -f1))"
else
  echo "  (클로드 메모리 폴더 못 찾음 — HANDOFF.md·CLAUDE.md로 흐름은 이어집니다)"
fi

# 프로젝트 컨텍스트 사본(참고용, 레포에도 있음)
[ -f "$ROOT/CLAUDE.md" ] && cp "$ROOT/CLAUDE.md" "$STAGE/CLAUDE.md"
[ -f "$ROOT/HANDOFF.md" ] && cp "$ROOT/HANDOFF.md" "$STAGE/HANDOFF.md"

# 3) 클로드 대화기록 (선택 — 용량 큼). Windows는 memory의 상위(프로젝트) 폴더에 대화기록이 함께 있음.
HISTDIR="$HOME/.claude/projects/${USERENC}-Desktop"
if [ ! -d "$HISTDIR" ] && [ -n "$MEMDIR" ]; then HISTDIR="$(dirname "$MEMDIR")"; fi
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
