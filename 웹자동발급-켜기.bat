@echo off
setlocal enableextensions
chcp 65001 >nul
title 모두봄 - 웹/폰에서 바로 자동발급 켜기 (원클릭)

rem ── 더블클릭 한 번으로: RPA 서버 + 공개터널 + 재빌드·배포까지 자동 ──────────
rem  완료되면 배포 사이트에서 방문자가 '실제 정부24 자동발급'을 바로 쓸 수 있어요.
rem  (본인인증만 폰에서 — 법이 요구하는 유일한 사람 단계)
rem  전제: cloudflared 설치(winget install --id Cloudflare.cloudflared),
rem        frontend에서 npm run deploy 되는 git 인증.
rem  ⚠️ 이 검은 창은 닫지 마세요 — 닫으면 서버·터널이 꺼집니다.
rem ─────────────────────────────────────────────────────────────────────
cd /d "%~dp0"

set "PY=python"
if exist "backend\venv\Scripts\python.exe" set "PY=backend\venv\Scripts\python.exe"
if exist "backend\venv-local\Scripts\python.exe" set "PY=backend\venv-local\Scripts\python.exe"

echo.
echo   🌱 모두봄 — 웹/폰에서 '바로 자동발급'을 켭니다...
echo      (서버 → 공개터널 → 재빌드·배포까지 자동, 1~3분 소요)
echo.

"%PY%" backend\enable_web_rpa.py

echo.
echo   (종료되었습니다. 다시 켜려면 이 파일을 다시 더블클릭하세요.)
pause
endlocal
