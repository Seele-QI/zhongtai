@echo off
cd /d "%~dp0"

REM 清理端口 3000 占用，避免启动时端口冲突
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo 释放端口 3000 (PID %%a)
    taskkill /PID %%a /F >nul 2>&1
)

set NODE_OPTIONS=--import ./scripts/dev-fix.mjs
echo 启动前端: http://localhost:3000
call pnpm dev
