Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\AMBIENTE DE HOMOLOGAÇAO"
WshShell.Run "node server.js", 0, False
