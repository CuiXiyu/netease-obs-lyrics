$ErrorActionPreference = "Stop"

$serviceUrl = "http://127.0.0.1:47863"

Write-Host "== NetEase OBS Lyrics health =="

try {
    $state = Invoke-RestMethod -Uri "$serviceUrl/state" -TimeoutSec 3
    Write-Host "Service: running"
} catch {
    Write-Host "Service: not running"
    Write-Host "Fix: run .\launch.ps1"
    $logPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "logs\service.log"
    if (Test-Path $logPath) {
        Write-Host ""
        Write-Host "Last service log lines:"
        Get-Content -LiteralPath $logPath -Tail 30 -ErrorAction SilentlyContinue | Write-Host
    }
    exit 1
}

$media = $state.media
$bridge = $state.bridge

Write-Host "OBS URL: $serviceUrl"
Write-Host "Bridge: $($bridge.status)"
Write-Host "Media source: $($media.source)"
Write-Host "Reliable progress: $($media.positionReliable)"
Write-Host "Progress source: $($media.progressSource)"
Write-Host "Title: $($media.title)"
Write-Host "Artist: $($media.artist)"

if ($bridge.status -ne "connected") {
    Write-Host ""
    Write-Host "Bridge is not connected."
    Write-Host "Fix:"
    Write-Host "1. Install BetterNCM."
    Write-Host "2. Import dist\netease-obs-lyrics-bridge.plugin in BetterNCM."
    Write-Host "3. Enable it and restart NetEase Cloud Music."
    exit 2
}

if (-not $media.positionReliable) {
    Write-Host ""
    Write-Host "No reliable playback progress is available."
    exit 3
}

Write-Host "Health: ok"
