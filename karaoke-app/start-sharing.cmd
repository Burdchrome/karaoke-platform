@echo off
rem Standalone gig/share launcher: starts the karaoke server and a Cloudflare
rem tunnel in their own windows, so they keep running no matter what happens
rem to any Claude session. Double-click to start; run stop-sharing.cmd to stop.
cd /d "%~dp0"

rem DJ Basic Auth — required before exposing /dj through the tunnel.
rem Creds live in dj-creds.cmd (gitignored). Children below inherit them.
if not exist dj-creds.cmd (
  echo dj-creds.cmd is missing — create it with SET DJ_USER=... and SET DJ_PASS=...
  pause
  exit /b 1
)
call dj-creds.cmd

start "Karaoke Server" cmd /k "npm start"
timeout /t 5 >nul

del tunnel.log 2>nul
start "Cloudflare Tunnel" cmd /k "cloudflared tunnel --url http://localhost:3000 2>tunnel.log"

echo Waiting for tunnel URL (usually ~10 seconds)...
:wait
timeout /t 2 >nul
findstr "trycloudflare.com" tunnel.log >nul 2>nul || goto wait

echo.
echo ============ SHARE THIS URL ============
findstr "trycloudflare.com" tunnel.log
echo ========================================
echo DJ login: %DJ_USER% / %DJ_PASS%
echo (Audience page needs no login. URL changes every restart.)
echo.
pause
