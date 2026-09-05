@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_demo.ps1"
if errorlevel 1 (
  echo Startup failed. Read the message above.
  pause
  exit /b 1
)
