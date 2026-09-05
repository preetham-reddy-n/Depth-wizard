@echo off
if not exist "%~dp0depthwizard_person5\.venv\Scripts\python.exe" (
  echo Backend environment is missing. Run setup.cmd first.
  exit /b 1
)
"%~dp0depthwizard_person5\.venv\Scripts\python.exe" "%~dp0scripts\diagnose.py" %*
exit /b %errorlevel%
