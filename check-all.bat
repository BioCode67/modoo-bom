@echo off
setlocal enableextensions
chcp 65001 >nul
title 모두봄 - 전체 품질 게이트 점검(데모 전)

rem ── 데모 전 한 번에 모든 품질 게이트를 돌려 초록불을 확인한다 ──────────
rem  프론트: lint · tsc · vitest    백엔드: pytest    로컬앱: e2e 자동발급 체인
rem  실패한 항목은 [FAIL] 로 표시되고, 마지막에 요약된다.
rem ────────────────────────────────────────────────────────────────────
cd /d "%~dp0"
set "FAIL=0"

rem 백엔드 파이썬(전체 스택 venv 우선 — pytest는 chromadb 등 필요)
set "PYFULL="
if exist "backend\venv\Scripts\python.exe" set "PYFULL=backend\venv\Scripts\python.exe"

echo(
echo === [1/5] 프론트 ESLint ===
pushd frontend
call npm run lint
if errorlevel 1 (set "FAIL=1"& echo [FAIL] lint) else (echo [OK] lint)
popd

echo(
echo === [2/5] 타입체크(tsc) ===
pushd frontend
call npx tsc --noEmit
if errorlevel 1 (set "FAIL=1"& echo [FAIL] tsc) else (echo [OK] tsc)
popd

echo(
echo === [3/5] 프론트 단위테스트(vitest) ===
pushd frontend
call npm test
if errorlevel 1 (set "FAIL=1"& echo [FAIL] vitest) else (echo [OK] vitest)
popd

echo(
echo === [4/5] 백엔드 pytest ===
if defined PYFULL (
  "%PYFULL%" -m pytest backend\tests -q
  if errorlevel 1 (set "FAIL=1"& echo [FAIL] pytest) else (echo [OK] pytest)
) else (
  echo [SKIP] backend\venv 없음 — venv 생성 후 requirements 설치하고 재실행
)

echo(
echo === [5/5] 로컬앱 자동발급 E2E 체인 ===
set "PYE2E="
if exist "backend\venv-local\Scripts\python.exe" set "PYE2E=..\backend\venv-local\Scripts\python.exe"
if not defined PYE2E if defined PYFULL set "PYE2E=..\%PYFULL%"
if defined PYE2E (
  pushd frontend
  "%PYE2E%" e2e\local-app.py
  if errorlevel 1 (set "FAIL=1"& echo [FAIL] e2e:app) else (echo [OK] e2e:app)
  popd
) else (
  echo [SKIP] e2e:app — venv 없음(setup-local.bat 먼저 실행)
)

echo(
echo ============================================================
if "%FAIL%"=="0" (echo   전체 게이트 통과 — 데모 준비 완료) else (echo   일부 게이트 실패 — 위 [FAIL] 항목 확인)
echo ============================================================
pause
endlocal
exit /b %FAIL%
