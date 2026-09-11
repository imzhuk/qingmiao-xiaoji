@echo off
rem ============================================================
rem  Qingmiao Xiaoji - Visual Editor Launcher
rem  (keep this file ASCII-only; Chinese UI comes from Node)
rem ============================================================
chcp 65001 >nul 2>nul
title Qingmiao Xiaoji Editor
cd /d "%~dp0"

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-2\node.exe" set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.12.0\node.exe" set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.12.0\node.exe"
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"

if not defined NODE_EXE (
  echo.
  echo   [ERROR] Node.js not found. Please install Node.js first.
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" "editor\launch.js"
if errorlevel 1 pause
