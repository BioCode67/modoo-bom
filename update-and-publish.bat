@echo off
setlocal enableextensions
chcp 65001 >nul
title 모두봄 - 업데이트→빌드→게시 (원클릭)

rem ── 모두봄 데스크탑 앱  한 번에: git pull → 배포본 빌드 → GitHub Release 게시 ──
rem  이 파일 하나만 더블클릭하면 최신 코드로 exe 를 새로 만들고 배포 웹사이트의
rem  '앱 받기'(releases/latest)까지 갱신한다. 중간 pause 없이 끝까지 자동 진행.
rem  사전 준비(최초 1회): setup-local.bat 실행 + gh CLI 로그인(gh auth login).
rem  ⚠️ 세 단계 중 하나라도 실패하면 그 지점에서 멈추고 이유를 보여준다(무리한 진행 금지).
rem ────────────────────────────────────────────────────────────────────────────
cd /d "%~dp0"

rem 하위 스크립트(build-installer/publish-release)의 pause 를 모두 건너뛰게 해 무인 체인으로 잇는다.
set "MODOO_NOPAUSE=1"

echo ==================================================
echo   모두봄 데스크탑 앱   업데이트 -^> 빌드 -^> 게시
echo ==================================================
echo.

echo [1/3] 최신 코드 받기 (git pull)...
git pull
if errorlevel 1 (
  echo.
  echo [중단] git pull 실패 — 인터넷 연결/로컬 변경 충돌을 확인한 뒤 다시 실행하세요.
  goto :done
)
echo   → 최신 코드로 업데이트 완료.
echo.

echo [2/3] 배포본 빌드 (build-installer.bat: 프론트+exe+ZIP+설치파일)...
echo   ^(1~3분 소요. 처음이면 setup-local.bat 을 먼저 실행해 두어야 합니다.^)
call "%~dp0build-installer.bat"
if errorlevel 1 (
  echo.
  echo [중단] 배포본 빌드 실패 — 위 로그를 확인하세요.
  echo        ^(venv-local 없음이면 setup-local.bat 먼저 실행^)
  goto :done
)
echo   → 배포본 빌드 완료.
echo.

echo [3/3] GitHub Release 게시 (publish-release.bat: 배포 웹사이트 '앱 받기' 갱신)...
call "%~dp0publish-release.bat"
if errorlevel 1 (
  echo.
  echo [중단] 릴리스 게시 실패 — gh 로그인^(gh auth login^)·네트워크를 확인하세요.
  echo        빌드된 파일은 backend\dist 에 있으니, gh 준비 후 publish-release.bat 만 다시 돌려도 됩니다.
  goto :done
)

echo.
echo ==================================================
echo  ✅ 전체 완료 — 최신 버전이 빌드·게시되었습니다.
echo     · 배포 웹사이트의 '앱 받기'가 새 버전을 가리킵니다.
echo     · 이 PC에서 바로 쓰려면 backend\dist\모두봄-에이전트\모두봄-에이전트.exe 실행.
echo ==================================================

:done
echo.
pause
endlocal
