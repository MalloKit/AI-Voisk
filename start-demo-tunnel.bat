@echo off
rem AI-Voisk demo launcher with a Cloudflare Quick Tunnel: the tablet connects over https from any network.
rem Same as  start-demo.bat -Tunnel  (other options are passed through).
call "%~dp0start-demo.bat" -Tunnel %*
