@echo off
title Jasper Helper Server
echo [INFO] Starting Jasper Helper Server...
cd /d "%~dp0"

set "JAR_PATH=%~dp0jasper-helper.jar"

rem 1. Neu co file standalone JAR (Fat JAR), tim Java/JRE de chay truc tiep
if exist "%JAR_PATH%" (
    echo [INFO] Found standalone package: jasper-helper.jar
    set "JAVA_EXE="

    rem Kiem tra JRE portable di kem neu co
    if exist "%~dp0jre\bin\java.exe" set "JAVA_EXE=%~dp0jre\bin\java.exe" & goto :run_jar
    if exist "%~dp0..\jre\bin\java.exe" set "JAVA_EXE=%~dp0..\jre\bin\java.exe" & goto :run_jar

    rem Kiem tra JAVA_HOME da cau hinh
    if defined JAVA_HOME (
        if exist "%JAVA_HOME%\bin\java.exe" set "JAVA_EXE=%JAVA_HOME%\bin\java.exe" & goto :run_jar
    )

    rem Kiem tra java trong PATH he thong
    where java >nul 2>nul
    if %errorlevel% == 0 (
        set "JAVA_EXE=java"
        goto :run_jar
    )

    rem Kiem tra cac thu muc Java pho bien tren Windows
    for /d %%D in ("C:\Program Files\Eclipse Adoptium\jre*" "C:\Program Files\Eclipse Adoptium\jdk*" "C:\Program Files\Java\jre*" "C:\Program Files\Java\jdk*" "C:\Program Files (x86)\Java\jre*" "C:\Program Files (x86)\Java\jdk*" "C:\Program Files\BellSoft\*" "C:\Program Files\Amazon Corretto\*") do (
        if exist "%%D\bin\java.exe" (
            set "JAVA_EXE=%%D\bin\java.exe"
            goto :run_jar
        )
    )

    rem Kiem tra thu muc SQL Developer
    if exist "D:\Google One\My Drive\05_Software_Tools\work\sqldeveloper-26.2.0.186.2220-x64\sqldeveloper\jdk\jre\bin\java.exe" (
        set "JAVA_EXE=D:\Google One\My Drive\05_Software_Tools\work\sqldeveloper-26.2.0.186.2220-x64\sqldeveloper\jdk\jre\bin\java.exe"
        goto :run_jar
    )

    rem Tim dong trong cac thu muc sqldeveloper khac
    for /d %%D in ("D:\Google One\My Drive\05_Software_Tools\work\*sqldeveloper*" "D:\Google One\Other computers\My Computer\Software\work\*sqldeveloper*" "D:\Google One\My Drive\*sqldeveloper*" "D:\*sqldeveloper*") do (
        if exist "%%D\sqldeveloper\jdk\jre\bin\java.exe" set "JAVA_EXE=%%D\sqldeveloper\jdk\jre\bin\java.exe" & goto :run_jar
        if exist "%%D\jdk\jre\bin\java.exe" set "JAVA_EXE=%%D\jdk\jre\bin\java.exe" & goto :run_jar
        if exist "%%D\jdk\bin\java.exe" set "JAVA_EXE=%%D\jdk\bin\java.exe" & goto :run_jar
    )

    echo [ERROR] Khong tim thay Java tren may tinh!
    echo Vui long cai dat Java Runtime JRE 8+ hoac cau hinh JAVA_HOME.
    if not "%1"=="--no-pause" pause
    exit /b 1

:run_jar
    echo [INFO] Using Java: %JAVA_EXE%
    echo [INFO] Running Jasper Helper on port 8080...
    "%JAVA_EXE%" -Dfile.encoding=UTF-8 -jar "%JAR_PATH%"
    if errorlevel 1 (
        echo [ERROR] Jasper Helper bi dung hoac xay ra loi.
        if not "%1"=="--no-pause" pause
    )
    exit /b 0
)

rem 2. FALLBACK: Neu chua dong goi JAR, bien dich va chay bang Maven nhu cu
echo [INFO] Standalone JAR not found. Falling back to Maven mode...

if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\javac.exe" (
        set "PATH=%JAVA_HOME%\bin;%PATH%"
        goto :check_maven
    )
)

if exist "D:\Google One\My Drive\05_Software_Tools\work\sqldeveloper-26.2.0.186.2220-x64\sqldeveloper\jdk\jre\bin\javac.exe" (
    set "JAVA_HOME=D:\Google One\My Drive\05_Software_Tools\work\sqldeveloper-26.2.0.186.2220-x64\sqldeveloper\jdk\jre"
    set "PATH=D:\Google One\My Drive\05_Software_Tools\work\sqldeveloper-26.2.0.186.2220-x64\sqldeveloper\jdk\jre\bin;%PATH%"
    goto :check_maven
)

where javac >nul 2>nul
if %errorlevel% == 0 goto :check_maven

echo [ERROR] JDK javac not found. Please install JDK or package jasper-helper.jar.
if not "%1"=="--no-pause" pause
exit /b 1

:check_maven
where mvn >nul 2>nul
if %errorlevel% == 0 (
    set MVN_CMD=mvn
    goto :run_maven
)

if exist "%~dp0..\maven\apache-maven-3.9.16\bin\mvn.cmd" (
    set MVN_CMD="%~dp0..\maven\apache-maven-3.9.16\bin\mvn.cmd"
    goto :run_maven
)

echo [ERROR] Maven not found.
if not "%1"=="--no-pause" pause
exit /b 1

:run_maven
echo [INFO] Running Maven compilation and exec:java...
call %MVN_CMD% compile exec:java
if errorlevel 1 (
    echo [ERROR] Maven execution failed.
    if not "%1"=="--no-pause" pause
)
