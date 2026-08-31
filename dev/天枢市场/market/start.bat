@echo off
cd /d "%~dp0server"
echo 正在启动天枢市场服务...
node src/index.js
pause