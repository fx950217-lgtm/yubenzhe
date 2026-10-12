@echo off
REM ===================================================================
REM  ybz 必备工具 - 双击我就能装
REM  这个文件必须保存为 GBK/ANSI 编码，否则中文会乱码
REM ===================================================================
chcp 936 >nul
title ybz 必备工具 一键安装

cd /d "%~dp0"

echo.
echo ======================================================
echo         ybz  必备工具  一键安装
echo ======================================================
echo.

where powershell >nul 2>&1
if errorlevel 1 (
    echo [错误] 找不到 PowerShell，无法继续。
    echo        请确认这是 Windows 系统。
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-ybz-tools.ps1"
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
    echo [完成] 安装流程已结束。
) else (
    echo [注意] 脚本返回代码 %RC%，请把上面的信息截图反馈。
)
echo.
echo 按任意键关闭本窗口...
pause >nul
