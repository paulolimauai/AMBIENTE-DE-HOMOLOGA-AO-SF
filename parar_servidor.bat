@echo off
chcp 65001 >nul
echo ==================================================
echo   Encerrando Nexus Financeiro Hub na Porta 3000
echo ==================================================
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo Encerrando PID: %%a
    taskkill /F /PID %%a
)
echo ==================================================
echo   Concluído com sucesso.
echo ==================================================
timeout /t 3
