@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo Missing .env file.
  echo Copy .env.example to .env, then fill ADMIN_PASSWORD and MYSHIP_CHROME_PROFILE_DIR.
  pause
  exit /b 1
)

echo Starting Line Slipper Shop MyShip sync worker...
echo Keep this window open. Close it to stop syncing.
npm run myship-sync
