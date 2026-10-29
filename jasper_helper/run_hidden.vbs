Set WshShell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir
WshShell.Run "cmd.exe /c cd /d """ & scriptDir & """ && """ & scriptDir & "\start.bat"" > """ & scriptDir & "\jasper_start.log"" 2>&1", 0, False
