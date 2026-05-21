@echo off
chcp 65001 >nul
title HenrysTV - Setup
setlocal enabledelayedexpansion
echo.
echo  HenrysTV Script Generator - Cai dat lan dau
echo  ==========================================
echo.
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Node.js chua duoc cai dat!
    echo Tai ve tai: https://nodejs.org  chon LTS
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v
echo.
echo [1/3] Dang cai dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [LOI] npm install that bai!
    pause
    exit /b 1
)
echo [OK] Dependencies da cai xong.
echo.
if not exist ".env" (
    echo [2/3] Tao file cau hinh...
    echo.
    set /p "API_KEY=Nhap Anthropic API Key: "
    echo ANTHROPIC_API_KEY=!API_KEY!> .env
    echo PORT=3001>> .env
    echo [OK] File .env da tao.
) else (
    echo [OK] File .env da ton tai.
)
echo.
echo [3/3] Cai dat hoan tat! Hay chay: start.bat
echo.
pause