@echo off
cd /d "%~dp0"

echo ============================================
echo   AgentHub 启动脚本
echo   前端: http://localhost:3000
echo   后端: http://localhost:8000
echo ============================================

REM 清理端口占用，避免启动时端口冲突
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo 释放端口 3000 (PID %%a)
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
    echo 释放端口 8000 (PID %%a)
    taskkill /PID %%a /F >nul 2>&1
)

REM 设置 NODE_OPTIONS 以修复 Windows 上可能的 EXDEV 文件系统错误
if /i "%AGENTHUB_CLEAN_CACHE%"=="1" call pnpm clean:cache
set NODE_OPTIONS=--import ./scripts/dev-fix.mjs

REM 同时启动前端 + Python 后端
call pnpm dev:all
