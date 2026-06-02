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
"[$(Get-Date -Format o)] 正在启动网易云 OBS 歌词服务" | Out-File -LiteralPath $logPath -Encoding utf8
"[$(Get-Date -Format o)] Node: $nodeExe" | Out-File -LiteralPath $logPath -Encoding utf8 -Append

Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
$process = Start-OverlayService -WorkingDirectory $projectRoot

if (-not (Wait-ServiceReady -Url $serviceUrl -Process $process)) {
    if ($process.HasExited) {
        "[$(Get-Date -Format o)] 服务已退出，退出码：$($process.ExitCode)" | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    } else {
        "[$(Get-Date -Format o)] 服务在超时时间内未就绪。" | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    }
    if (Test-Path $stdoutPath) {
        Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    }
    if (Test-Path $stderrPath) {
        Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    }

    Write-Output "网易云 OBS 歌词服务启动失败或未就绪。"
    Write-Output "可尝试运行：.\launch.ps1 -Foreground"
    Write-Output "服务日志：$logPath"
    if (Test-Path $logPath) {
        Write-Output ""
        Get-Content -LiteralPath $logPath -Tail 40 -ErrorAction SilentlyContinue | Write-Output
    }
    exit 4
}

Write-Output "网易云 OBS 歌词服务已启动。PID：$($process.Id)"
Write-Output "OBS 浏览器源地址：$serviceUrl"
Write-Output "测试页面：$serviceUrl/?status=1"
Write-Output "设置页面：$serviceUrl/settings.html"
Write-Output "运行 .\health.ps1 可检查桥接状态。"

if ($OpenPages) {
    Open-OverlayPages
}
