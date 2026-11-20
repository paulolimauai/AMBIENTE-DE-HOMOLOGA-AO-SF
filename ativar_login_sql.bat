@echo off
REM ============================================================
REM  Ativa a Autenticacao Mista (SQL Server + Windows) no SQL Server local
REM  e reinicia o servico. O login SQL 'nexus_app' ja esta criado.
REM
REM  *** EXECUTE ESTE ARQUIVO COMO ADMINISTRADOR (botao direito > Executar como administrador) ***
REM ============================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERRO] Execute este arquivo como Administrador.
  pause
  exit /b 1
)

echo [1/2] Ativando autenticacao mista (LoginMode=2)...
reg add "HKLM\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL17.MSSQLSERVER\MSSQLServer" /v LoginMode /t REG_DWORD /d 2 /f
if %errorlevel% neq 0 (
  echo [ERRO] Falha ao alterar o registro LoginMode.
  pause
  exit /b 1
)

echo [2/2] Reiniciando o servico MSSQLSERVER (o banco ficara offline por alguns segundos)...
net stop MSSQLSERVER /y
net start MSSQLSERVER

echo.
echo Pronto! Login SQL ativo:
echo   Servidor : localhost
echo   Usuario  : nexus_app
echo   Senha    : ver arquivo .env (MSSQL_PASSWORD)
pause
