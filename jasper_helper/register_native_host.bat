@echo off
setlocal enabledelayedexpansion
title Dang ky Jasper Helper Native Host & Protocol
echo =====================================================================
echo    DANG KY JASPER HELPER NATIVE HOST VA CUSTOM PROTOCOL CHO TRINH DUYET
echo =====================================================================
echo.

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "HOST_EXE=%SCRIPT_DIR%\jasper_host.exe"
set "RUN_VBS=%SCRIPT_DIR%\run_hidden.vbs"
set "CHROME_JSON=%SCRIPT_DIR%\native_host_chrome.json"
set "FIREFOX_JSON=%SCRIPT_DIR%\native_host_firefox.json"

rem Format duong dan co dau double backslash cho JSON
set "ESCAPED_PATH=%HOST_EXE:\=\\%"

echo [1/3] Cap nhat duong dan thuc te vao file cau hinh Native Host...
echo Duong dan Host: %HOST_EXE%

echo.
echo Nhap Chrome Extension ID cua ban neu co
echo (Xem tren trinh duyet chrome://extensions, vi du: jvalpmhpkjoqcigpofgjolgpgjjdjgnl)
set /p CUSTOM_EXT_ID="Extension ID (Enter de su dung mac dinh): "

rem Tao file native_host_chrome.json dong theo may hien tai
(
echo {
echo   "name": "com.his.jasper_helper",
echo   "description": "Jasper Helper Native Host",
echo   "path": "%ESCAPED_PATH%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://hgidaakbebidnlggammfnppdepllpohe/",
echo     "chrome-extension://jnaigcpofkidnpfjglkjhdbhadnejgad/",
echo     "chrome-extension://ahelkaipfogbfcapanngiohnljlchhba/",
echo     "chrome-extension://jvalpmhpkjoqcigpofgjolgpgjjdjgnl/",
if not "%CUSTOM_EXT_ID%"=="" (
echo     "chrome-extension://%CUSTOM_EXT_ID%/",
)
echo     "chrome-extension://vnpthis-sql-query-tool/"
echo   ]
echo }
) > "%CHROME_JSON%"

rem Tao file native_host_firefox.json dong theo may hien tai
(
echo {
echo   "name": "com.his.jasper_helper",
echo   "description": "Jasper Helper Native Host",
echo   "path": "%ESCAPED_PATH%",
echo   "type": "stdio",
echo   "allowed_extensions": [
echo     "vnpthis-sql-query-tool@project.com"
echo   ]
echo }
) > "%FIREFOX_JSON%"

echo [SUCCESS] Da cap nhat native_host_chrome.json va native_host_firefox.json.

echo.
echo [2/3] Ghi thong tin Native Host vao Windows Registry...

:: Google Chrome
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.his.jasper_helper" /ve /t REG_SZ /d "%CHROME_JSON%" /f >nul 2>&1
if %errorlevel%==0 (
    echo [OK] Da dang ky Native Host cho Google Chrome.
) else (
    echo [CANH BAO] Khong the ghi Registry cho Chrome.
)

:: Microsoft Edge
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.his.jasper_helper" /ve /t REG_SZ /d "%CHROME_JSON%" /f >nul 2>&1
if %errorlevel%==0 (
    echo [OK] Da dang ky Native Host cho Microsoft Edge.
) else (
    echo [CANH BAO] Khong the ghi Registry cho Edge.
)

:: Mozilla Firefox
reg add "HKCU\Software\Mozilla\NativeMessagingHosts\com.his.jasper_helper" /ve /t REG_SZ /d "%FIREFOX_JSON%" /f >nul 2>&1
if %errorlevel%==0 (
    echo [OK] Da dang ky Native Host cho Mozilla Firefox.
) else (
    echo [CANH BAO] Khong the ghi Registry cho Firefox.
)

echo.
echo [3/3] Dang ky Custom URL Protocol: jasperhelper://...
reg add "HKCU\Software\Classes\jasperhelper" /ve /t REG_SZ /d "URL:Jasper Helper Protocol" /f >nul 2>&1
reg add "HKCU\Software\Classes\jasperhelper" /v "URL Protocol" /t REG_SZ /d "" /f >nul 2>&1
reg add "HKCU\Software\Classes\jasperhelper\shell\open\command" /ve /t REG_SZ /d "wscript.exe \"%RUN_VBS%\"" /f >nul 2>&1
if %errorlevel%==0 (
    echo [OK] Da dang ky Custom Protocol jasperhelper:// thanh cong.
) else (
    echo [CANH BAO] Khong the dang ky Custom Protocol.
)

echo.
echo =====================================================================
echo [HOAN TAT] He thong da san sang!
echo Ban co the chay file start.bat de bat server hoac de extension tu dong bat.
echo =====================================================================
pause
