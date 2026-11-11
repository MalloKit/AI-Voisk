# AI 보이스크 시연 실행: 노트북 하나로 서버(8001)와 회사 관리자 웹(8080)·점주 웹(8081)을 함께 켭니다.
# 같은 Wi-Fi의 갤럭시 탭은 이 노트북의 8001 포트로 접속합니다. 끌 때는 이 창에서 Ctrl+C를 누르거나 창을 닫습니다.
# Windows PowerShell 5.1은 BOM 없는 UTF-8의 한글을 깨뜨리므로 이 파일은 UTF-8 BOM으로 저장합니다.
#
# 옵션
#   -Backend api|claude_cli  음성 해석 방식(기본 api: server/.env의 ANTHROPIC_API_KEY 사용).
#                            claude_cli는 이 노트북에 로그인된 Claude Code 구독으로 시험할 때만 씁니다.
#   -NoBrowser               대시보드를 브라우저로 자동으로 열지 않습니다.
#   -NoWeb                   서버만 켭니다(대시보드 없이).
#   -Rebuild                 두 웹을 다시 빌드합니다(코드를 받은 뒤 처음 실행할 때는 자동으로 빌드합니다).
param(
  [ValidateSet("api", "claude_cli")] [string] $Backend = "api",
  [switch] $NoBrowser,
  [switch] $NoWeb,
  [switch] $Rebuild
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$server = Join-Path $root "server"
$webs = @(
  @{ Name = "회사 관리자 웹"; Dir = Join-Path $root "company_admin_web"; Port = 8080 },
  @{ Name = "점주 웹"; Dir = Join-Path $root "owner_web"; Port = 8081 }
)
if ($NoWeb) { $webs = @() }

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }

# ---------- 1. 실행 전 확인: 막히는 원인을 모두 모아 한 번에 보여 줍니다 ----------
$problems = @()
$envFile = Join-Path $server ".env"
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
  $problems += "server/.env가 없습니다. DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD를 넣은 server/.env를 만들어 주세요(값은 팀에서 받습니다)."
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  $problems += "Python이 없습니다. Python 3.14를 설치해 주세요."
}
if ($webs.Count -gt 0 -and -not (Get-Command npm -ErrorAction SilentlyContinue)) {
  $problems += "Node.js(npm)가 없습니다. Node.js 22.12 이상을 설치하거나 -NoWeb으로 서버만 켜 주세요."
}
$ports = @(8001) + @($webs | ForEach-Object { $_.Port })
foreach ($port in $ports) {
  $busy = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  if ($busy.Count -gt 0) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($busy[0].OwningProcess)" -ErrorAction SilentlyContinue
    $problems += "$port 포트를 이미 쓰고 있습니다($($owner.Name), PID $($busy[0].OwningProcess)). 이전에 켠 시연을 끄고 다시 실행해 주세요."
  }
}
if ($problems.Count -gt 0) {
  $problems | ForEach-Object { Say $_ "Yellow" }
  Say "아무것도 실행하지 않고 멈췄습니다." "Yellow"
  exit 1
}

# 키는 값이 아니라 있는지만 확인합니다(출력하지 않음).
if ($Backend -eq "api" -and -not (Select-String -LiteralPath $envFile -Pattern '^\s*ANTHROPIC_API_KEY\s*=\s*\S' -Quiet)) {
  Say "server/.env에 ANTHROPIC_API_KEY가 없습니다. 터치 주문은 되지만 음성 주문은 '화면으로 주문해 주세요'로 안내됩니다." "Yellow"
}

# ---------- 2. 처음 한 번만: 파이썬 가상 환경, 웹 패키지·빌드 ----------
$python = Join-Path $server ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
  Say "서버 가상 환경을 만들고 패키지를 설치합니다(처음 한 번, 1~2분)." "Cyan"
  & python -m venv (Join-Path $server ".venv")
  & $python -m pip install --disable-pip-version-check -q -r (Join-Path $server "requirements.txt")
  if ($LASTEXITCODE -ne 0) { Say "서버 패키지 설치에 실패했습니다." "Red"; exit 1 }
}

function Needs-Build($dir) {
  $dist = Join-Path $dir "dist\index.html"
  if ($Rebuild -or -not (Test-Path -LiteralPath $dist)) { return $true }
  $built = (Get-Item -LiteralPath $dist).LastWriteTime
  $newest = Get-ChildItem -LiteralPath (Join-Path $dir "src") -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  return ($newest -and $newest.LastWriteTime -gt $built)
}

foreach ($web in $webs) {
  if (-not (Test-Path -LiteralPath (Join-Path $web.Dir "node_modules"))) {
    Say "$($web.Name) 패키지를 설치합니다(처음 한 번)." "Cyan"
    Push-Location $web.Dir; & npm.cmd install --no-audit --no-fund; $code = $LASTEXITCODE; Pop-Location
    if ($code -ne 0) { Say "$($web.Name) 패키지 설치에 실패했습니다." "Red"; exit 1 }
  }
  if (Needs-Build $web.Dir) {
    Say "$($web.Name)을 빌드합니다." "Cyan"
    Push-Location $web.Dir; & npm.cmd run build; $code = $LASTEXITCODE; Pop-Location
    if ($code -ne 0) { Say "$($web.Name) 빌드에 실패했습니다." "Red"; exit 1 }
  }
}

