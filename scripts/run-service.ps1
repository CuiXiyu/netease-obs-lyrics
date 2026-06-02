param(
    [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$ErrorActionPreference = "Stop"

Set-Location $ProjectRoot

$logDir = Join-Path $ProjectRoot "logs"
$logPath = Join-Path $logDir "service.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

"[$(Get-Date -Format o)] 正在启动网易云 OBS 歌词服务" | Out-File -LiteralPath $logPath -Encoding utf8 -Append

try {
    $nodeExe = & (Join-Path $ProjectRoot "scripts\ensure-node.ps1") -ProjectRoot $ProjectRoot
    $nodeDir = Split-Path -Parent $nodeExe
    $env:PATH = "$nodeDir;$env:PATH"

    "[$(Get-Date -Format o)] Node: $nodeExe" | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    $serverPath = Join-Path $ProjectRoot "server.js"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $nodeExe
    $psi.Arguments = "`"$serverPath`""
    $psi.WorkingDirectory = $ProjectRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    $logLine = [System.Diagnostics.DataReceivedEventHandler]{
        param($sender, $event)
        if ($null -ne $event.Data) {
            $event.Data | Out-File -LiteralPath $logPath -Encoding utf8 -Append
        }
    }
    $process.add_OutputDataReceived($logLine)
    $process.add_ErrorDataReceived($logLine)

    [void]$process.Start()
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    $process.WaitForExit()
    $exitCode = $process.ExitCode
    "[$(Get-Date -Format o)] 服务已退出，退出码：$exitCode" | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    exit $exitCode
} catch {
    "[$(Get-Date -Format o)] 严重错误：" | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    ($_ | Out-String) | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    exit 1
}
