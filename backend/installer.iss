; 모두봄 로컬 에이전트 — Inno Setup 설치 스크립트
; 빌드: ISCC.exe installer.iss  (Inno Setup 6 필요)
; 사전: PyInstaller onedir(dist\모두봄-에이전트\) 가 빌드돼 있어야 함(build-installer.bat).
; 결과: dist\모두봄-설치.exe (더블클릭 설치 → 시작메뉴/바탕화면 아이콘 → 실행)

#define AppName "모두봄 로컬 에이전트"
#define AppVersion "0.3.2"
#define AppExe "모두봄-에이전트.exe"

[Setup]
; AppId 를 명시 고정 — 값은 기존(암묵) AppId(=AppName)와 동일해, 이미 설치된 app-v0.3.0 위에
; 재설치하면 '제자리 업데이트'(같은 설치 폴더 덮어쓰기)로 인식된다. 향후 AppName 을 바꿔도
; 업데이트 경로가 끊기지 않도록 명시했다(값은 절대 바꾸지 말 것 — 바꾸면 나란히 중복 설치됨).
AppId={#AppName}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=ModooBom
DefaultDirName={autopf}\ModooBom
DefaultGroupName=모두봄
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=모두봄-설치
SetupIconFile=modoobom.ico
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
UninstallDisplayName={#AppName}

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면 아이콘 만들기"; GroupDescription: "추가 아이콘:"

[Files]
; PyInstaller onedir 전체를 통째로 설치
Source: "dist\모두봄-에이전트\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\모두봄"; Filename: "{app}\{#AppExe}"
Name: "{group}\모두봄 제거"; Filename: "{uninstallexe}"
Name: "{autodesktop}\모두봄"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "지금 모두봄 실행"; Flags: nowait postinstall skipifsilent