# ---------- 3. 실행 ----------
# 이 창에서 켠 프로세스에만 적용되는 설정입니다. server/.env보다 우선합니다(.env는 바꾸지 않음).
$env:ADMIN_AUTH_ALLOWED_ORIGINS = "http://localhost:8080,http://127.0.0.1:8080,http://localhost:8081,http://127.0.0.1:8081"
$env:KIOSK_SAVE_DEMO_PAYMENTS = "1"   # 시연 카드·네이버페이 결제를 주문으로 저장
$env:KIOSK_SAVE_CASH_ORDERS = "1"     # 현금 주문 저장
$env:VOICE_LLM_BACKEND = $Backend

$started = @()
function Stop-All {
  foreach ($p in $script:started) {
    if ($p -and -not $p.HasExited) {
      # npm은 node 자식 프로세스를 두므로 프로세스 트리째 끕니다.
      & taskkill.exe /PID $p.Id /T /F *> $null
    }
  }
}

try {
  Say "서버를 켭니다(모든 네트워크 주소의 8001 포트)." "Cyan"
  $started += Start-Process -FilePath $python -WorkingDirectory $server -NoNewWindow -PassThru `
    -ArgumentList @("-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--no-access-log")
  foreach ($web in $webs) {
    $started += Start-Process -FilePath "npm.cmd" -WorkingDirectory $web.Dir -NoNewWindow -PassThru -ArgumentList @("run", "preview")
  }

  # 준비될 때까지 기다립니다(최대 60초).
  $targets = @("http://127.0.0.1:8001/health") + @($webs | ForEach-Object { "http://127.0.0.1:$($_.Port)/" })
  $deadline = (Get-Date).AddSeconds(60)
  foreach ($url in $targets) {
    $ok = $false
    while (-not $ok -and (Get-Date) -lt $deadline) {
      try { $null = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3; $ok = $true } catch { Start-Sleep -Milliseconds 700 }
    }
    if (-not $ok) { throw "$url 이 60초 안에 응답하지 않았습니다. 위의 오류 메시지를 확인해 주세요." }
  }

  # 태블릿이 접속할 주소(같은 Wi-Fi의 이 노트북 IPv4).
  $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
      $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.InterfaceAlias -notmatch "vEthernet|Loopback|VirtualBox|VMware|WSL"
    } | Sort-Object { if ($_.InterfaceAlias -match "Wi-?Fi|무선") { 0 } else { 1 } } | Select-Object -ExpandProperty IPAddress)

  Say ""
  Say "================ AI 보이스크 시연 준비 완료 ================" "Green"
  if ($webs.Count -gt 0) {
    Say "  회사 관리자 웹 : http://127.0.0.1:8080  (기기 토큰 발급, 매장·점주·기기 관리)" "Green"
    Say "  점주 웹        : http://127.0.0.1:8081  (메뉴·사진·AI 추천 설정·주문·통계·직원 호출)" "Green"
  }
  Say "  서버           : http://127.0.0.1:8001/docs" "Green"
  if ($ips.Count -gt 0) {
    foreach ($ip in $ips) { Say "  태블릿 서버 주소 : http://${ip}:8001" "Green" }
  } else {
    Say "  태블릿 서버 주소 : 이 노트북이 Wi-Fi에 연결되어 있지 않습니다." "Yellow"
  }
  Say "  음성 해석       : $Backend" "Green"
  Say "  끄기            : 이 창에서 Ctrl+C" "Green"
  Say "============================================================" "Green"

  # 방화벽에 8001 허용 규칙이 없으면 관리자 PowerShell에서 실행할 명령을 알려 줍니다(자동으로 바꾸지 않음).
  $rule = Get-NetFirewallRule -DisplayName "AI-Voisk 8001" -ErrorAction SilentlyContinue
  if (-not $rule) {
    Say ""
    Say "태블릿이 접속하지 못하면 '관리자 권한 PowerShell'에서 한 번만 실행해 주세요(개인 네트워크에만 허용):" "Yellow"
    Say '  New-NetFirewallRule -DisplayName "AI-Voisk 8001" -Direction Inbound -Protocol TCP -LocalPort 8001 -Action Allow -Profile Private' "Yellow"
    Say "  Wi-Fi 네트워크 프로필이 '공용'이면 설정 > 네트워크 > Wi-Fi > 속성에서 '개인'으로 바꿔 주세요." "Yellow"
  }

  if (-not $NoBrowser) {
    foreach ($web in $webs) { Start-Process "http://127.0.0.1:$($web.Port)/" }
  }

  # 하나라도 꺼지면 나머지도 끕니다.
  while ($true) {
    $dead = @($started | Where-Object { $_.HasExited })
    if ($dead.Count -gt 0) { throw "실행 중이던 프로그램 하나가 종료되어 전체를 끕니다. 위의 메시지를 확인해 주세요." }
    Start-Sleep -Seconds 1
  }
} catch {
  Say $_.Exception.Message "Red"
} finally {
  Stop-All
  Say "시연 서버를 모두 껐습니다." "Cyan"
}
