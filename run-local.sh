#!/bin/bash
# 모두봄 자동화 모드 실행 — 백엔드(RPA) + 프론트를 한 번에.
# 자동 서류발급/신청(정부24·복지로·건보·고용24 실제 조작)은 이 로컬 모드에서만 동작합니다.
# (배포 정적 사이트에는 브라우저 자동화 백엔드가 없어 공식 링크 안내만 제공됩니다.)
#   사용법:  ./run-local.sh
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "========================================="
echo "  모두봄 — 자동화(RPA) 로컬 실행"
echo "========================================="

echo "[1/5] 백엔드 가상환경 · 패키지 설치..."
cd "$ROOT/backend"
[ -d venv ] || python3 -m venv venv
source venv/bin/activate
pip install -q --disable-pip-version-check -r requirements.txt

echo "[2/5] Playwright Chromium 설치(최초 1회)..."
python -m playwright install chromium >/dev/null 2>&1 || python -m playwright install chromium

echo "[3/5] 프론트엔드 패키지..."
cd "$ROOT/frontend"
[ -d node_modules ] || npm install

echo "[4/5] 기존 프로세스 정리 후 서버 시작..."
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1
cd "$ROOT/backend"
( source venv/bin/activate; uvicorn main:app --port 8000 > /tmp/modoo-backend.log 2>&1 & )
cd "$ROOT/frontend"
( npm run dev > /tmp/modoo-frontend.log 2>&1 & )

echo "[5/5] 백엔드 준비 대기..."
for i in $(seq 1 40); do curl -s http://localhost:8000/api/health >/dev/null 2>&1 && break; sleep 1; done

echo ""
echo "✅ 자동화 모드 준비 완료!"
echo "   🌐 http://localhost:5173  접속 → 백엔드가 감지되어 '자동발급/자동신청' 버튼이 활성화됩니다."
echo "   📄 서류: '나의 복지 → 서류 준비 도우미'에서 자동발급"
echo "   🚀 신청: 정책 상세 → '에이전트로 신청 시작'"
echo "   🔐 카카오 본인인증과 최종 제출은 본인이 직접 진행하세요(법적 요건)."
echo "   📋 로그: tail -f /tmp/modoo-backend.log"
echo ""
sleep 2
open http://localhost:5173 2>/dev/null || true
