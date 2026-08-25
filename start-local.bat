@echo off
rem Starts the CellGuard local demo on a single port (localhost:3005).
rem Double-click this file (or run it from a terminal) after every reboot —
rem it does not install any startup task, so nothing runs on its own.
rem See docs/local_run.md for what this does and does not start.

setlocal

rem Move to the repository root (this file's own directory) regardless of
rem where it was launched from.
cd /d "%~dp0"

if not exist "backend\.env" (
    echo.
    echo backend\.env not found.
    echo Copy backend\.env.example to backend\.env and fill in BETTER_AUTH_SECRET
    echo ^(a random string of 32+ characters^), then run this script again.
    echo.
    pause
    exit /b 1
)

if not exist "backend\node_modules" (
    echo === Installing backend dependencies ^(first run only^) ===
    call npm --prefix backend install
    if errorlevel 1 goto :error
)

if not exist "frontend\node_modules" (
    echo === Installing frontend dependencies ^(first run only^) ===
    call npm --prefix frontend install
    if errorlevel 1 goto :error
)

echo === Building the frontend ===
call npm --prefix frontend run build
if errorlevel 1 goto :error

echo === Starting CellGuard on http://localhost:3005 ===
echo Press Ctrl+C to stop.
call npm --prefix backend run start:local
goto :end

:error
echo.
echo CellGuard failed to start. See the message above.
pause
exit /b 1

:end
endlocal
