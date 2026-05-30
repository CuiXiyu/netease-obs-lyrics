@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\setup.ps1" -StartAfterSetup -OpenBetterNcmPage -OpenPages
pause
