# 모두봄 복지 에이전트 — 크롬 웹스토어 제출용 zip 빌드
# 실행: powershell -ExecutionPolicy Bypass -File extension\build.ps1
# 산출물: extension\dist\modoo-agent-<version>.zip  (런타임 파일만 포함, 개발용 파일 제외)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# 버전 읽기
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version

# 웹스토어에 올릴 런타임 파일(개발/문서 파일 제외)
$include = @('manifest.json','background.js','automation.js','bridge.js','popup.html','popup.js','icon128.png')
$staging = Join-Path $env:TEMP ("modoo-agent-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $staging | Out-Null
foreach ($f in $include) {
    $src = Join-Path $root $f
    if (Test-Path $src) { Copy-Item $src -Destination $staging } else { Write-Host "[경고] 누락: $f" -ForegroundColor Yellow }
}

$zip = Join-Path $dist ("modoo-agent-$version.zip")
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -Force
Remove-Item $staging -Recurse -Force

$size = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host "✅ 빌드 완료: $zip ($size KB)" -ForegroundColor Green
Write-Host "   크롬 웹스토어 개발자 대시보드(https://chrome.google.com/webstore/devconsole)에 이 zip을 업로드하세요." -ForegroundColor Cyan
