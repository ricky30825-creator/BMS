# 파이로 로거·점검 스크립트 배포. PowerShell 전용.
#   .\deploy_pi.ps1 -IP <LAN_IP>
#
# scp 로 보낸다 (파이프 stdin 은 한글·BOM 문제가 있다 - CLAUDE.md 참조).
param(
    [Parameter(Mandatory=$true)][string]$IP,
    [string]$User = "<USER>"
)

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$loggers = Join-Path (Split-Path -Parent $here) "라즈베리파이5테스트\discharge_20260809"

$files = @(
    (Join-Path $loggers "thermal_log_alarm.py"),
    (Join-Path $loggers "ina_log.py"),
    (Join-Path $loggers "mlx_fast_log.py"),
    (Join-Path $here    "preflight.py"),
    (Join-Path $here    "sensorwatch.py"),
    (Join-Path $here    "ina_check.py"),
    (Join-Path $loggers "thermal_log_bulk.py"),
    (Join-Path $here    "tempguard.py"),
    (Join-Path $here    "i2cstress.py"),
    (Join-Path $here    "tft_ili9488.py"),
    (Join-Path $here    "bench_display.py")
)

$missing = $files | Where-Object { -not (Test-Path $_) }
if ($missing) {
    Write-Host "로컬에 없는 파일:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  $_" }
    exit 1
}

Write-Host "=== 접속 확인 ===" -ForegroundColor Cyan
$h = ssh -o BatchMode=yes -o ConnectTimeout=5 "$User@$IP" 'hostname; uname -m' 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "SSH 실패 - find_pi.ps1 로 IP 를 다시 찾을 것" -ForegroundColor Red; exit 1 }
Write-Host "  $($h -join '  ')" -ForegroundColor Green

Write-Host "`n=== 배포 ===" -ForegroundColor Cyan
foreach ($f in $files) {
    $n = Split-Path -Leaf $f
    Write-Host ("  {0,-24}" -f $n) -NoNewline
    scp -q -o BatchMode=yes $f "${User}@${IP}:~/$n" 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Host "OK" -ForegroundColor Green }
    else { Write-Host "실패" -ForegroundColor Red }
}

Write-Host "`n=== 파이 쪽 확인 ===" -ForegroundColor Cyan
ssh -o BatchMode=yes "$User@$IP" 'ls -la ~/*.py | awk "{printf \"  %-26s %8s\n\", \$9, \$5}"'

Write-Host "`n다음:" -ForegroundColor Cyan
Write-Host "  ssh -o BatchMode=yes $User@$IP 'python3 ~/preflight.py PB20000_c1_10W'"
