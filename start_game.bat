@echo off
chcp 65001 >nul
title 自然选择号：太阳系防线 (NATURAL SELECTION: SOLARIS PROTOCOL)
cd /d "%~dp0"

echo [SOLARIS] Launching Natural Selection Space Combat...
if not exist "dist\index.html" (
  echo [SOLARIS] Building production bundle first...
  call node .\node_modules\vite\bin\vite.js build
)

start "" "http://127.0.0.1:4173/"
echo [SOLARIS] Server listening at http://127.0.0.1:4173/ (Press Ctrl+C to stop)
node .\node_modules\vite\bin\vite.js preview --host 127.0.0.1 --port 4173
pause
