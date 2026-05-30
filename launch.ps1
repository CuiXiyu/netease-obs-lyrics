param(
    [switch]$Foreground,
    [switch]$OpenPages
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot
$serviceUrl = "http://127.0.0.1:47863"
$logPath = Join-Path $projectRoot "logs\service.log"
$stdoutPath = Join-Path $projectRoot "logs\service.stdout.log"
$stderrPath = Join-Path $projectRoot "logs\service.stderr.log"

function Wait-ServiceReady {
    param(
        [Parameter(Mandatory = $true)] [string]$Url,
        [Parameter(Mandatory = $false)] $Process,
        [int]$TimeoutSeconds = 12
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process -and $Process.HasExited) {
            return $false
        }

        try {
            Invoke-RestMethod -Uri "$Url/state" -TimeoutSec 1 | Out-Null
            return $true
        } catch {
            Start-Sleep -Milliseconds 300
        }
    }

    return $false
}

function Open-OverlayPages {
    Start-Process "$serviceUrl/?status=1"
    Start-Process "$serviceUrl/settings.html"
}

function Start-OverlayService {
    param(
        [Parameter(Mandatory = $true)] [string]$WorkingDirectory
    )

    $runnerPath = Join-Path $WorkingDirectory "scripts\run-service.ps1"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "powershell.exe"
    $psi.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`" -ProjectRoot `"$WorkingDirectory`""
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()
    return $process
}

$nodeExe = & (Join-Path $projectRoot "scripts\ensure-node.ps1") -ProjectRoot $projectRoot

if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
    & (Join-Path $projectRoot "setup.ps1")
}

$owners = Get-NetTCPConnection -LocalPort 47863 -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq "Listen" } |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($id in $owners) {
    if ($id -and $id -ne $PID) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
}

if ($Foreground) {
    if ($OpenPages) {
        Start-Job -ScriptBlock {
            param($Url)
            $deadline = (Get-Date).AddSeconds(12)
            while ((Get-Date) -lt $deadline) {
                try {
                    Invoke-RestMethod -Uri "$Url/state" -TimeoutSec 1 | Out-Null
                    Start-Process "$Url/?status=1"
                    Start-Process "$Url/settings.html"
                    return
                } catch {
                    Start-Sleep -Milliseconds 300
                }
            }
        } -ArgumentList $serviceUrl | Out-Null
    }
    & $nodeExe (Join-Path $projectRoot "server.js")
    exit $LASTEXITCODE
}

$logDir = Split-Path -Parent $logPath
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
"[$(Get-Date -Format o)] Starting NetEase OBS Lyrics service" | Out-File -LiteralPath $logPath -Encoding utf8 -Append
"[$(Get-Date -Format o)] Node: $nodeExe" | Out-File -LiteralPath $logPath -Encoding utf8 -Append

Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
$process = Start-OverlayService -WorkingDirectory $projectRoot

if (-not (Wait-ServiceReady -Url $serviceUrl -Process $process)) {
    if ($process.HasExited) {
        "[$(Get-Date -Format o)] Service exited with code $($process.ExitCode)" | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    } else {
        "[$(Get-Date -Format o)] Service did not become ready before timeout." | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    }
    if (Test-Path $stdoutPath) {
        Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    }
    if (Test-Path $stderrPath) {
        Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    }

    Write-Output "NetEase OBS Lyrics service failed to start or did not become ready."
    Write-Output "Try running: .\launch.ps1 -Foreground"
    Write-Output "Service log: $logPath"
    if (Test-Path $logPath) {
        Write-Output ""
        Get-Content -LiteralPath $logPath -Tail 40 -ErrorAction SilentlyContinue | Write-Output
    }
    exit 4
}

Write-Output "NetEase OBS Lyrics service started. PID: $($process.Id)"
Write-Output "OBS Browser Source URL: $serviceUrl"
Write-Output "Test page: $serviceUrl/?status=1"
Write-Output "Settings page: $serviceUrl/settings.html"
Write-Output "Run .\health.ps1 to check bridge status."

if ($OpenPages) {
    Open-OverlayPages
}
