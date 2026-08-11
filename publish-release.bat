@echo off
setlocal enableextensions
chcp 65001 >nul
title 모두봄 - 데스크탑 앱 릴리스 게시(GitHub Release)

rem ── 빌드된 인스톨러/ZIP 을 GitHub Release 로 게시 ─────────────────────
rem  RpaShowcase '앱 받기' CTA(→ releases 페이지)가 실제 다운로드로 이어지게 한다.
rem  사전: ① build-installer.bat 로 backend\dist\모두봄-설치.exe / 모두봄-에이전트.zip 생성
rem        ② gh CLI 설치 + 인증(gh auth login) 또는 GH_TOKEN 환경변수
rem  ⚠️ GitHub 은 릴리스 자산의 '한글 파일명을 전부 제거'(모두봄-설치.exe → -.exe)하므로
rem     반드시 ASCII 이름으로 복사해 업로드한다(ModooBom-Setup.exe / ModooBom-Agent.zip).
rem ────────────────────────────────────────────────────────────────────
cd /d "%~dp0"
set "REPO=BioCode67/modoo-bom"
rem 버전을 올리면 여기 태그만 바꾸면 된다 — --latest 라 홈 CTA(latest/download)가 자동으로 새 자산을 가리킨다.
set "TAG=app-v0.3.3"
set "DIST=backend\dist"

rem 상위 오케스트레이터(update-and-publish.bat)에서 부르면 MODOO_NOPAUSE=1 로 pause 를 건너뛴다(무인 체인).
if not exist "%DIST%\모두봄-설치.exe" (echo [오류] %DIST%\모두봄-설치.exe 없음 — build-installer.bat 먼저 & (if not defined MODOO_NOPAUSE pause) & exit /b 1)

echo [1/3] ASCII 이름으로 복사(한글명 GitHub 에서 깨짐 방지)...
copy /y "%DIST%\모두봄-설치.exe" "%DIST%\ModooBom-Setup.exe" >nul
if exist "%DIST%\모두봄-에이전트.zip" copy /y "%DIST%\모두봄-에이전트.zip" "%DIST%\ModooBom-Agent.zip" >nul

where gh >nul 2>&1 || (echo [오류] gh CLI 가 없습니다 — winget install GitHub.cli 후 "gh auth login" 하세요. & (if not defined MODOO_NOPAUSE pause) & exit /b 1)

echo [2/3] 릴리스 생성/자산 업로드(%TAG%)...
set "PUB_ERR=0"
gh release view %TAG% -R %REPO% >nul 2>&1
if errorlevel 1 (
  gh release create %TAG% "%DIST%\ModooBom-Setup.exe" "%DIST%\ModooBom-Agent.zip" -R %REPO% --target main ^
     --title "모두봄 데스크탑 앱 (Windows) v0.3.3" --notes-file "docs\앱-릴리스-노트.md" --latest || set "PUB_ERR=1"
) else (
  gh release upload %TAG% "%DIST%\ModooBom-Setup.exe" "%DIST%\ModooBom-Agent.zip" -R %REPO% --clobber || set "PUB_ERR=1"
)
if "%PUB_ERR%"=="1" (
  echo [오류] 릴리스 게시 실패 — gh 로그인^(gh auth login^)·네트워크·권한을 확인하세요.
  if not defined MODOO_NOPAUSE pause
  exit /b 1
)

echo [3/3] 완료. 자산 목록:
gh api repos/%REPO%/releases/tags/%TAG% --jq ".assets[].name"
echo   → https://github.com/%REPO%/releases/tag/%TAG%
if not defined MODOO_NOPAUSE pause
endlocal
