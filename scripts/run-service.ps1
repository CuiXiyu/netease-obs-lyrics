param(
    [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$ErrorActionPreference = "Stop"

Set-Location $ProjectRoot

$logDir = Join-Path $ProjectRoot "logs"
$logPath = Join-Path $logDir "service.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

"[$(Get-Date -Format o)] Starting NetEase OBS Lyrics service" | Out-File -LiteralPath $logPath -Encoding utf8 -Append

try {
    $nodeExe = & (Join-Path $ProjectRoot "scripts\ensure-node.ps1") -ProjectRoot $ProjectRoot
    $nodeDir = Split-Path -Parent $nodeExe
    $env:PATH = "$nodeDir;$env:PATH"

    "[$(Get-Date -Format o)] Node: $nodeExe" | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    & $nodeExe (Join-Path $ProjectRoot "server.js") *>> $logPath
    $exitCode = $LASTEXITCODE
    "[$(Get-Date -Format o)] Service exited with code $exitCode" | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    exit $exitCode
} catch {
    "[$(Get-Date -Format o)] Fatal error:" | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    ($_ | Out-String) | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    exit 1
}
