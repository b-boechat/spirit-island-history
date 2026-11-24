@echo off
rem Starts the Spirit Island history site and opens it in your browser.
rem
rem It looks for Python 3.9 or newer, in this order:
rem   1. the path written in data\python-path.txt (optional, one line)
rem   2. the Python included with the "windows-with-python" download
rem      (the python folder next to this file)
rem   3. the "py" launcher that comes with Python from python.org
rem   4. "python" on the PATH (skipping the Microsoft Store shortcut, which
rem      isn't a real Python)
rem   5. the usual install folders (Anaconda, Miniconda, python.org)
rem If Python is installed somewhere else, put the full path to python.exe in
rem data\python-path.txt, for example:  C:\Tools\Python312\python.exe

setlocal
cd /d "%~dp0"
set "FOUND="
set "FOUNDARGS="

rem 1. data\python-path.txt
if not exist "data\python-path.txt" goto :search
set "WANTED="
set /p WANTED=<"data\python-path.txt"
if not defined WANTED goto :search
rem Drop quotes and trailing spaces the path may have been pasted with.
set "WANTED=%WANTED:"=%"
:trim
if not defined WANTED goto :search
if "%WANTED:~-1%"==" " set "WANTED=%WANTED:~0,-1%" & goto :trim
call :try "%WANTED%"
if defined FOUND goto :run
echo The Python in data\python-path.txt doesn't work:
echo   %WANTED%
echo Looking for another Python...
echo.

:search
rem 2. The bundled Python
call :try "%CD%\python\python.exe"
if defined FOUND goto :run

rem 3. The py launcher
call :try py -3
if defined FOUND goto :run

rem 4. python on the PATH
for /f "delims=" %%P in ('where python 2^>nul') do call :try "%%P"
if defined FOUND goto :run

rem 5. Usual install folders
call :try "%USERPROFILE%\anaconda3\python.exe"
call :try "%USERPROFILE%\miniconda3\python.exe"
call :try "%LOCALAPPDATA%\anaconda3\python.exe"
call :try "%LOCALAPPDATA%\miniconda3\python.exe"
call :try "%ProgramData%\anaconda3\python.exe"
call :try "%ProgramData%\miniconda3\python.exe"
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do call :try "%%D\python.exe"
for /d %%D in ("%ProgramFiles%\Python3*") do call :try "%%D\python.exe"
if defined FOUND goto :run
goto :notfound

:run
echo Using Python: %FOUND% %FOUNDARGS%
"%FOUND%" %FOUNDARGS% server.py --open %*
pause
exit /b

:notfound
echo Python 3.9 or newer is needed to run this site, and none was found.
echo.
echo  - Easiest: download the "windows-with-python" ZIP of this site instead,
echo    which includes Python: see the Releases page of the project on GitHub.
echo  - Or install Python: https://www.python.org/downloads/
echo    During the installation, tick "Add python.exe to PATH".
echo  - If Python is already installed somewhere unusual: create the file
echo    data\python-path.txt containing the full path to python.exe,
echo    for example  C:\Tools\Python312\python.exe
echo.
pause
exit /b 1

rem Tries one Python: %1 is the program, %2 extra arguments (like -3 for py).
rem Accepts it if it runs and is version 3.9 or newer.
:try
if defined FOUND exit /b
if "%~1"=="" exit /b
"%~1" %~2 -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul
if errorlevel 1 exit /b
set "FOUND=%~1"
set "FOUNDARGS=%~2"
exit /b
