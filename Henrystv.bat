@echo off
chcp 65001 >nul
title HenrysTV Script Generator

echo.
echo ╔══════════════════════════════════════════╗
echo ║     HenrysTV Script Generator           ║
echo ╚══════════════════════════════════════════╝
echo.

:: Kiểm tra Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [LỖI] Node.js chưa được cài đặt!
    echo Chạy setup.bat trước hoặc tải Node.js tại: https://nodejs.org
    pause
    exit /b 1
)

:: Kiểm tra dependencies
if not exist "node_modules" (
    echo [!] Chưa cài dependencies. Đang cài...
    call npm install
    if %errorlevel% neq 0 (
        echo [LỖI] npm install thất bại!
        pause
        exit /b 1
    )
)

:: Kiểm tra .env
if not exist ".env" (
    echo [!] Chưa có file .env. Hãy chạy setup.bat trước!
    pause
    exit /b 1
)

:: Lấy PORT từ .env (mặc định 3001)
set PORT=3001
for /f "tokens=2 delims==" %%a in ('findstr /i "^PORT=" .env') do set PORT=%%a

echo [OK] Đang khởi động server trên cổng %PORT%...
echo.
echo  Ứng dụng sẽ mở tại: http://localhost:%PORT%
echo  Nhấn Ctrl+C để dừng server.
echo.

:: Mở trình duyệt sau 2 giây
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%PORT%"

:: Khởi động server
node server.js
