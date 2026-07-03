@echo off
chcp 65001 >nul
setlocal
set PYTHONUTF8=1
title 모두봄 로컬 에이전트 (진짜 크롬 자동화)

echo ============================================
echo   모두봄 - 정부24 서류 자동발급 (로컬 에이전트)
echo   개인정보는 이 PC 안에서만 쓰이고 서버로 안 나갑니다.
echo ============================================
echo.

rem ── 1) 진짜 크롬을 원격 디버깅으로 실행 (정부24 Mbuster 통과 + 안정 자동화) ──
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo [오류] 크롬을 찾지 못했어요. 크롬을 설치했는지 확인해 주세요.
  pause & exit /b 1
)

set "CPROFILE=%LOCALAPPDATA%\modoo-agent-chrome"
echo [1/2] 자동화용 크롬 창을 엽니다...
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%CPROFILE%" --no-first-run --no-default-browser-check "about:blank"
timeout /t 4 >nul

rem ── 2) 파이썬 에이전트 실행 (백엔드 venv) ──
cd /d "%~dp0backend"
if not exist "venv\Scripts\python.exe" (
  echo [오류] 백엔드 venv가 없어요. 먼저 run-agent.bat 또는 setup을 한 번 실행해 주세요.
  pause & exit /b 1
)

set "DOC=%~1"
if "%DOC%"=="" set "DOC=주민등록등본"
echo [2/2] 에이전트 시작: %DOC%
echo.
"venv\Scripts\python.exe" local_agent.py "%DOC%"

echo.
echo 끝났습니다. 이 창을 닫아도 됩니다.
pause
