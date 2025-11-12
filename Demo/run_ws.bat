@echo off
setlocal enabledelayedexpansion
title Demo Node Server Launcher
echo === Demo Node server start script ===
echo Working dir: %~dp0

REM Move to workspace root (this bat resides at project root)
cd /d "%~dp0"

REM Ensure node directory exists
if not exist "node" (
	echo [ERROR] node directory not found. Expected %~dp0node
	pause
	exit /b 1
)

REM Change into node folder
cd node

echo Checking if port 8765 is already in use...
set PORT_PID=
for /f "tokens=5" %%a in ('netstat -ano ^| find ":8765" ^| find "LISTENING"') do (
	set PORT_PID=%%a
)
if defined PORT_PID (
	echo Port 8765 in use by PID !PORT_PID! - attempting to terminate.
	taskkill /F /PID !PORT_PID! >nul 2>&1
	timeout /t 1 >nul
) else (
	echo Port 8765 is free.
)

echo Optionally killing stray node.exe processes (ignore errors)...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 1 >nul

REM Install dependencies if node_modules missing
if not exist "node_modules" (
	echo Installing dependencies (npm install)...
	call npm install || (
		echo [ERROR] npm install failed.
		pause
		exit /b 1
	)
)

REM Detect HTTPS certs (optional)
set CERT_DIR=%~dp0node\certs
if exist "certs\server.key" if exist "certs\server.crt" (
	echo HTTPS certificates detected (certs\server.key / certs\server.crt). Server may start in HTTPS mode.
) else (
	echo No HTTPS certs found; starting in HTTP mode. (Place server.key & server.crt in certs/ for HTTPS)
)

echo Starting server...
node server.js
set EXITCODE=%ERRORLEVEL%
if %EXITCODE% NEQ 0 (
	echo [ERROR] Server exited with code %EXITCODE%.
) else (
	echo Server stopped normally.
)
endlocal
pause
