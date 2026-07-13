@echo off
rem Stops everything start-sharing.cmd launched: the tunnel and whatever
rem is listening on port 3000 (the karaoke server).
taskkill /IM cloudflared.exe /F 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /PID %%p /F
echo Done.
pause
