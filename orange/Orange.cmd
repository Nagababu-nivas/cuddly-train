@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  start "Orange" /min node serve.js --port 5173
  timeout /t 1 /nobreak >nul
  start "" "http://127.0.0.1:5173/"
  goto :done
)
where py >nul 2>nul
if %errorlevel%==0 (
  set "PY=py"
) else (
  set "PY=python"
)
start "Orange" /min %PY% serve.py --port 5173
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:5173/"
:done
endlocal
