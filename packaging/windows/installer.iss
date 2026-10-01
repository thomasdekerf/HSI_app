#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#define RepoRoot SourcePath + "..\.."

[Setup]
AppId={{C25D914B-F4AA-494A-A5A4-5734C108D679}
AppName=HSI App
AppVersion={#AppVersion}
AppPublisher=HSI App
AppPublisherURL=https://github.com/thomasdekerf/HSI_app
DefaultDirName={localappdata}\Programs\HSI App
DefaultGroupName=HSI App
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#RepoRoot}\dist\installer
OutputBaseFilename=HSI-App-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\HSI-App.exe
CloseApplications=yes
CloseApplicationsFilter=HSI-App.exe
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#RepoRoot}\dist\HSI-App\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\HSI App"; Filename: "{app}\HSI-App.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\HSI App"; Filename: "{app}\HSI-App.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\HSI-App.exe"; Description: "Open HSI App"; Flags: nowait postinstall skipifsilent
