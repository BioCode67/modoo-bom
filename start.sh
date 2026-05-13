#!/bin/bash
# 모두봄 시연 실행 스크립트
# 사용법: ./start.sh
# 터미널 창을 닫아도 서버가 계속 실행됩니다 (screen 사용)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

echo "========================================="
echo "  모두봄(ModooBom) 시연 서버 시작"
echo "========================================="

# 기존 실행 중인 서버 정리
echo "[1/4] 기존 프로세스 정리 중..."
screen -S modoo-backend -X quit 2>/dev/null || true
screen -S modoo-frontend -X quit 2>/dev/null || true
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

# 백엔드 실행
echo "[2/4] 백엔드 서버 시작 (포트 8000)..."
screen -dmS modoo-backend bash -c "
  cd '$BACKEND_DIR'
  source venv/bin/activate
  uvicorn main:app --host 0.0.0.0 --port 8000 2>&1 | tee /tmp/modoo-backend.log
"

# 백엔드 준비 대기
echo "     백엔드 준비 중..."
for i in {1..20}; do
  if curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
    echo "     ✓ 백엔드 준비 완료"
    break
  fi
  sleep 1
done

# 프론트엔드 실행
echo "[3/4] 프론트엔드 서버 시작 (포트 5173)..."
screen -dmS modoo-frontend bash -c "
  cd '$FRONTEND_DIR'
  npm run dev 2>&1 | tee /tmp/modoo-frontend.log
"

sleep 2

# 수면 방지 (맥북 덮개를 열어둔 상태에서 잠금 방지)
echo "[4/4] 화면 잠금 방지 시작..."
screen -dmS modoo-caffeinate bash -c "caffeinate -d -i"

echo ""
echo "========================================="
echo "  ✅ 시연 환경 준비 완료!"
echo "========================================="
echo ""
echo "  🌐 프론트엔드: http://localhost:5173"
echo "  🔧 백엔드 API: http://localhost:8000/api/health"
echo "  📋 백엔드 로그: tail -f /tmp/modoo-backend.log"
echo "  📋 프론트엔드 로그: tail -f /tmp/modoo-frontend.log"
echo ""
echo "  ⚠️  맥북 덮개를 열어두세요."
echo "     덮개를 닫으면 맥이 잠자기 상태가 되어 서버가 멈춥니다."
echo "     외부 모니터 연결 시 덮개를 닫아도 계속 실행됩니다."
echo ""
echo "  서버 중지: ./stop.sh"
echo ""

# 브라우저 자동 열기 (5초 후)
sleep 3
open http://localhost:5173
