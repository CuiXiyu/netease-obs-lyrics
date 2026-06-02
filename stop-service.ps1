$ErrorActionPreference = "Stop"

$connections = Get-NetTCPConnection -LocalPort 47863 -State Listen -ErrorAction SilentlyContinue
if (-not $connections) {
    Write-Host "OBS 歌词服务未运行。"
    exit 0
}

$ownerPids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($ownerPid in $ownerPids) {
    try {
        Stop-Process -Id $ownerPid -Force -ErrorAction Stop
        Write-Host "已停止进程 PID：$ownerPid"
    }
    catch {
        Write-Host "停止 PID ${ownerPid} 失败：$($_.Exception.Message)"
    }
}
