@echo off
chcp 65001 >nul
title HenrysTV Script Generator
echo.
echo  HenrysTV Script Generator
echo  =========================
echo.
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Node.js chua duoc cai dat!
    echo Chay setup.bat truoc hoac tai Node.js tai: https://nodejs.org
    pause
    exit /b 1
)
if not exist "node_modules" (
    echo [!] Chua co node_modules. Dang cai...
    call npm install
    if %errorlevel% neq 0 (
        echo [LOI] npm install that bai!
        pause
        exit /b 1
    )
)
if not exist ".env" (
    echo [!] Chua co file .env. Hay chay setup.bat truoc!
    pause
    exit /b 1
)
set PORT=3001
for /f "tokens=1,2 delims==" %%a in (.env) do (
    if "%%a"=="PORT" set PORT=%%b
)
echo [OK] Khoi dong server tai cong %PORT%...
echo.
echo  Truy cap: http://localhost:%PORT%
echo  Nhan Ctrl+C de dung server.
echo.
powershell -windowstyle hidden -command "Start-Sleep 2; Start-Process 'http://localhost:%PORT%'"
node server.js