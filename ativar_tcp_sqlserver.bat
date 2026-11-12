@echo off
chcp 65001 >nul
title Habilitar TCP/IP do SQL Server (Nexus)
echo ======================================================
echo  Habilitando TCP/IP na porta 1433 - SQL Server
echo ======================================================

net session >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Execute este arquivo como ADMINISTRADOR.
  echo Botao direito -^> "Executar como administrador"
  pause
  exit /b 1
)

reg add "HKLM\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL17.MSSQLSERVER\MSSQLServer\SuperSocketNetLib\Tcp" /v Enabled /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL17.MSSQLSERVER\MSSQLServer\SuperSocketNetLib\IpAll" /v TcpPort /t REG_SZ /d 1433 /f
reg add "HKLM\SOFTWARE\Microsoft\Microsoft SQL Server\MSSQL17.MSSQLSERVER\MSSQLServer\SuperSocketNetLib\IpAll" /v TcpDynamicPorts /t REG_SZ /d "" /f

echo Reiniciando o servico SQL Server...
net stop MSSQLSERVER /y
net start MSSQLSERVER

timeout /t 4 >nul
netstat -ano | findstr :1433 | findstr LISTENING >nul
if errorlevel 1 (
  echo.
  echo [AVISO] Porta 1433 ainda nao esta escutando. Aguarde alguns segundos e teste de novo.
) else (
  echo.
  echo [OK] SQL Server escutando na porta TCP 1433!
)
echo.
pause
