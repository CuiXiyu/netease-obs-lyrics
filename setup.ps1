param(
    [switch]$StartAfterSetup,
    [switch]$OpenBetterNcmPage,
    [switch]$OpenPages
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

Write-Host "== 网易云 OBS 歌词安装 =="

$nodeExe = & (Join-Path $projectRoot "scripts\ensure-node.ps1") -ProjectRoot $projectRoot
$nodeDir = Split-Path -Parent $nodeExe
$env:PATH = "$nodeDir;$env:PATH"

Write-Host "Node: $nodeExe"

if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
    Write-Host "正在安装 npm 依赖..."
    & $nodeExe (Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js") install
} else {
    Write-Host "npm 依赖已安装。"
}

& (Join-Path $projectRoot "scripts\build-betterncm-plugin.ps1")
$pluginPath = Join-Path $projectRoot "dist\netease-obs-lyrics-bridge.plugin"

$betterncm = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\find-betterncm.ps1") | ConvertFrom-Json
if (-not $betterncm.Installed -and (Test-Path (Join-Path $projectRoot "dist\BetterNCMII.dll"))) {
    Write-Host "未检测到 BetterNCM，正在尝试使用内置文件安装..."
    try {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\install-betterncm.ps1") | Write-Host
        $betterncm = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\find-betterncm.ps1") | ConvertFrom-Json
    } catch {
        Write-Host "内置 BetterNCM 安装失败："
        Write-Host $_.Exception.Message
    }
}

if ($betterncm.Installed -and $betterncm.PluginDirs.Count -gt 0) {
    $target = @($betterncm.PluginDirs)[0]
    Copy-Item -LiteralPath $pluginPath -Destination (Join-Path $target "netease-obs-lyrics-bridge.plugin") -Force
    Write-Host "BetterNCM 桥接插件已安装到："
    Write-Host $target
} else {
    Write-Host "未检测到 BetterNCM。"
    Write-Host "桥接插件已构建到："
    Write-Host $pluginPath
    Write-Host "请先安装 BetterNCM，然后在插件管理器中导入这个 .plugin 文件。"
    if ($OpenBetterNcmPage) {
        Start-Process "https://github.com/MicroCBer/BetterNCM"
    }
}

Write-Host ""
Write-Host "OBS 浏览器源地址："
Write-Host "http://127.0.0.1:47863"
Write-Host ""
Write-Host "运行 .\launch.ps1 可启动歌词服务。"

if ($StartAfterSetup) {
    & (Join-Path $projectRoot "launch.ps1") -OpenPages:$OpenPages
}
