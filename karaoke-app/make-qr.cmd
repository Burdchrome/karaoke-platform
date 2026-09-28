@echo off
rem Gig helper: turns tonight's tunnel URL (from tunnel.log, written by
rem start-sharing.cmd) into a QR code image and opens it.
rem The URL changes every time the tunnel restarts, so re-run this after
rem each start-sharing.cmd. Needs the qrcode dev dependency (npm install).
cd /d "%~dp0"

if not exist tunnel.log (
  echo tunnel.log not found - run start-sharing.cmd first.
  pause
  exit /b 1
)

rem Pull the https://....trycloudflare.com URL out of the log (regex via node,
rem because cloudflared pads the line with | characters that trip cmd.exe).
set URL=
for /f "usebackq delims=" %%u in (`node -e "const m=require('fs').readFileSync('tunnel.log','utf8').match(/https:\/\/\S+trycloudflare\.com/); if(m) console.log(m[0])"`) do set URL=%%u

if "%URL%"=="" (
  echo No tunnel URL in tunnel.log yet - wait a few seconds and re-run.
  pause
  exit /b 1
)

echo Making QR for %URL%
call npx --no-install qrcode -o tunnel-qr.png -w 800 "%URL%"
if errorlevel 1 (
  echo QR generation failed - run: npm install --save-dev qrcode
  pause
  exit /b 1
)
echo Saved tunnel-qr.png - opening it.
if "%NO_OPEN%"=="" start "" tunnel-qr.png
