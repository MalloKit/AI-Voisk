# 점주 웹 개발용: 서버(8001)와 점주 웹(8081)을 새 PowerShell 창 두 개로 함께 켠다.
# Windows PowerShell 5.1은 BOM 없는 UTF-8의 한글을 깨뜨리므로 이 파일은 UTF-8 BOM으로 저장한다.

$ownerWebDir = $PSScriptRoot
$serverDir = Join-Path (Split-Path -Parent $PSScriptRoot) "server"
$ports = @(
  @{ Port = 8001; Usage = "서버" },
  @{ Port = 8081; Usage = "점주 웹" }
)

# 실행 전에 막히는 원인을 모두 모아 한 번에 보여 준다.
$problems = @()

# 있는지만 확인한다. 비밀번호가 들어 있으므로 내용은 읽거나 출력하지 않는다.
if (-not (Test-Path -LiteralPath (Join-Path $serverDir ".env") -PathType Leaf)) {
  $problems += @(
    "server/.env가 없습니다. server 폴더에 .env를 만든 뒤 다시 실행해 주세요.",
    "  필요한 설정: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD (값은 팀에서 받습니다)",
    "  점주 웹 허용 출처 설정: server/OWNER_API.md의 ADMIN_AUTH_ALLOWED_ORIGINS"
  )
}

foreach ($entry in $ports) {
  $listeners = @(Get-NetTCPConnection -LocalPort $entry.Port -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { continue }
  $problems += "$($entry.Port) 포트($($entry.Usage))를 이미 쓰고 있습니다. 해당 프로그램을 끈 뒤 다시 실행해 주세요."
  foreach ($processId in @($listeners.OwningProcess | Sort-Object -Unique)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    if ($process) {
      $problems += "  $($process.Name) (PID $processId): $($process.CommandLine)"
    } else {
      $problems += "  PID $processId (프로그램 정보를 확인하지 못했습니다)"
    }
  }
}

if ($problems.Count -gt 0) {
  $problems | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
  Write-Host "아무것도 실행하지 않고 멈췄습니다." -ForegroundColor Yellow
  exit 1
}

# 창이 닫히지 않게 -NoExit로 띄워 로그와 오류를 볼 수 있게 한다.
# npm.ps1은 실행 정책에 막힐 수 있으므로 npm.cmd를 부른다.
Start-Process powershell.exe -WorkingDirectory $serverDir -ArgumentList "-NoExit -Command `"& '.\.venv\Scripts\python.exe' -m uvicorn main:app --host 127.0.0.1 --port 8001 --workers 1`""
Start-Process powershell.exe -WorkingDirectory $ownerWebDir -ArgumentList "-NoExit -Command `"npm.cmd run dev`""

Write-Host "서버와 점주 웹 창을 띄웠습니다."
Write-Host "  서버: http://127.0.0.1:8001"
Write-Host "  점주 웹: http://127.0.0.1:8081"
Write-Host "끄려면 각 창에서 Ctrl+C를 누르거나 창을 닫습니다."
exit 0
