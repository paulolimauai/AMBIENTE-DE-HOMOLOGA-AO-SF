@echo off
chcp 65001 >nul
color 0B
title Nexus Financeiro Hub - Inicializacao
cd /d "%~dp0"
echo ==================================================
echo   NEXUS FINANCEIRO HUB
echo   Inicializando servidor em segundo plano...
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
echo.
echo [1] Consultar todos os logs de auditoria
echo [2] Fechar esta janela
choice /c 12 /n /m "Escolha uma opcao: "
if errorlevel 2 goto fim
if errorlevel 1 goto logs

:logs
echo.
echo Consultando logs locais e do banco de dados...
powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://localhost:3000/api/logs' -TimeoutSec 15 | Format-List * } catch { Write-Host 'Nao foi possivel consultar os logs. Verifique se o servidor esta ativo.' -ForegroundColor Red; exit 1 }"
echo.
pause
goto fim

:fim
