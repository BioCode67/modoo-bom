#!/bin/bash
echo "모두봄 서버 중지 중..."
screen -S modoo-backend -X quit 2>/dev/null || true
screen -S modoo-frontend -X quit 2>/dev/null || true
screen -S modoo-caffeinate -X quit 2>/dev/null || true
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
echo "✓ 모든 서버 중지 완료"
