param(
    [switch]$StartAfterSetup,
    [switch]$OpenBetterNcmPage,
    [switch]$OpenPages
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

Write-Host "== NetEase OBS Lyrics setup =="

$nodeExe = & (Join-Path $projectRoot "scripts\ensure-node.ps1") -ProjectRoot $projectRoot
$nodeDir = Split-Path -Parent $nodeExe
$env:PATH = "$nodeDir;$env:PATH"

Write-Host "Node: $nodeExe"

if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
    Write-Host "Installing npm dependencies..."
    & $nodeExe (Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js") install
} else {
    Write-Host "npm dependencies already installed."
}

& (Join-Path $projectRoot "scripts\build-betterncm-plugin.ps1")
$pluginPath = Join-Path $projectRoot "dist\netease-obs-lyrics-bridge.plugin"

$betterncm = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\find-betterncm.ps1") | ConvertFrom-Json
if (-not $betterncm.Installed -and (Test-Path (Join-Path $projectRoot "dist\BetterNCMII.dll"))) {
    Write-Host "BetterNCM was not detected. Trying bundled BetterNCM install..."
    try {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\install-betterncm.ps1") | Write-Host
        $betterncm = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\find-betterncm.ps1") | ConvertFrom-Json
    } catch {
        Write-Host "Bundled BetterNCM install failed:"
        Write-Host $_.Exception.Message
    }
}

if ($betterncm.Installed -and $betterncm.PluginDirs.Count -gt 0) {
    $target = @($betterncm.PluginDirs)[0]
    Copy-Item -LiteralPath $pluginPath -Destination (Join-Path $target "netease-obs-lyrics-bridge.plugin") -Force
    Write-Host "BetterNCM bridge plugin installed to:"
    Write-Host $target
} else {
    Write-Host "BetterNCM was not detected."
    Write-Host "Bridge plugin built here:"
    Write-Host $pluginPath
    Write-Host "Install BetterNCM, then import this .plugin file in its plugin manager."
    if ($OpenBetterNcmPage) {
        Start-Process "https://github.com/MicroCBer/BetterNCM"
    }
}

Write-Host ""
Write-Host "OBS Browser Source URL:"
Write-Host "http://127.0.0.1:47863"
Write-Host ""
Write-Host "Run .\launch.ps1 to start the overlay service."

if ($StartAfterSetup) {
    & (Join-Path $projectRoot "launch.ps1") -OpenPages:$OpenPages
}
