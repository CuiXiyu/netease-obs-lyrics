$ErrorActionPreference = "Stop"

$connections = Get-NetTCPConnection -LocalPort 47863 -State Listen -ErrorAction SilentlyContinue
if (-not $connections) {
    Write-Host "OBS Lyrics service is not running."
    exit 0
}

$ownerPids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($ownerPid in $ownerPids) {
    try {
        Stop-Process -Id $ownerPid -Force -ErrorAction Stop
        Write-Host "Stopped process PID: $ownerPid"
    }
    catch {
        Write-Host "Failed to stop PID ${ownerPid}: $($_.Exception.Message)"
    }
}
