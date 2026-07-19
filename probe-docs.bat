@echo off
chcp 65001 >nul
rem ── 모두봄: 자동발급 서류 커버리지 확장 (정부24 실측 프로브) ──
rem 사용법:
rem   probe-docs.bat                          기본 후보 7종 조사(보고서만)
rem   probe-docs.bat --register 혼인관계증명서   실측 통과분 바로 등록(β) → 앱 재시작하면 패널에 등장
rem   probe-docs.bat --list                   등록된 동적 서류 확인
rem   probe-docs.bat --remove 혼인관계증명서     등록 해제(첫 발급 실패 시)
cd /d "%~dp0backend"
if exist venv-local\Scripts\python.exe (set PY=venv-local\Scripts\python.exe) else (set PY=venv\Scripts\python.exe)
%PY% tools\probe_gov24_docs.py %*
pause
