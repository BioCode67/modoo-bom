@echo off
chcp 65001 >nul
setlocal
set PYTHONUTF8=1
title 모두봄 지능형 에이전트 (LLM이 화면 읽고 발급)

echo ============================================
echo   모두봄 - 지능형 서류 발급 에이전트
echo   AI가 처음 보는 사이트도 화면을 읽고 스스로 발급합니다.
echo   (GEMINI_API_KEY 있으면 훨씬 똑똑 · 없으면 규칙 폴백)
echo ============================================
echo.

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" ( echo [오류] 크롬을 찾지 못했어요. & pause & exit /b 1 )

set "CPROFILE=%LOCALAPPDATA%\modoo-agent-chrome"
echo [1/2] 자동화용 크롬 창을 엽니다...
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%CPROFILE%" --no-first-run --no-default-browser-check "about:blank"
timeout /t 4 >nul

cd /d "%~dp0backend"
if not exist "venv\Scripts\python.exe" ( echo [오류] 백엔드 venv가 없어요. & pause & exit /b 1 )

set "GOAL=%*"
if "%GOAL%"=="" set "GOAL=주민등록등본 발급"
echo [2/2] 목표: %GOAL%
echo.
"venv\Scripts\python.exe" smart_agent.py %GOAL%

echo.
pause
