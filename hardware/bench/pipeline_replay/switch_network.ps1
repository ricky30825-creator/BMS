# switch_network.ps1 — 망이 바뀌었을 때 파이프라인을 새 IP 로 맞춘다.
#
#     powershell -ExecutionPolicy Bypass -File .\switch_network.ps1
#
# 집 WiFi 에서 동방 핫스팟으로 옮기면 PC 와 파이의 IP 가 **둘 다** 바뀐다.
# Kafka 는 광고 주소(advertised listener)에 적힌 IP 로 클라이언트를 되돌려 보내므로,
# 그 값이 옛 IP 로 남아 있으면 파이가 브로커를 찾아놓고도 붙지 못한다.
#
# 이 스크립트가 하는 일:
#   1) PC 의 현재 IPv4 를 찾는다 (기본 게이트웨이가 있는 인터페이스만)
#   2) compose.yaml 의 광고 주소를 그 IP 로 고친다
#   3) Kafka 를 재기동한다
#   4) 라즈베리파이를 찾는다 (mDNS → ARP OUI → SSH 확인)
#   5) 그대로 붙여 넣을 명령을 출력한다
#
# 읽기 전용이 아니다 — compose.yaml 을 고치고 컨테이너를 재기동한다.

# 네이티브 명령(docker/ssh/arp)의 stderr 를 5.1 이 오류 레코드로 감싸기 때문에
# "Stop" 을 쓰면 정상 출력에도 스크립트가 죽는다. 검사는 아래에서 명시적으로 한다.
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$compose = Join-Path $here "compose.yaml"

function Line { param($c = "=") Write-Host ($c * 70) }

Line
Write-Host " CellGuard — 망 전환" -ForegroundColor Cyan
Line

# ── 1. PC 의 IPv4 ────────────────────────────────────────────────────────
# WSL 가상 어댑터(172.x)와 APIPA(169.254.x)를 걸러내야 한다. 기본 게이트웨이가
# 있는 인터페이스만 실제 망에 붙어 있는 것이다.
$gw = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
      Sort-Object RouteMetric | Select-Object -First 1
if (-not $gw) { Write-Host "!! 기본 게이트웨이가 없다 - 망에 안 붙어 있다." -ForegroundColor Red; exit 1 }

$ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $gw.ifIndex |
       Where-Object { $_.IPAddress -notlike "169.254.*" } |
       Select-Object -First 1).IPAddress
$ifName = (Get-NetAdapter -InterfaceIndex $gw.ifIndex).Name
$netprof = (Get-NetConnectionProfile -InterfaceIndex $gw.ifIndex -ErrorAction SilentlyContinue)

Write-Host ""
Write-Host " PC IP     : $ip   ($ifName)" -ForegroundColor Green
if ($netprof) {
    Write-Host " 망        : $($netprof.Name)   [$($netprof.NetworkCategory)]"
    # Docker Desktop 의 인바운드 허용 규칙은 Public 프로필에 걸려 있다.
    # 핫스팟도 Public 으로 분류되므로 보통 그대로 통한다.
    if ($netprof.NetworkCategory -eq "Private") {
        Write-Host "   ! 이 망이 Private 로 분류됐다. Docker 방화벽 규칙은 Public 에만" -ForegroundColor Yellow
        Write-Host "     걸려 있으므로 파이가 9092 에 못 붙으면 이것부터 의심할 것." -ForegroundColor Yellow
    }
}

# ── 2. compose.yaml ──────────────────────────────────────────────────────
# PS 5.1 의 Get-Content 는 BOM 없는 파일을 시스템 ANSI(cp949) 로 읽는다.
# 그대로 다시 쓰면 한글 주석이 깨지고 줄바꿈까지 뭉개져 YAML 이 부서진다
# (2026-09-04 에 실제로 한 번 깨뜨렸다). .NET 으로 인코딩을 명시한다.
$text = [System.IO.File]::ReadAllText($compose, [System.Text.Encoding]::UTF8)
$m = [regex]::Match($text, 'PLAINTEXT_HOST://([0-9]{1,3}(?:\.[0-9]{1,3}){3}):9092')
if (-not $m.Success) {
    Write-Host "!! compose.yaml 에서 광고 주소를 못 찾았다." -ForegroundColor Red; exit 1
}
$old = $m.Groups[1].Value

Write-Host ""
if ($old -eq $ip) {
    Write-Host " 광고 주소 : $old  (이미 맞다)" -ForegroundColor Green
    $changed = $false
} else {
    Write-Host " 광고 주소 : $old  ->  $ip" -ForegroundColor Yellow
    $bak = "$compose.bak_" + (Get-Date -Format "yyyyMMdd_HHmmss")
    Copy-Item $compose $bak
    $new = $text -replace [regex]::Escape("PLAINTEXT_HOST://${old}:9092"), "PLAINTEXT_HOST://${ip}:9092"
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($compose, $new, $utf8NoBom)
    Write-Host "   백업: $(Split-Path -Leaf $bak)"
    $changed = $true
}

