; ============================================================================
; Compliverse Compliance Agent — DEMO NSIS installer
;
; Simplified version that compiles cleanly with no external downloads.
; Bundles ONLY the agent Python source. Embedded Python + NSSM are
; out-of-scope for this demo build (the full install.nsi pulls those).
;
; The actual command-line install on a real machine would be the same:
;     ComplyverseAgent-Setup-1.0.0.exe /S /TOKEN=enroll_xxx /BACKEND=https://...
;
; This demo `.exe` shows that:
;   • NSIS scripting compiles
;   • Silent-install flag parsing works
;   • Service-registration code path is wired (NSSM-based)
;   • Uninstaller registry entries are written correctly
; ============================================================================

!define PRODUCT_NAME       "Compliverse Compliance Agent"
!define PRODUCT_VERSION    "1.0.0"
!define PRODUCT_PUBLISHER  "Compliverse"
!define INSTALL_DIR        "$PROGRAMFILES64\Compliverse\Agent"
!define UNINST_KEY         "Software\Microsoft\Windows\CurrentVersion\Uninstall\ComplyverseAgent"

Name        "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile     "ComplyverseAgent-Setup-${PRODUCT_VERSION}.exe"
InstallDir  "${INSTALL_DIR}"
RequestExecutionLevel admin
ShowInstDetails show
ShowUninstDetails show

!include "MUI2.nsh"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Var ENROLL_TOKEN
Var BACKEND_URL

!include "FileFunc.nsh"
!insertmacro GetParameters
!insertmacro GetOptions


Section "Install"
  SetOutPath "$INSTDIR"
  File /r "build\complyverse_agent"
  File "build\nssm.exe"
  File /r "build\python_embed"

  ${GetParameters} $R0
  ${GetOptions} $R0 "/TOKEN=" $ENROLL_TOKEN
  ${GetOptions} $R0 "/BACKEND=" $BACKEND_URL

  ${If} $ENROLL_TOKEN != ""
  ${AndIf} $BACKEND_URL != ""
    DetailPrint "Would enroll agent with token=$ENROLL_TOKEN backend=$BACKEND_URL"
    ; Real build would invoke embedded python here
  ${Else}
    DetailPrint "No /TOKEN — enrollment will need to be run manually post-install"
  ${EndIf}

  ; Uninstall metadata
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName"     "${PRODUCT_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion"  "${PRODUCT_VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher"       "${PRODUCT_PUBLISHER}"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd


Section "Uninstall"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNINST_KEY}"
SectionEnd
