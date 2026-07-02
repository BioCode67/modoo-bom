# 모두봄 — 로컬 에이전트 (배포 사이트 전용) 원클릭 실행
# ------------------------------------------------------------------
# 이 스크립트는 '백엔드(로컬 에이전트)만' 띄운다. 프론트는 배포 사이트를 그대로 쓴다:
#   https://biocode67.github.io/modoo-bom/
# 배포 사이트가 이 에이전트(localhost:8000)를 자동 감지해 서류 자동발급/자동신청을 활성화한다.
#
# 최초 실행 시 venv 생성 + 의존성 설치 + (Edge로 RPA) 를 자동 처리한다.
# 개인정보는 이 PC에서만 처리하고 서버로 보내지 않는다.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'backend'
$vpy = Join-Path $backend 'venv\Scripts\python.exe'
$SITE = 'https://biocode67.github.io/modoo-bom/'

function Find-Python {
    foreach ($c in @('py -3.11','py -3','python','python3')) {
        try { $p = $c.Split(' '); & $p[0] $p[1..($p.Length-1)] --version *> $null; if ($?) { return $c } } catch {}
    }
    return $null
}

Write-Host "==== 모두봄 로컬 에이전트 ====" -ForegroundColor Cyan

# 1) venv 없으면 자동 생성 + 설치
if (-not (Test-Path $vpy)) {
    Write-Host "[최초 설정] Python 가상환경을 만들고 의존성을 설치합니다 (수 분 소요)..." -ForegroundColor Yellow
    $py = Find-Python
    if (-not $py) {
        Write-Host "[오류] Python 3.11+ 이 필요합니다. https://www.python.org/downloads/ 에서 설치 후 다시 실행하세요." -ForegroundColor Red
        Read-Host "엔터로 종료"; exit 1
    }
    $pa = $py.Split(' ')
    & $pa[0] $pa[1..($pa.Length-1)] -m venv (Join-Path $backend 'venv')
    & $vpy -m pip install --upgrade pip
    & $vpy -m pip install -r (Join-Path $backend 'requirements.txt')
    Write-Host "[최초 설정] 브라우저 자동화(Playwright) 준비..." -ForegroundColor Yellow
    # 설치된 Edge 를 쓰면 별도 크로미움 다운로드 불필요. 실패 시 chromium 설치로 폴백.
    try { & $vpy -m playwright install msedge } catch { & $vpy -m playwright install chromium }
    Write-Host "[최초 설정] 완료!" -ForegroundColor Green
}

# 2) 로컬 에이전트 기동 (RPA 활성: 로컬이므로 rpa=true)
Write-Host "`n▶ 로컬 에이전트 시작 — http://localhost:8000" -ForegroundColor Green
Write-Host "  · 서류 자동발급/자동신청은 화면에 Edge 창이 떠서 진행됩니다." -ForegroundColor DarkCyan
Write-Host "  · 카카오/공동인증 본인인증과 최종 제출은 '본인이 직접' 하세요(안전장치)." -ForegroundColor DarkCyan
Write-Host "  · 개인정보는 이 PC에서만 처리되고 서버로 전송되지 않습니다.`n" -ForegroundColor DarkCyan

$env:PYTHONUTF8 = '1'                    # 한글 콘솔 크래시 방지
$env:RPA_BROWSER_CHANNEL = 'msedge'      # 설치된 Edge 사용
$env:RPA_ENABLED = '1'                   # 로컬 에이전트 = RPA 허용
# 배포 사이트(github.io)에서의 호출 허용 (main.py 기본 CORS + PNA 헤더로 통과)

# 3) 브라우저로 배포 사이트 열기 (크롬 권장 — localhost http 신뢰)
Write-Host "▶ 5초 후 배포 사이트를 엽니다: $SITE" -ForegroundColor Green
Start-Job { Start-Sleep 5; Start-Process $using:SITE } | Out-Null

Set-Location $backend
& $vpy -m uvicorn main:app --host 127.0.0.1 --port 8000
