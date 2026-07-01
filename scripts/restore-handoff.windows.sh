#!/usr/bin/env bash
# 새 노트북(윈도우)에서 인수인계 백업을 '한 번에' 복원한다. — Git Bash 전용.
# (원본 restore-handoff.sh 는 맥 전용. 이 파일은 그걸 건드리지 않고 새로 만든 윈도우 버전.)
#
# 사용법 (Git Bash 에서):
#   cd ~/Desktop/modoo-bom
#   bash scripts/restore-handoff.windows.sh
#   # 백업 경로를 직접 줄 수도 있음:
#   bash scripts/restore-handoff.windows.sh /c/Users/<계정>/Downloads/modoo-bom-handoff-YYYYMMDD.tar.gz
set -uo pipefail

echo "🧳 모두봄 인수인계 자동 복원 (Windows / Git Bash)"
echo ""

# 0) Git Bash 환경 확인 (cygpath 로 판별). PowerShell/WSL 이 아니라 Git Bash 에서 돌려야 함.
if ! command -v cygpath >/dev/null 2>&1; then
  echo "⚠️  cygpath 를 못 찾았어요. 이 스크립트는 'Git Bash' 에서 실행하세요 (PowerShell/WSL 아님)."
  echo ""
fi

# 1) 백업 파일 찾기 (인자 우선, 없으면 Downloads/Desktop 자동 탐색).
#    Git Bash 에서 $HOME = /c/Users/<계정> 이라, 아래 경로가 실제 윈도우 폴더로 잡힌다.
ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ]; then
  ARCHIVE="$(find "$HOME/Downloads" "$HOME/Desktop" -maxdepth 1 -name 'modoo-bom-handoff-*.tar.gz' 2>/dev/null | sort -r | head -1)"
fi
if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "❌ 백업 파일(modoo-bom-handoff-*.tar.gz)을 못 찾았어요."
  echo "   → Downloads 나 Desktop 에 두거나, 경로를 직접 지정하세요:"
  echo "     bash scripts/restore-handoff.windows.sh /c/Users/<계정>/Downloads/modoo-bom-handoff-YYYYMMDD.tar.gz"
  exit 1
fi
echo "  백업 파일: $ARCHIVE"

# 복원 대상(클론된 프로젝트들)이 있는 Desktop 루트.
DESKTOP="$HOME/Desktop"

# 2) 임시 폴더에 압축 해제. 실패했을 때만 tar 로그를 보여주고,
#    맥에서 만든 tar 라 섞여 들어온 AppleDouble 잔재(._*)는 지운다.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if ! tar -xzf "$ARCHIVE" -C "$TMP" 2>"$TMP/.tarlog"; then
  echo "❌ 압축 해제 실패"; cat "$TMP/.tarlog"; exit 1
fi
find "$TMP" -name '._*' -delete 2>/dev/null   # macOS AppleDouble 잔재 제거

# 3) 비밀키(.env) 복원 — 통합 백업(envs/<프로젝트>/...) 이면 각 Desktop 프로젝트 폴더로.
restored=0
if [ -d "$TMP/envs" ]; then
  for projdir in "$TMP/envs"/*/; do
    pname="$(basename "$projdir")"
    target="$DESKTOP/$pname"
    if [ -d "$target" ]; then
      while IFS= read -r rel; do
        rel="${rel#./}"
        mkdir -p "$target/$(dirname "$rel")"
        cp "$projdir$rel" "$target/$rel"
        echo "  ✓ $pname/$rel 복원"
        restored=$((restored + 1))
      done < <(cd "$projdir" && find . -type f -name '.env')
    else
      echo "  … $pname 폴더가 Desktop 에 없어요 (먼저 clone 하세요): 백업의 envs/$pname/ 참고"
    fi
  done
else
  # (하위호환) 구버전 백업: 최상위 frontend.env/backend.env → modoo-bom
  [ -f "$TMP/frontend.env" ] && mkdir -p "$DESKTOP/modoo-bom/frontend" && cp "$TMP/frontend.env" "$DESKTOP/modoo-bom/frontend/.env" && echo "  ✓ modoo-bom/frontend/.env 복원 (구버전)" && restored=$((restored + 1))
  [ -f "$TMP/backend.env" ]  && mkdir -p "$DESKTOP/modoo-bom/backend"  && cp "$TMP/backend.env"  "$DESKTOP/modoo-bom/backend/.env"  && echo "  ✓ modoo-bom/backend/.env 복원 (구버전)"  && restored=$((restored + 1))
fi

# 4) 클로드 메모리·대화기록 복원 — 윈도우식 프로젝트 폴더명으로 인코딩.
#    맥 원본은  sed 's#/#-#g'  로  /Users/kim → -Users-kim  을 만들지만,
#    윈도우 클로드는  C--Users-user-...  형식이라 cygpath 로 윈도우 경로를 얻어 :\/ 를 - 로 바꿔야 한다.
winhome="$(cygpath -w "$HOME" 2>/dev/null || printf '%s' "$HOME")"   # 예: C:\Users\user
HOMEENC="$(printf '%s' "$winhome" | sed 's#[:\\/]#-#g')"            # 예: C--Users-user
PROJ="$HOME/.claude/projects"
if [ -d "$TMP/claude-memory" ]; then
  mkdir -p "$PROJ/$HOMEENC/memory"
  cp -R "$TMP/claude-memory/." "$PROJ/$HOMEENC/memory/"
  echo "  ✓ 클로드 메모리 → $PROJ/$HOMEENC/memory"
fi
if [ -d "$TMP/claude-history" ]; then
  mkdir -p "$PROJ/${HOMEENC}-Desktop"
  cp -R "$TMP/claude-history/." "$PROJ/${HOMEENC}-Desktop/"
  echo "  ✓ 클로드 대화기록 → $PROJ/${HOMEENC}-Desktop"
fi

# 5) 요약 — 어떤 프로젝트가 복원됐고, 백업에 아예 없는 건 뭔지 분명히.
echo ""
echo "── 복원 요약 ─────────────────────────────"
echo "  복원된 .env 개수: $restored"
for d in modoo-bom signbridge Eco-Biz-Connect; do
  if   [ ! -d "$DESKTOP/$d" ];      then echo "  • $d: Desktop 에 폴더 없음 (clone 필요)"
  elif [ -d "$TMP/envs/$d" ];       then echo "  • $d: 백업에 env 있음 → 복원함"
  else                                   echo "  • $d: 백업에 env 없음 → 복원할 것 없음"
  fi
done
echo "──────────────────────────────────────────"
echo ""
echo "✅ 복원 완료! 이제 앱을 실행하세요:"
echo "     cd \"$DESKTOP/modoo-bom/frontend\" && npm install && npm run dev"
echo "   그리고 이 폴더에서 클로드 코드를 열면 이전 흐름을 그대로 이어갑니다."
