@echo off
setlocal enableextensions
chcp 65001 >nul
title 모두봄 RPA 서버 (체험·서류 자동발급)

rem ── 모두봄 RPA 서버 실행기 ─────────────────────────────────────────────
rem  이 PC를 'RPA 서버'로 켠다. 배포 사이트(biocode67.github.io)가 이 서버를 통해
rem  실제 정부24를 자동 조작한다(체험은 개인정보 없이, 실제 발급은 방문자 옵트인).
rem  공개하려면 cloudflared 터널로 https 주소를 얻어 VITE_RPA_BASE 에 넣고 재배포한다.
rem  (자세한 절차: docs/서버사이드-RPA-설계.md)
rem ─────────────────────────────────────────────────────────────────────

cd /d "%~dp0"

rem 1) 파이썬 선택 (경량 venv-local 우선 → 전체 venv → 시스템)
set "PY=python"
if exist "backend\venv\Scripts\python.exe" set "PY=backend\venv\Scripts\python.exe"
if exist "backend\venv-local\Scripts\python.exe" set "PY=backend\venv-local\Scripts\python.exe"

rem 2) 서버 RPA 설정 (개인정보 보호 기본값)
set "RPA_ENABLED=1"
set "RPA_HEADLESS=1"
set "RPA_BROWSER_CHANNEL=chrome"
set "RPA_DELETE_AFTER_DOWNLOAD=1"
set "RPA_TASK_TIMEOUT=1800"
set "PYTHONUTF8=1"
set "MODOO_ENV=server"
set "HOST=0.0.0.0"
set "PORT=8000"

echo.
echo   ┌───────────────────────────────────────────────────────────┐
echo   │  🌱 모두봄 RPA 서버를 시작합니다 (포트 8000)                │
echo   │                                                           │
echo   │  다음 단계(공개):                                          │
echo   │  1) 새 창에서  run-tunnel.bat  더블클릭 → https 주소 확인   │
echo   │  2) 그 주소를 VITE_RPA_BASE 로 빌드/배포 (설계 문서 참고)   │
echo   │                                                           │
echo   │  이 검은 창은 닫지 마세요. 여기서 서버가 돌아갑니다.        │
echo   └───────────────────────────────────────────────────────────┘
echo.

pushd backend
"%PY%" -m uvicorn local_server:app --host 0.0.0.0 --port 8000
popd

endlocal
