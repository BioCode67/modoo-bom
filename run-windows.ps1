# 모두봄(ModooBom) — 윈도우 실행 스크립트 (macOS start.sh 의 윈도우 버전)
# 백엔드(FastAPI :8000) + 프론트엔드(Vite :5173) 를 각각 새 PowerShell 창에서 기동한다.
# 실행: run-windows.bat 을 더블클릭  (또는)  powershell -ExecutionPolicy Bypass -File run-windows.ps1
$root = $PSScriptRoot
$vpy = Join-Path $root 'backend\venv\Scripts\python.exe'
$nodeDir = "$env:LOCALAPPDATA\Programs\nodejs"
$npm = Join-Path $nodeDir 'npm.cmd'

if (-not (Test-Path $vpy)) {
    Write-Host "[오류] backend\venv 가 없습니다. 백엔드 의존성을 먼저 설치하세요." -ForegroundColor Red
    Write-Host "  $vpy" -ForegroundColor DarkGray
    Read-Host "엔터로 종료"; exit 1
}
if (-not (Test-Path $npm)) { $npm = 'npm' }   # PATH 폴백

Write-Host "==== 모두봄 실행 ====" -ForegroundColor Cyan
Write-Host "  백엔드 Python : $vpy" -ForegroundColor DarkGray
Write-Host "  프론트 npm    : $npm" -ForegroundColor DarkGray

# 백엔드: UTF-8 강제(cp949 콘솔 크래시 방지) + 정부 RPA 는 설치된 Edge 사용
Write-Host "`n▶ 백엔드(:8000) 새 창에서 시작..." -ForegroundColor Green
$be = "`$env:PYTHONUTF8='1'; `$env:RPA_BROWSER_CHANNEL='msedge'; Set-Location '$root\backend'; & '$vpy' -m uvicorn main:app --host 127.0.0.1 --port 8000"
Start-Process powershell -ArgumentList '-NoExit','-NoProfile','-Command',$be

# 프론트: 포터블 node 를 PATH 에 얹고 vite dev
Write-Host "▶ 프론트엔드(:5173) 새 창에서 시작..." -ForegroundColor Green
$fe = "`$env:PATH='$nodeDir;' + `$env:PATH; Set-Location '$root\frontend'; & '$npm' run dev"
Start-Process powershell -ArgumentList '-NoExit','-NoProfile','-Command',$fe

Write-Host "▶ 8초 후 브라우저 오픈: http://localhost:5173" -ForegroundColor Green
Start-Sleep -Seconds 8
Start-Process 'http://localhost:5173'
Write-Host "`n두 개의 PowerShell 창에서 서버가 실행 중입니다. 종료: 각 창에서 Ctrl+C 후 닫기." -ForegroundColor Cyan
Write-Host "  · 서류 자동발급/자동신청 RPA 는 화면에 Edge 창이 떠서 진행됩니다(카카오 본인인증은 본인이 직접)." -ForegroundColor DarkCyan
