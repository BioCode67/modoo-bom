@echo off
REM 모두봄(ModooBom) 윈도우 실행 - 이 파일을 더블클릭하세요.
REM 백엔드(:8000) + 프론트엔드(:5173) 를 새 창에서 기동하고 브라우저를 엽니다.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-windows.ps1"
