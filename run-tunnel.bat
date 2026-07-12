@echo off
setlocal enableextensions
chcp 65001 >nul
title 모두봄 - 공개 터널 (cloudflared)

rem ── 로컬 RPA 서버(포트 8000)를 https 공개 주소로 터널링 ──────────────
rem  cloudflared 가 필요합니다(무료). 설치: winget install --id Cloudflare.cloudflared
rem  또는 https://github.com/cloudflare/cloudflared/releases 에서 cloudflared.exe 를
rem  이 폴더에 넣으세요. 실행하면 https://<무작위>.trycloudflare.com 주소가 나옵니다.
rem  그 주소가 'VITE_RPA_BASE' 값입니다(끝의 / 없이).
rem ─────────────────────────────────────────────────────────────────────

cd /d "%~dp0"

set "CF=cloudflared"
if exist "cloudflared.exe" set "CF=cloudflared.exe"

where %CF% >nul 2>nul
if errorlevel 1 (
  echo [안내] cloudflared 가 없습니다. 아래 중 하나로 설치 후 다시 실행하세요:
  echo    - winget install --id Cloudflare.cloudflared
  echo    - https://github.com/cloudflare/cloudflared/releases 에서 cloudflared.exe 를 이 폴더에 저장
  pause
  exit /b 1
)

echo [모두봄] 공개 터널을 엽니다... 아래 'https://....trycloudflare.com' 주소를 복사하세요.
echo         그 주소가 VITE_RPA_BASE 값입니다. (이 창은 닫지 마세요)
echo.
%CF% tunnel --url http://localhost:8000

endlocal
