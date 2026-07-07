@echo off
setlocal enableextensions
chcp 65001 >nul
title 모두봄 - 배포본 빌드(단일 실행파일 + 배포 ZIP + 인스톨러)

rem ── 모두봄 로컬 에이전트 배포본 빌드 ─────────────────────────────────
rem  1) 프론트 로컬 빌드(dist-app)  2) PyInstaller 단일 실행파일
rem  3) 배포 ZIP(압축)  4) (Inno Setup 있으면) 설치 프로그램(setup.exe)
rem  사전: setup-local.bat 로 backend\venv-local 준비돼 있어야 함.
rem ────────────────────────────────────────────────────────────────────
cd /d "%~dp0"

if not exist "backend\venv-local\Scripts\python.exe" (
  echo [오류] backend\venv-local 이 없습니다. 먼저 setup-local.bat 을 실행하세요.
  pause & exit /b 1
)
set "PY=backend\venv-local\Scripts\python.exe"

echo [1/4] 프론트 로컬 앱 빌드(dist-app)...
pushd frontend
if not exist "node_modules" ( call npm install )
call npm run build:app || (echo [오류] 프론트 빌드 실패 & popd & pause & exit /b 1)
popd

echo [2/4] 단일 실행파일 빌드(PyInstaller)...
pushd backend
"venv-local\Scripts\python.exe" -m pip install -q pyinstaller
"venv-local\Scripts\python.exe" -m PyInstaller --clean --noconfirm modoobom_agent.spec || (echo [오류] PyInstaller 빌드 실패 & popd & pause & exit /b 1)
popd

echo [2.5/4] 실행파일 패키징 스모크(뜨고·서빙·RPA 준비·브라우저 실기동 확인)...
pushd frontend
"..\backend\venv-local\Scripts\python.exe" e2e\installed-app.py
if errorlevel 1 (
  echo [오류] 패키징 스모크 실패 — 번들 누락/드라이버 파손 의심. 배포본 빌드 중단.
  popd & pause & exit /b 1
)
popd

echo [3/4] 배포 ZIP 생성...
if exist "backend\dist\모두봄-에이전트.zip" del "backend\dist\모두봄-에이전트.zip"
powershell -NoProfile -Command "Compress-Archive -Path 'backend\dist\모두봄-에이전트\*' -DestinationPath 'backend\dist\모두봄-에이전트.zip' -Force"
if exist "backend\dist\모두봄-에이전트.zip" ( echo   → backend\dist\모두봄-에이전트.zip 생성 완료 ) else ( echo   [경고] ZIP 생성 실패 )

echo [4/4] 설치 프로그램(선택 — Inno Setup 있으면)...
set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"
if defined ISCC (
  "%ISCC%" "backend\installer.iss" && echo   → backend\dist\모두봄-설치.exe 생성 완료
) else (
  echo   Inno Setup 미설치 — 설치 프로그램 스킵. ZIP 배포를 사용하세요.
  echo   ^(Inno Setup 설치: winget install JRSoftware.InnoSetup, 이후 build-installer.bat 재실행^)
)

echo.
echo ✅ 배포본 빌드 완료.
echo   · 폴더 실행: backend\dist\모두봄-에이전트\모두봄-에이전트.exe
echo   · 배포 ZIP : backend\dist\모두봄-에이전트.zip  ^(압축 풀고 exe 더블클릭^)
pause
endlocal
