@echo off
setlocal enableextensions
chcp 65001 >nul
title 모두봄 - 로컬 앱 최초 설치(1회)

rem ── 모두봄 로컬 데스크탑 앱: 최초 1회 설치 스크립트 ─────────────────────
rem  가벼운 전용 venv(backend\venv-local) + 프론트 로컬 빌드를 준비한다.
rem  이후에는 run-local-app.bat 더블클릭만으로 실행된다.
rem  필요: Python 3.11+, Node.js 20+ 가 설치돼 있어야 함(PATH).
rem ────────────────────────────────────────────────────────────────────
cd /d "%~dp0"

where python >nul 2>&1 || (echo [오류] Python 이 필요합니다. https://python.org 에서 3.11+ 설치 후 다시 실행하세요. & pause & exit /b 1)
where npm    >nul 2>&1 || (echo [오류] Node.js 가 필요합니다. https://nodejs.org 에서 20+ 설치 후 다시 실행하세요. & pause & exit /b 1)

echo [1/4] 경량 파이썬 가상환경 생성(backend\venv-local)...
if not exist "backend\venv-local\Scripts\python.exe" (
  python -m venv backend\venv-local || (echo [오류] venv 생성 실패 & pause & exit /b 1)
)
set "PY=backend\venv-local\Scripts\python.exe"

echo [2/4] 로컬 에이전트 의존성 설치(가벼움 — chromadb/torch 제외)...
"%PY%" -m pip install --upgrade pip >nul
"%PY%" -m pip install -r backend\requirements-local.txt || (echo [오류] pip 설치 실패 & pause & exit /b 1)

echo [3/4] 브라우저 런타임 준비(Playwright)...
rem 시스템 Chrome 이 있으면 그걸 쓰지만, 없을 때를 대비해 chromium 도 받아둔다.
"%PY%" -m playwright install chromium

echo [4/4] 프론트(로컬 앱) 빌드...
pushd frontend
if not exist "node_modules" ( call npm install )
call npm run build:app
popd

echo.
echo ✅ 설치 완료! 이제 run-local-app.bat 을 더블클릭하면 모두봄이 열립니다.
pause
endlocal
