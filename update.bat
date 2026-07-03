@echo off
chcp 65001 >nul
rem ── 모두봄 업데이트 원클릭 스크립트 ──
rem 더블클릭 한 번으로: 꼬인 머지/리베이스 정리 → 최신 코드 받기 → 확장 버전 표시
cd /d %~dp0

rem 편집기(vi/메모장) 안 뜨게 + pull은 리베이스로(머지 커밋 안 만듦)
git config core.editor "true"
git config pull.rebase true

rem 이전에 꼬인 머지/리베이스가 있으면 정리
git rebase --abort >nul 2>&1
git merge --abort >nul 2>&1

echo.
echo [1/2] 최신 코드 받는 중...
git pull --rebase
if errorlevel 1 (
  echo.
  echo !! 받기 실패 — 이 창을 캡처해서 보여주세요.
  pause
  exit /b 1
)

echo.
echo [2/2] 현재 확장 프로그램 버전:
findstr /C:"\"version\"" extension\manifest.json

echo.
echo ✅ 완료! 이제 크롬에서:
echo    1. 주소창에 chrome://extensions 입력
echo    2. '모두봄 복지 에이전트' 카드의 새로고침(↻) 클릭
echo    3. 위 버전과 같은지 확인
echo.
pause
