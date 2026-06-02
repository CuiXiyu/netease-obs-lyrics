$ErrorActionPreference = "Stop"

$serviceUrl = "http://127.0.0.1:47863"

Write-Host "== 网易云 OBS 歌词状态检查 =="

try {
    $state = Invoke-RestMethod -Uri "$serviceUrl/state" -TimeoutSec 3
    Write-Host "服务：正在运行"
} catch {
    Write-Host "服务：未运行"
    Write-Host "处理方式：运行 .\launch.ps1"
    $logPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "logs\service.log"
    if (Test-Path $logPath) {
        Write-Host ""
        Write-Host "最近的服务日志："
        Get-Content -LiteralPath $logPath -Tail 30 -ErrorAction SilentlyContinue | Write-Host
    }
    exit 1
}

$media = $state.media
$bridge = $state.bridge

Write-Host "OBS 地址：$serviceUrl"
Write-Host "桥接状态：$($bridge.status)"
Write-Host "媒体来源：$($media.source)"
Write-Host "可靠进度：$($media.positionReliable)"
Write-Host "进度来源：$($media.progressSource)"
Write-Host "歌名：$($media.title)"
Write-Host "歌手：$($media.artist)"

if ($bridge.status -ne "connected") {
    Write-Host ""
    Write-Host "桥接未连接。"
    Write-Host "处理方式："
    Write-Host "1. 安装 BetterNCM。"
    Write-Host "2. 在 BetterNCM 中导入 dist\netease-obs-lyrics-bridge.plugin。"
    Write-Host "3. 启用插件并重启网易云音乐。"
    exit 2
}

if (-not $media.positionReliable) {
    Write-Host ""
    Write-Host "当前没有可靠播放进度。"
    exit 3
}

Write-Host "状态：正常"
