@echo off
setlocal
chcp 65001 >nul
title 모두봄 - 🎬 흐름 기록 모드

rem ── 🎬 흐름 기록(flow recorder) 모드 실행기 ─────────────────────────
rem  개발자에게 '새 화면·팝업 구조'를 스크린샷 대신 파일 하나로 전달할 때만 쓰세요.
rem  run-local-app.bat 와 100%% 동일하게 실행하되 RPA_FLOW_RECORD 만 켠다(중복 유지보수 없음 —
rem  run-local-app 의 setlocal 이 이 변수를 그대로 물려받는다). 평소엔 run-local-app.bat 로 실행.
rem
rem  사용법:
rec   1) 이 파일을 더블클릭 → 평소처럼 자동발급/신청을 '한 번' 끝까지 진행(폰 인증 포함).
rem   2) 화면 오른쪽 위 [🎬 흐름 기록 복사] 버튼을 눌러 복사 → 개발자에게 붙여넣기.
rem      (버튼이 안 보이면 http://localhost:8000/api/_diagnostics/flow 를 열어 내용을 복사)
rem  → 지나간 모든 화면의 '구조'(버튼·입력칸·팝업, 값은 없음)가 한 번에 전달돼, 스샷을
rem    단계마다 찍지 않아도 다음 화면·새 팝업까지 함께 고칠 수 있습니다.
rem ────────────────────────────────────────────────────────────────

cd /d "%~dp0"
set "RPA_FLOW_RECORD=1"
echo [모두봄] 🎬 흐름 기록 모드로 시작합니다 — 화면이 바뀔 때마다 '구조'를 저장해요(이름·주민번호 등 값은 저장 안 함).
echo         자동발급/신청을 끝까지 한 번 진행한 뒤, 화면의 [🎬 흐름 기록 복사]로 개발자에게 보내 주세요.
echo.
call "%~dp0run-local-app.bat"

endlocal
