@echo off
setlocal
cd /d "%~dp0"

set "TASK_NAME=LineSlipperShopMyshipSync"
set "RUN_BAT=%~dp0start-myship-sync.bat"

if not exist ".env" (
  echo Missing .env file.
  echo Copy .env.example to .env, then fill ADMIN_PASSWORD and MYSHIP_CHROME_PROFILE_DIR.
  pause
  exit /b 1
)

schtasks /Create /TN "%TASK_NAME%" /TR "\"%RUN_BAT%\"" /SC ONLOGON /F
if errorlevel 1 (
  echo Failed to create scheduled task.
  pause
  exit /b 1
)

echo Scheduled task created: %TASK_NAME%
echo It will run when this Windows user logs in.
pause
