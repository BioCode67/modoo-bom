@echo off
REM 기획서 비주얼 자산 자동 렌더링 (더블클릭 실행)
REM 비주얼킷.html 의 DATA 블록을 고친 뒤 이 파일을 실행하면 PNG가 새로 만들어집니다.
chcp 65001 >nul
cd /d "%~dp0"

REM 백엔드 venv 파이썬이 있으면 그걸 쓰고(플레이라이트 설치됨), 없으면 시스템 python.
set PY=..\..\backend\venv\Scripts\python.exe
if not exist "%PY%" set PY=python

"%PY%" render_assets.py
echo.
pause
