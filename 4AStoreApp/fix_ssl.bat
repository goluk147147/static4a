@echo off
echo Copying updated cacerts to Android Studio JDK...
copy /Y "%TEMP%\cacerts_copy" "C:\Program Files\Android\Android Studio\jbr\lib\security\cacerts"
if %ERRORLEVEL%==0 (
    echo SUCCESS! Certificates imported successfully.
    echo Now go back to Android Studio and click "Try Again" or "Sync Now"
) else (
    echo FAILED! Please run this file as Administrator.
    echo Right-click on fix_ssl.bat and select "Run as administrator"
)
pause
