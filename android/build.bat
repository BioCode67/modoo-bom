@echo off
REM ═══════════════════════════════════════════════════════════════
REM  모두봄 안드로이드 앱 재빌드 (더블클릭 한 번)
REM  버전 올릴 때: twa-manifest.json 의 appVersionName / appVersionCode 수정 후
REM  → android\app\build.gradle 의 versionCode/versionName 도 같이 수정 → 이 파일 실행
REM  산출물: modoobom-release.aab (플레이스토어 업로드) / modoobom-release.apk (직접 설치)
REM ═══════════════════════════════════════════════════════════════
chcp 65001 >nul
cd /d "%~dp0"

set JAVA_HOME=%USERPROFILE%\.bubblewrap\jdk
set ANDROID_HOME=%USERPROFILE%\.bubblewrap\android_sdk
set BT=%ANDROID_HOME%\build-tools\34.0.0
set KS=keystore\modoobom-release.keystore
REM 비밀번호는 커밋되지 않는 keystore\password.txt 에서 읽음 (공개 저장소 유출 방지)
set /p PW=<keystore\password.txt

echo [1/4] Gradle 빌드(AAB + APK)...
call gradlew.bat bundleRelease assembleRelease --no-daemon -q
if errorlevel 1 goto :fail

echo [2/4] AAB 서명(jarsigner)...
"%JAVA_HOME%\bin\jarsigner.exe" -keystore %KS% -storepass "%PW%" -digestalg SHA-256 -sigalg SHA256withRSA app\build\outputs\bundle\release\app-release.aab modoobom
if errorlevel 1 goto :fail
copy /y app\build\outputs\bundle\release\app-release.aab modoobom-release.aab >nul

echo [3/4] APK 정렬+서명(apksigner)...
"%BT%\zipalign.exe" -f -p 4 app\build\outputs\apk\release\app-release-unsigned.apk %TEMP%\modoobom-aligned.apk
call "%BT%\apksigner.bat" sign --ks %KS% --ks-pass pass:"%PW%" --out modoobom-release.apk %TEMP%\modoobom-aligned.apk
if errorlevel 1 goto :fail

echo [4/4] 서명 검증...
call "%BT%\apksigner.bat" verify modoobom-release.apk
if errorlevel 1 goto :fail

echo.
echo ✅ 완료!  modoobom-release.aab / modoobom-release.apk
goto :end
:fail
echo ❌ 실패 — 위 오류 메시지를 확인하세요.
:end
pause
