@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Local Cortex Requirement Checker

set "SILENT=0"
if /I "%~1"=="/silent" set "SILENT=1"

set "APP_NAME=Local Cortex"
set "APP_EXE=Local Cortex.exe"
set "OLLAMA_URL=https://ollama.com/download/windows"
set "GIT_URL=https://git-scm.com/download/win"
set "PYTHON_URL=https://www.python.org/downloads/windows/"
set "NODE_URL=https://nodejs.org/"
set "RUST_URL=https://rustup.rs/"
set "WEBVIEW2_URL=https://developer.microsoft.com/en-us/microsoft-edge/webview2/"
set "BUILDTOOLS_URL=https://visualstudio.microsoft.com/visual-cpp-build-tools/"

set "HAS_ERRORS=0"
set "MISSING_ITEMS="
set "OPTIONAL_ITEMS="
set "APP_FOUND="

echo ============================================================
echo                 Local Cortex Requirement Checker
echo ============================================================
echo.
echo This script checks the minimum components needed to run %APP_NAME%.
echo.

call :check_app
call :check_ollama
call :check_ollama_api
call :check_models
call :check_optional_tools
call :summary
exit /b 0

:check_app
echo [1/5] Checking Local Cortex app files...
if exist "%~dp0%APP_EXE%" (
    set "APP_FOUND=%~dp0%APP_EXE%"
    echo   [OK] Found "%APP_EXE%" next to this script.
    goto :eof
)
if exist "%~dp0src-tauri\target\release\%APP_EXE%" (
    set "APP_FOUND=%~dp0src-tauri\target\release\%APP_EXE%"
    echo   [OK] Found release executable in src-tauri\target\release.
    goto :eof
)
for %%F in ("%~dp0src-tauri\target\release\bundle\**\%APP_EXE%") do (
    if exist "%%~fF" (
        set "APP_FOUND=%%~fF"
        echo   [OK] Found bundled executable: %%~fF
        goto :eof
    )
)
echo   [WARN] %APP_EXE% was not found in the usual locations.
echo          If you are only checking Ollama prerequisites, this warning can be ignored.
goto :eof

:check_ollama
echo.
echo [2/5] Checking Ollama installation...
where ollama >nul 2>nul
if errorlevel 1 (
    echo   [MISSING] Ollama is not installed or not in PATH.
    set "HAS_ERRORS=1"
    set "MISSING_ITEMS=!MISSING_ITEMS!Ollama installation|"
    call :notify "Local Cortex setup" "Ollama is missing. Install Ollama, then run this checker again."
    call :ask_open "Open Ollama download page?" "%OLLAMA_URL%"
    set "OLLAMA_PRESENT=0"
    goto :eof
)
for /f "delims=" %%I in ('ollama --version 2^>nul') do set "OLLAMA_VERSION=%%I"
echo   [OK] !OLLAMA_VERSION!
set "OLLAMA_PRESENT=1"
goto :eof

:check_ollama_api
echo.
echo [3/5] Checking Ollama service/API...
if not "%OLLAMA_PRESENT%"=="1" (
    echo   [SKIP] Ollama API check skipped because Ollama is missing.
    set "OLLAMA_API_OK=0"
    goto :eof
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 3; exit 0 } catch { exit 1 }"
if errorlevel 1 (
    echo   [MISSING] Ollama is installed, but the local API is not responding on 127.0.0.1:11434.
    echo             Start Ollama, then run this checker again.
    set "HAS_ERRORS=1"
    set "MISSING_ITEMS=!MISSING_ITEMS!Ollama running service|"
    call :notify "Local Cortex setup" "Ollama is installed, but not running on 127.0.0.1:11434."
    set "OLLAMA_API_OK=0"
    goto :eof
)

echo   [OK] Ollama API is responding at http://127.0.0.1:11434
set "OLLAMA_API_OK=1"
goto :eof

:check_models
echo.
echo [4/5] Checking required Ollama models...
if not "%OLLAMA_API_OK%"=="1" (
    echo   [SKIP] Model checks skipped because Ollama API is not reachable.
    goto :eof
)

set "HAS_CHAT_MODEL=0"
set "HAS_EMBED_MODEL=0"

for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$r = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get; foreach ($m in $r.models) { $m.name }"`) do (
    set "MODEL_NAME=%%I"
    if /I "!MODEL_NAME!"=="llama3.2" set "HAS_CHAT_MODEL=1"
    if /I "!MODEL_NAME!"=="llama3.2:latest" set "HAS_CHAT_MODEL=1"
    if /I "!MODEL_NAME!"=="nomic-embed-text" set "HAS_EMBED_MODEL=1"
    if /I "!MODEL_NAME!"=="nomic-embed-text:latest" set "HAS_EMBED_MODEL=1"
)