# ── 3. 스택 ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host " Docker 스택 기동 중..."
Push-Location $here
try {
    # 광고 주소가 바뀌었으면 컨테이너를 다시 만들어야 환경변수가 반영된다.
    docker compose config --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Host "!! compose.yaml 이 깨졌다. 백업에서 되돌릴 것:" -ForegroundColor Red
        Write-Host "   Copy-Item $bak compose.yaml -Force"
        exit 1
    }
    docker compose up -d | Out-Null
    $ps = docker compose ps
} finally { Pop-Location }
Write-Host $ps

# ── 4. 파이 찾기 ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host " 라즈베리파이 탐색..."
$pi = $null

# (a) mDNS — avahi 가 깔려 있어 보통 이걸로 끝난다
try {
    $r = Resolve-DnsName "<HOST>" -Type A -ErrorAction Stop
    $pi = ($r | Where-Object { $_.IPAddress -and $_.IPAddress -notlike "*:*" } |
           Select-Object -First 1).IPAddress
    if ($pi) { Write-Host "   mDNS: $pi" -ForegroundColor Green }
} catch { Write-Host "   mDNS 실패 - 핑 스윕으로 넘어간다" }

# (b) ARP 캐시에 라즈베리파이 OUI 가 이미 있는지 (스윕보다 훨씬 빠르다)
if (-not $pi) {
    $base = ($ip -split '\.')[0..2] -join '.'
    $oui = "d8-3a-dd|b8-27-eb|dc-a6-32|e4-5f-01|2c-cf-67"
    $hits = arp -a | Select-String $oui | Select-String ([regex]::Escape($base))
    foreach ($h in $hits) {
        if ($h -match "($([regex]::Escape($base))\.\d{1,3})") {
            $cand = $Matches[1]
            $out = ssh -o BatchMode=yes -o ConnectTimeout=4 -o StrictHostKeyChecking=accept-new "<USER>@$cand" hostname 2>$null
            if ($out -match "<HOST>") { $pi = $cand; Write-Host "   ARP+SSH: $pi" -ForegroundColor Green; break }
        }
    }
}

# (c) 핑 스윕은 검증된 find_pi.ps1 에 맡긴다 (Start-Job 기반이라 PS 5.1 에서도 돈다)
if (-not $pi) {
    $finder = "C:\Users\<USER>\Desktop\방전분석_공용\find_pi.ps1"
    if (Test-Path $finder) {
        Write-Host "   ARP 에 없다 - find_pi.ps1 로 서브넷 스윕 (1~2분)..."
        & $finder -Subnet $base
    } else {
        Write-Host "   find_pi.ps1 을 못 찾았다: $finder" -ForegroundColor Yellow
    }
}

Line
if (-not $pi) {
    Write-Host " 파이를 못 찾았다." -ForegroundColor Red
    Write-Host ""
    Write-Host " 확인 순서:"
    Write-Host "   1) 파이가 이 망에 붙었나 - 등록된 SSID 는 iptime_samsung7 / Amsterdam16 뿐이다"
    Write-Host "   2) 핫스팟 이름이 그 둘과 다르면 파이는 어느 망에도 못 붙는다"
    Write-Host "      (헤드리스라 그 상태에서는 되살릴 방법이 없다 - 집에서 미리 등록할 것)"
    Write-Host "   3) 핫스팟의 '기기 간 연결 허용'(AP isolation) 이 꺼져 있지 않은지"
    exit 1
}

# ── 5. 붙여 넣을 명령 ────────────────────────────────────────────────────
Write-Host " 준비 완료" -ForegroundColor Green
Line
Write-Host ""
Write-Host " PC IP  : $ip"
Write-Host " 파이   : $pi"
Write-Host ""
Write-Host " [1] 컨슈머 (PC)" -ForegroundColor Cyan
Write-Host "   python consumer_v2.py --broker ${ip}:9092 --live-run LIVE_DEMO --batch 1 --idle 0 --group live-demo"
Write-Host ""
Write-Host " [2] 라이브 뷰 (PC)" -ForegroundColor Cyan
Write-Host "   python live_view.py --port 8080          ->  http://localhost:8080"
Write-Host ""
Write-Host " [3] 프로듀서 (파이)" -ForegroundColor Cyan
Write-Host "   ssh <USER>@$pi"
Write-Host "   python3 ~/sensors_kafka.py --broker ${ip}:9092 --run-id LIVE_DEMO --interval 1"
Write-Host ""
Line
