@echo off
title Free-Wifi Gateway Server
cd /d "%~dp0"
echo ========================================================
echo        Free-Wifi Captive Portal & Gateway Server
echo ========================================================
echo.
echo Local IP: 192.168.1.106
echo Admin URL: http://localhost:3000/admin (PIN: 1234)
echo User Portal: http://localhost:3001/portal
echo Cloud Portal: https://free-wifi-portal.web.app
echo.
echo Starting gateway services (Port 3000, 3001, 80 CNA, 53 DNS)...
echo.

node server.js

if %errorlevel% neq 0 (
  echo.
  echo [ERROR] Gateway stopped with error code %errorlevel%.
  pause
)