if "%HAS_CHAT_MODEL%"=="1" (
    echo   [OK] Chat model found: llama3.2
 ) else (
    echo   [MISSING] Chat model not found: llama3.2
    echo             Install it with: ollama pull llama3.2
    set "HAS_ERRORS=1"
    set "MISSING_ITEMS=!MISSING_ITEMS!Ollama chat model llama3.2|"
    call :notify "Local Cortex setup" "The required chat model llama3.2 is missing."
 )

if "%HAS_EMBED_MODEL%"=="1" (
    echo   [OK] Embedding model found: nomic-embed-text
 ) else (
    echo   [MISSING] Embedding model not found: nomic-embed-text
    echo             Install it with: ollama pull nomic-embed-text
    set "HAS_ERRORS=1"
    set "MISSING_ITEMS=!MISSING_ITEMS!Ollama embedding model nomic-embed-text|"
    call :notify "Local Cortex setup" "The required embedding model nomic-embed-text is missing."
 )
goto :eof

:check_optional_tools
echo.
echo [5/5] Checking optional tools...

where git >nul 2>nul
if errorlevel 1 (
    echo   [OPTIONAL] Git not found. Git panel features may not work.
    set "OPTIONAL_ITEMS=!OPTIONAL_ITEMS!Git for Windows|"
) else (
    for /f "delims=" %%I in ('git --version 2^>nul') do echo   [OK] %%I
)

where python >nul 2>nul
if errorlevel 1 (
    where py >nul 2>nul
    if errorlevel 1 (
        echo   [OPTIONAL] Python not found. Live server and Python run features may not work.
        set "OPTIONAL_ITEMS=!OPTIONAL_ITEMS!Python|"
    ) else (
        for /f "delims=" %%I in ('py --version 2^>nul') do echo   [OK] %%I
    )
) else (
    for /f "delims=" %%I in ('python --version 2^>nul') do echo   [OK] %%I
)

where node >nul 2>nul
if errorlevel 1 (
    echo   [OPTIONAL] Node.js not found. Only needed for building from source or running JS files.
    set "OPTIONAL_ITEMS=!OPTIONAL_ITEMS!Node.js|"
) else (
    for /f "delims=" %%I in ('node --version 2^>nul') do echo   [OK] Node %%I
)

where cargo >nul 2>nul
if errorlevel 1 (
    echo   [OPTIONAL] Rust/Cargo not found. Only needed for building the desktop app from source.
    set "OPTIONAL_ITEMS=!OPTIONAL_ITEMS!Rust|"
) else (
    for /f "delims=" %%I in ('cargo --version 2^>nul') do echo   [OK] %%I
)
goto :eof

:summary
echo.
echo ============================================================
echo                           Summary
echo ============================================================
echo.

if "%HAS_ERRORS%"=="0" (
    echo [PASS] All required runtime components for Local Cortex are available.
    echo.
    echo You should now be able to run the software.
    if defined APP_FOUND echo Executable: !APP_FOUND!
    call :notify "Local Cortex setup" "All required Local Cortex runtime components are installed."
 ) else (
    echo [FAIL] Local Cortex is not fully ready yet.
    echo.
    echo Missing required items:
    call :print_list "%MISSING_ITEMS%"
    echo.
    echo Fix the missing items above, then run this batch file again.
)

if defined OPTIONAL_ITEMS (
    echo.
    echo Optional tools not found:
    call :print_list "%OPTIONAL_ITEMS%"
    echo.
    echo These are not required for the basic app startup.
)

echo.
if "%SILENT%"=="1" goto :finish
choice /C YN /N /M "Open README now? [Y/N]: "
if errorlevel 2 goto :finish
if exist "%~dp0README.md" start "" "%~dp0README.md"

:finish
echo.
if "%SILENT%"=="1" goto :eof
pause
goto :eof

:print_list
set "TMP_LIST=%~1"
if not defined TMP_LIST goto :eof
for %%A in ("%TMP_LIST:|=" "%") do (
    if not "%%~A"=="" echo   - %%~A
)
goto :eof

:ask_open
set "ASK_TEXT=%~1"
set "ASK_URL=%~2"
if "%SILENT%"=="1" goto :eof
echo.
choice /C YN /N /M "%ASK_TEXT% [Y/N]: "
if errorlevel 2 goto :eof
start "" "%ASK_URL%"
goto :eof

:notify
set "N_TITLE=%~1"
set "N_TEXT=%~2"
if "%SILENT%"=="1" goto :eof
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('%N_TEXT%','%N_TITLE%','OK','Warning') | Out-Null" >nul 2>nul
goto :eof
