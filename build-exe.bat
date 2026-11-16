@echo off
rem Builds dist\NiimDesk.exe (single file, app files embedded).
rem Needs only .NET Framework 4, which is built into Windows 10/11.
cd /d "%~dp0"
if not exist dist mkdir dist
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
"%CSC%" /nologo /target:winexe /optimize+ /platform:anycpu ^
  /out:dist\NiimDesk.exe /win32icon:icon.ico /r:System.Windows.Forms.dll ^
  /resource:"index.html",www/index.html ^
  /resource:"app.js",www/app.js ^
  /resource:"niimbot.js",www/niimbot.js ^
  /resource:"i18n.js",www/i18n.js ^
  /resource:"licenses.txt",www/licenses.txt ^
  /resource:"icon.png",www/icon.png ^
  /resource:"lib\JsBarcode.all.min.js",www/lib/JsBarcode.all.min.js ^
  /resource:"lib\niimbluelib.min.js",www/lib/niimbluelib.min.js ^
  /resource:"lib\qrcode.min.js",www/lib/qrcode.min.js ^
  /resource:"lib\xlsx.full.min.js",www/lib/xlsx.full.min.js ^
  exe-src\Launcher.cs
if errorlevel 1 (echo BUILD FAILED & exit /b 1)
echo Built dist\NiimDesk.exe
