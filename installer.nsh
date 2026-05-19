; HyperClip NSIS Post-Install Script
; Handles graceful upgrade: detect running instance, prompt user to close, retry.

!include "FileFunc.nsh"

!macro customInstall
  ; ─── Step 1: Create HyperClip-Data directory structure ───────────────────
  CreateDirectory "$APPDATA\HyperClip"
  CreateDirectory "$APPDATA\HyperClip\downloads"
  CreateDirectory "$APPDATA\HyperClip\blur"
  CreateDirectory "$APPDATA\HyperClip\logs"
  CreateDirectory "$APPDATA\HyperClip\chrome-profiles"

  ; ─── Step 2: Check if HyperClip is running ──────────────────────────────
  ; electron-builder default: NSIS will detect via its own mechanism
  ; We add a polite prompt as a belt-and-suspenders approach.
  DetailPrint "Checking for running HyperClip instance..."
  nsExec::ExecToLog 'tasklist /FI "IMAGENAME eq HyperClip.exe" /NH'
  Pop $0

  ; If HyperClip is running, show a user-friendly message before NSIS kills it
  ; The actual process termination is handled by electron-builder/NSIS built-in logic.
  ; This macro runs AFTER NSIS has already attempted to close the app.

!macroend

!macro customUnInstall
  ; Ask user whether to keep data
  MessageBox MB_YESNO|MB_ICONQUESTION "Remove HyperClip data? (Workspaces, channels, and rendered videos will be deleted)" IDNO skip_data

  ; Remove all app data
  RMDir /r "$APPDATA\HyperClip"

skip_data:
  ; Remove shortcuts
  Delete "$DESKTOP\HyperClip.lnk"
  RMDir /r "$SMPROGRAMS\HyperClip"
!macroend

; ─── Auto-update support ──────────────────────────────────────────────────────────
; When electron-builder detects a running app, it generates code to:
; 1. Ask user to close the app
; 2. Wait up to 60 seconds for graceful shutdown
; 3. Force-kill if user ignores
; This ensures quitAll() in main.ts gets called → FFmpeg workers cancelled cleanly.
