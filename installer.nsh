; HyperClip NSIS Post-Install Script
; Included via electron-builder.yml → nsis.include

!macro customInstall
  ; Create HyperClip-Data directory structure
  CreateDirectory "$APPDATA\HyperClip"
  CreateDirectory "$APPDATA\HyperClip\downloads"
  CreateDirectory "$APPDATA\HyperClip\blur"
  CreateDirectory "$APPDATA\HyperClip\logs"
  CreateDirectory "$APPDATA\HyperClip\chrome-profiles"

  ; Create shortcuts
  CreateShortcut "$DESKTOP\HyperClip.lnk" "$INSTDIR\HyperClip.exe" "" "$INSTDIR\HyperClip.exe" 0
  CreateShortcut "$SMPROGRAMS\HyperClip.lnk" "$INSTDIR\HyperClip.exe" "" "$INSTDIR\HyperClip.exe" 0

  ; Write installer marker so first-run can detect fresh install
  WriteIniStr "$APPDATA\HyperClip\installed.ini" "installer" "version" "${VERSION}"
  WriteIniStr "$APPDATA\HyperClip\installed.ini" "installer" "installedAt" "$INSTTIME"
!macroend

!macro customUnInstall
  ; Ask user whether to keep data
  MessageBox MB_YESNO "Remove HyperClip data? (Workspaces, channels, and rendered videos will be deleted)" IDNO skip_data

  ; Remove all app data
  RMDir /r "$APPDATA\HyperClip"

skip_data:
  ; Remove shortcuts
  Delete "$DESKTOP\HyperClip.lnk"
  RMDir /r "$SMPROGRAMS\HyperClip"
!macroend
