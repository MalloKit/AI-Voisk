@echo off
rem AI-Voisk demo launcher: server (8001) + company admin web (8080) + owner web (8081).
rem Options are passed through, e.g.  start-demo.bat -Backend claude_cli
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-demo.ps1" %*
if errorlevel 1 pause
