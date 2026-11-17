# 以管理员身份执行：把数据库从「用户态实例」切回 Windows 服务托管（方案 A）
#
# 用法：在【管理员】PowerShell 里运行
#   powershell -NoProfile -ExecutionPolicy Bypass -File "D:\workbuddy\2026-10-24-13-13-23\stray-star\scripts\start-db-service.ps1"
#
# 背景：主进程没有管理员权限（`net start` 返回"系统错误 5 拒绝访问"），
# 且安全策略禁止从非提权进程拉起提权子进程，所以这一步必须由人来点一次。
$ErrorActionPreference = 'Stop'
$dataDir = 'C:\Program Files\PostgreSQL\16\data'
$logFile = 'D:\workbuddy\2026-10-24-13-13-23\_svcresult.txt'

function Write-Result([string]$text) {
  try { Set-Content -Path $logFile -Value $text -Encoding UTF8 } catch { }
  Write-Host $text
}

try {
  # 1) 停掉免管理员的兜底计划任务（它会持有数据目录，服务抢不到）
  Stop-ScheduledTask -TaskName 'stray-star-postgres' -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2

  # 2) 若还有临时 postmaster 占着目录，一并停掉
  $pidFile = Join-Path $dataDir 'postmaster.pid'
  if (Test-Path $pidFile) {
    $postmasterPid = (Get-Content $pidFile -TotalCount 1).Trim()
    Stop-Process -Id $postmasterPid -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 15; $i++) {
      Start-Sleep -Seconds 1
      if (-not (Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)) { break }
    }
  }

  # 3) 交给 SCM 托管
  Start-Service -Name 'postgresql-x64-16'
  Start-Sleep -Seconds 5

  $svc = Get-Service 'postgresql-x64-16'
  Write-Result ("OK status=" + $svc.Status)

  # 4) 任务已无用，删掉，避免下次开机和服务抢数据目录
  Unregister-ScheduledTask -TaskName 'stray-star-postgres' -Confirm:$false -ErrorAction SilentlyContinue
}
catch {
  Write-Result ("FAIL " + $_.Exception.Message)
}
