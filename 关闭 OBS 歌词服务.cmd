@echo off
chcp 65001 >nul
title 关闭 OBS 歌词服务
cd /d "%~dp0"

echo == 关闭 OBS 歌词服务 ==
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\stop-service.ps1"

echo.
pause
