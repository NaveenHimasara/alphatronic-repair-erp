@echo off
title Alphatronic Repair ERP Server
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo  Node.js is not installed on this laptop.
    echo  Install the LTS version from https://nodejs.org  then run this file again.
    echo.
    pause
    exit /b 1
)

rem Open the browser on this laptop after the server starts
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:8080"

node server.js
echo.
echo  The server stopped.
pause
