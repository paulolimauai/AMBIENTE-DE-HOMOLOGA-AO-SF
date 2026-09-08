@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==================================================
echo   Iniciando Nexus Financeiro Hub (Segundo Plano)
echo ==================================================
wscript.exe "%~dp0iniciar_servidor_segundo_plano.vbs"
timeout /t 3 >nul
echo.
echo Verificando integridade da conexão...
curl.exe -s http://localhost:3000/api/health
echo.
echo ==================================================
echo   Servidor ativo e sincronizando com SQL Server!
echo ==================================================
timeout /t 5
