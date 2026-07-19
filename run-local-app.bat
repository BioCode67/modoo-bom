@echo off
setlocal enableextensions
chcp 65001 >nul
title 모두봄 - 로컬 자동발급 에이전트

rem ── 모두봄 로컬 데스크탑 앱 실행기 ──────────────────────────────────
rem  백엔드(localhost:8000)가 프론트까지 '동일 출처'로 서빙하므로, 브라우저의
rem  CORS·로컬네트워크 접근(LNA) 권한 프롬프트 없이 자동 서류발급이 동작한다.
rem  더블클릭하면: (필요시) 프론트 빌드 → 백엔드 기동 → 브라우저 자동 오픈.
rem ────────────────────────────────────────────────────────────────

cd /d "%~dp0"

rem 1) 프론트 로컬 앱 번들(dist-app) — 없거나 소스(git HEAD)가 바뀌었으면 재빌드
rem    현장에서 'git pull'로 최신화한 뒤 실행해도 stale 화면으로 돌지 않게(정직성 수정 누락 방지).
rem    .build-commit 에 빌드 당시 커밋을 기록해 현재 HEAD 와 비교 — 같으면 재빌드 생략(빠른 재기동).
set "NEED_BUILD="
if not exist "frontend\dist-app\index.html" set "NEED_BUILD=1"
set "CUR_HEAD="
for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "CUR_HEAD=%%H"
set "BUILT_HEAD="
if exist "frontend\dist-app\.build-commit" set /p BUILT_HEAD=<"frontend\dist-app\.build-commit"
rem git 이 있고(커밋 조회 성공) HEAD 가 빌드 당시와 다르면 재빌드
if defined CUR_HEAD if not "%CUR_HEAD%"=="%BUILT_HEAD%" set "NEED_BUILD=1"
if defined NEED_BUILD (
  echo [모두봄] 최신 화면으로 프론트를 빌드합니다... ^(1~2분, 최초/업데이트 시^)
  pushd frontend
  call npm run build:app
  rem errorlevel 은 popd 가 0으로 덮기 전에 판정해 둔다(배치 특성).
  if errorlevel 1 (set "BUILD_FAIL=1") else (set "BUILD_FAIL=")
  popd
  rem 빌드 성공시에만 빌드 커밋을 기록 — 실패했는데 기록하면 다음 실행이 '최신'으로
  rem 오인해 재빌드를 건너뛰고, 구버전 화면이 조용히 계속 뜬다(정직성 위반).
  if defined BUILD_FAIL (
    if exist "frontend\dist-app\index.html" (
      echo [주의] 프론트 빌드에 실패해, 이전에 빌드된 화면으로 우선 실행합니다.
      echo        frontend 폴더에서 "npm install" 후 다시 실행하면 최신 화면이 반영돼요.
    )
  ) else (
    if defined CUR_HEAD >"frontend\dist-app\.build-commit" echo %CUR_HEAD%
  )
)
if not exist "frontend\dist-app\index.html" (
  echo [오류] 프론트 빌드에 실패했습니다. Node.js 설치 후 frontend에서 "npm install" 하세요.
  pause
  exit /b 1
)

rem 2) 파이썬 인터프리터 선택 (전용 경량 venv-local 우선 → 기존 venv → 시스템 python)
rem    ⚠️ 절대경로(%~dp0)로 잡는다 — 아래 'pushd backend' 후 상대경로면 backend\backend\... 로 찾아
rem       "The system cannot find the path specified." 로 서버가 안 뜬다(실사용 확정 버그).
set "PY=python"
if exist "%~dp0backend\venv\Scripts\python.exe" set "PY=%~dp0backend\venv\Scripts\python.exe"
if exist "%~dp0backend\venv-local\Scripts\python.exe" set "PY=%~dp0backend\venv-local\Scripts\python.exe"

rem 3) RPA 활성 + 루프백 바인딩(개인정보 보호)으로 백엔드 기동
rem    시스템 Chrome 을 그대로 구동(RPA_BROWSER_CHANNEL=chrome) — 실제 브라우저라 정부24 안티매크로에
rem    강하고, 카카오 간편인증(본인이 직접)도 익숙한 크롬에서 진행된다.
set "RPA_ENABLED=1"
set "RPA_BROWSER_CHANNEL=chrome"
set "RPA_HEADLESS=0"
rem 신청 양식 검토(기본 10분) 중 태스크 타임아웃으로 창이 닫히지 않게 여유 확보
set "RPA_TASK_TIMEOUT=1800"
rem 자동첨부 유효창(발급→신청 사이) — 개인 PC(1인)라 EXE(agent_entry)와 동일하게 1시간.
rem 기본 20분은 공용PC 교차유출 방어값이라, 시연 페이스가 느리면 먼저 발급한 서류가 첨부에서 빠졌다.
set "RPA_ATTACH_MAX_AGE=3600"
set "PYTHONUTF8=1"
set "MODOO_ENV=local"
set "HOST=127.0.0.1"
set "PORT=8000"

echo [모두봄] 로컬 에이전트를 시작합니다... 서버가 뜨면 브라우저가 자동으로 열려요.
rem 경량 로컬 에이전트(local_server)를 main()으로 기동 — 포트 점유 감지(raw 트레이스백 방지) +
rem 서버 준비 후 브라우저 자동 오픈까지 한 곳(main)에서 처리(중복 오픈 방지).
pushd backend
"%PY%" -c "import local_server; local_server.main()"
popd

endlocal
