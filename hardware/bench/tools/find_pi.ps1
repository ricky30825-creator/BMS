# 라즈베리파이 탐색. PowerShell 전용 (Git Bash 로는 ssh 가 안 된다 - CLAUDE.md 참조)
#   .\find_pi.ps1              현재 PC 서브넷을 스윕
#   .\find_pi.ps1 -Subnet 192.168.0     특정 서브넷 지정
param(
    [string]$Subnet = "",
    [string]$User   = "<USER>"
)

Write-Host "=== 1) mDNS ===" -ForegroundColor Cyan
$mdns = Resolve-DnsName <HOST> -ErrorAction SilentlyContinue
if ($mdns) {
    $ip = ($mdns | Where-Object { $_.IPAddress } | Select-Object -First 1).IPAddress
    Write-Host "  <HOST> -> $ip" -ForegroundColor Green
    Write-Host "`n  ssh -o BatchMode=yes $User@$ip 'hostname; uptime'"
    exit 0
}
Write-Host "  이름 해석 실패" -ForegroundColor Yellow

Write-Host "`n=== 2) ARP 캐시에서 라즈베리파이 OUI ===" -ForegroundColor Cyan
# d8-3a-dd = Pi 4/5, b8-27-eb / dc-a6-32 / e4-5f-01 / 2c-cf-67 = 구형 Pi
$oui = "d8-3a-dd|b8-27-eb|dc-a6-32|e4-5f-01|2c-cf-67"
$hit = arp -a | Select-String $oui
if ($hit) {
    Write-Host "  발견:" -ForegroundColor Green
    $hit | ForEach-Object { Write-Host "    $_" }
    exit 0
}
Write-Host "  ARP 캐시에 없음" -ForegroundColor Yellow

if (-not $Subnet) {
    $wifi = Get-NetIPAddress -AddressFamily IPv4 |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and
                           $_.InterfaceAlias -notlike '*WSL*' } |
            Select-Object -First 1
    if (-not $wifi) { Write-Host "활성 인터페이스를 못 찾음"; exit 1 }
    $Subnet = ($wifi.IPAddress -split '\.')[0..2] -join '.'
    Write-Host "`n  현재 인터페이스 $($wifi.InterfaceAlias) $($wifi.IPAddress)/$($wifi.PrefixLength)"
}

Write-Host "`n=== 3) $Subnet.0/24 핑 스윕 ===" -ForegroundColor Cyan
$jobs = 1..254 | ForEach-Object {
    Start-Job -ScriptBlock {
        param($i)
        if (Test-Connection -ComputerName $i -Count 1 -Quiet -ErrorAction SilentlyContinue) { $i }
    } -ArgumentList "$Subnet.$_"
}
$jobs | Wait-Job -Timeout 90 | Out-Null
$alive = $jobs | Receive-Job
$jobs | Remove-Job -Force

Write-Host "  응답 호스트 $($alive.Count) 개"
$alive | ForEach-Object { Write-Host "    $_" }

Write-Host "`n=== 4) 응답 호스트의 MAC 대조 ===" -ForegroundColor Cyan
$found = @()
foreach ($a in $alive) {
    $line = arp -a $a 2>$null | Select-String $a
    if ($line -and ($line -match $oui)) {
        Write-Host "  *** 라즈베리파이 후보: $a" -ForegroundColor Green
        $found += $a
    }
}
if (-not $found) {
    Write-Host "  라즈베리파이 OUI 없음 -- 파이가 이 망에 없다" -ForegroundColor Red
    Write-Host ""
    Write-Host "  다음을 확인할 것:"
    Write-Host "    - 파이 전원이 켜져 있는가 (초록 LED)"
    Write-Host "    - 파이가 아는 SSID 인가 (iptime_samsung7 / 핫스팟)"
    Write-Host "    - 랜선으로 같은 공유기에 꽂으면 가장 확실하다"
    exit 1
}

Write-Host "`n=== 5) SSH 확인 ===" -ForegroundColor Cyan
foreach ($a in $found) {
    Write-Host "  $a ..." -NoNewline
    $r = ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$User@$a" 'hostname' 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host " OK -> $r" -ForegroundColor Green
        Write-Host "`n  ssh -o BatchMode=yes $User@$a"
    } else {
        Write-Host " SSH 실패" -ForegroundColor Yellow
    }
}
