@echo off
setlocal
cd /d "%~dp0"
title XMILE - local server

REM A server is OPTIONAL. Double-clicking РЕДАКТОР.html works on its own.
REM This is only for testing the site the way it will run once published.

set PYEXE=
for %%P in ("py -3" "python" "python3") do (
  if not defined PYEXE (
    cmd /c %%~P --version >nul 2>&1 && set "PYEXE=%%~P"
  )
)

if not defined PYEXE (
  echo.
  echo   Python was not found, so the local server cannot start.
  echo.
  echo   You do not need it. Close this window and double-click:
  echo.
  echo       REDAKTOR.html      - the editor
  echo       index.html         - the site
  echo.
  echo   Everything works straight from the folder.
  echo.
  pause
  exit /b 1
)

set PORT=8080
echo.
echo   Serving on http://localhost:%PORT%/
echo   Editor:    http://localhost:%PORT%/?edit
echo.
echo   Keep this window open. Close it to stop.
echo.
start "" "http://localhost:%PORT%/?edit"
cmd /c %PYEXE% -m http.server %PORT%
pause
