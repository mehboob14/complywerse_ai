; ============================================================================
; Compliverse Compliance Agent — NSIS Windows Installer
; ============================================================================
;
; Build:
;   makensis install.nsi          → produces ComplyverseAgent-Setup-1.0.0.exe
;
; Silent (GPO/SCCM) install:
;   ComplyverseAgent-Setup-1.0.0.exe /S /TOKEN=enroll_xxx /BACKEND=https://...
;
; What it does:
;   1. Lays down embedded Python 3.11 + agent package under Program Files
;   2. Pip-installs runtime deps (paramiko + cryptography) into the embedded env
;   3. Calls `agent enroll` with the install-time token + backend URL
;   4. Registers the agent as a Windows Service via NSSM (bundled)
;   5. Starts the service
;
; Uninstall: stops service, deletes Program Files dir, wipes APPDATA vault.
; ============================================================================

!define PRODUCT_NAME       "Compliverse Compliance Agent"
!define PRODUCT_VERSION    "1.0.0"
!define PRODUCT_PUBLISHER  "Compliverse"
!define PRODUCT_WEB_SITE   "https://compliverse.app"
!define INSTALL_DIR        "$PROGRAMFILES64\Compliverse\Agent"
!define SERVICE_NAME       "ComplyverseAgent"
!define UNINST_KEY         "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SERVICE_NAME}"

Name        "${PRODUCT_NAME}"
OutFile     "ComplyverseAgent-Setup-${PRODUCT_VERSION}.exe"
InstallDir  "${INSTALL_DIR}"
RequestExecutionLevel admin    ; Service registration needs Administrator
ShowInstDetails show
ShowUninstDetails show

; Modern UI 2 + a friendly wizard flow
!include "MUI2.nsh"
!define MUI_ICON   "compliverse.ico"
!define MUI_UNICON "compliverse.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; ----------------------------------------------------------------------------
; Variables for command-line parameters (silent install)
; ----------------------------------------------------------------------------
Var ENROLL_TOKEN
Var BACKEND_URL


; ----------------------------------------------------------------------------
; Main install section
; ----------------------------------------------------------------------------
Section "Install"
  SetOutPath "$INSTDIR"

  ; --- 1) Lay down embedded Python and agent code ---
  ; The build pipeline downloads python-3.11.x-embed-amd64.zip and unpacks
  ; into ./build/python_embed/. install.nsi just copies the result.
  File /r "build\python_embed\*.*"
  File /r "build\complyverse_agent\*.*"

  ; --- 2) NSSM (Non-Sucking Service Manager) for service registration ---
  ; Bundled as a single 300 KB exe — far simpler than rolling our own
  ; sc.exe wrapper and handles auto-restart on crash.
  File "build\nssm.exe"

  ; --- 3) Pip-install runtime deps INTO the embedded interpreter ---
  ; (Cryptography wheel + paramiko + bcrypt for SSH key parsing.)
  ; In a real build pipeline you'd ship a pre-baked Lib/site-packages
  ; tree so the installer doesn't need internet at install time.
  DetailPrint "Installing Python dependencies..."
  nsExec::ExecToLog '"$INSTDIR\python.exe" -m pip install --no-warn-script-location --target "$INSTDIR\Lib" paramiko cryptography'
  Pop $0

  ; --- 4) Pull silent-install parameters from the command line ---
  ${GetParameters} $R0
  ${GetOptions} $R0 "/TOKEN=" $ENROLL_TOKEN
  ${GetOptions} $R0 "/BACKEND=" $BACKEND_URL

  ; --- 5) Enroll with the cloud (if token provided) ---
  ${If} $ENROLL_TOKEN != ""
  ${AndIf} $BACKEND_URL != ""
    DetailPrint "Enrolling agent with backend..."
    nsExec::ExecToLog '"$INSTDIR\python.exe" -m complyverse_agent enroll --backend "$BACKEND_URL" --token "$ENROLL_TOKEN"'
    Pop $0
    ${If} $0 != "0"
      MessageBox MB_ICONEXCLAMATION "Enrollment failed (exit $0). Check the token + backend URL. You can re-run enrollment manually later with `complyverse_agent enroll`."
    ${EndIf}
  ${Else}
    DetailPrint "No /TOKEN provided — enrollment will need to be run manually."
  ${EndIf}

  ; --- 6) Register Windows Service ---
  DetailPrint "Registering Windows Service..."
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" install ${SERVICE_NAME} "$INSTDIR\python.exe" "-m" "complyverse_agent" "run"'
  Pop $0
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} DisplayName "Compliverse Compliance Agent"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} Description "Pulls CIS benchmark scan jobs from Compliverse cloud and pushes results."'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} Start SERVICE_AUTO_START'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICE_NAME} AppRestartDelay 30000'

  ; --- 7) Start service ---
  DetailPrint "Starting service..."
  nsExec::ExecToLog 'sc start ${SERVICE_NAME}'

  ; --- 8) Write uninstall registry entry ---
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName"     "${PRODUCT_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion"  "${PRODUCT_VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher"       "${PRODUCT_PUBLISHER}"
  WriteRegStr HKLM "${UNINST_KEY}" "URLInfoAbout"    "${PRODUCT_WEB_SITE}"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd


; ----------------------------------------------------------------------------
; Uninstall section
; ----------------------------------------------------------------------------
Section "Uninstall"
  ; Stop + remove service
  DetailPrint "Stopping service..."
  nsExec::ExecToLog 'sc stop ${SERVICE_NAME}'
  Sleep 2000
  DetailPrint "Removing service..."
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" remove ${SERVICE_NAME} confirm'

  ; Wipe per-user vault for every profile (best-effort — we only know the
  ; profile that uninstalled). The vault under %APPDATA% of OTHER users
  ; will be orphaned but isn't readable because of DPAPI scoping.
  DetailPrint "Wiping agent vault..."
  nsExec::ExecToLog '"$INSTDIR\python.exe" -m complyverse_agent revoke --yes'

  ; Delete files
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNINST_KEY}"
SectionEnd


; Helper macros that NSIS doesn't ship by default
!include "FileFunc.nsh"
!insertmacro GetParameters
!insertmacro GetOptions
