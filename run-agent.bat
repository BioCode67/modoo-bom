@echo off
REM 모두봄 로컬 에이전트 — 이 파일을 더블클릭하세요.
REM 배포 사이트(https://biocode67.github.io/modoo-bom/)에서 서류 자동발급/자동신청을 켜는 로컬 에이전트만 실행합니다.
REM 최초 실행 시 자동으로 설치까지 진행됩니다(수 분). 개인정보는 이 PC에서만 처리됩니다.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-agent.ps1"
pause
